-- La tarjeta y el motivo del fallo de cada pago (issue #629, RF-3 y D4 de
-- `docs/prd/e23-rediseno-pagos.md`).
--
-- El historial enseña con qué tarjeta se pagó y por qué falló un cobro. Ni la
-- factura ni la sesión de Checkout lo traen: el webhook lo lee en el
-- PaymentIntent del cobro y lo manda en el `jsonb` del pago. De la tarjeta,
-- sólo lo que dice cuál es (NFR-006), con el mismo check de cuatro cifras que
-- `memberships_card_last4_check` (`0050`). Los pagos anteriores se quedan sin
-- ellos: no se rellenan desde Stripe (D4).
--
-- Las tres funciones que apuntan pagos se reescriben con las columnas nuevas.
-- Una llamada que no las manda las deja nulas, como antes. El resto de cada
-- función es igual: ver `0051`/`0052`, `0057` y `0060`.
--
-- Un cobro fallido que luego se paga es la misma fila (una factura, un
-- pago). El cobro bueno la deja `paid` con su tarjeta, y el motivo, que el
-- servidor manda nulo en un pago, deja de estar. Las políticas de `payments`
-- no cambian: un socio sólo lee los suyos (`payments_select_own`).

alter table public.payments
  add column if not exists card_brand text,
  add column if not exists card_last4 text,
  add column if not exists failure_reason text;

comment on column public.payments.card_brand is
  'La marca de la tarjeta del cobro, como la da Stripe (#629).';
comment on column public.payments.card_last4 is
  'Los cuatro últimos dígitos de la tarjeta del cobro (#629).';
comment on column public.payments.failure_reason is
  'Por qué falló el cobro, con las palabras de Stripe (#629).';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'payments_card_last4_check'
       and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
      add constraint payments_card_last4_check
      check (card_last4 ~ '^[0-9]{4}$');
  end if;
end;
$$;

create or replace function public.apply_stripe_event(
  event_id text,
  event_type text,
  event_created timestamptz,
  target_user_id uuid,
  target_club_id uuid,
  membership_changes jsonb,
  payment jsonb
)
  returns text
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  changes jsonb := coalesce(membership_changes, '{}'::jsonb);
begin
  insert into public.stripe_events (id, type, created)
  values (event_id, event_type, event_created)
  on conflict (id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  if membership_changes is not null then
    update public.memberships m
       set status = case when m.status = 'waived'
                              and (m.waived_until is null
                                   or m.waived_until > now())
                         then m.status
                         when changes ? 'status'
                         then changes ->> 'status' else m.status end,
           plan = case when changes ? 'plan'
                       then changes ->> 'plan' else m.plan end,
           stripe_customer_id =
             case when changes ? 'stripe_customer_id'
                  then changes ->> 'stripe_customer_id'
                  else m.stripe_customer_id end,
           stripe_subscription_id =
             case when changes ? 'stripe_subscription_id'
                  then changes ->> 'stripe_subscription_id'
                  else m.stripe_subscription_id end,
           trial_end =
             case when changes ? 'trial_end'
                  then (changes ->> 'trial_end')::timestamptz
                  else m.trial_end end,
           current_period_end =
             case when changes ? 'current_period_end'
                  then (changes ->> 'current_period_end')::timestamptz
                  else m.current_period_end end,
           card_brand = case when changes ? 'card_brand'
                             then changes ->> 'card_brand'
                             else m.card_brand end,
           card_last4 = case when changes ? 'card_last4'
                             then changes ->> 'card_last4'
                             else m.card_last4 end,
           card_exp_month =
             case when changes ? 'card_exp_month'
                  then (changes ->> 'card_exp_month')::smallint
                  else m.card_exp_month end,
           card_exp_year =
             case when changes ? 'card_exp_year'
                  then (changes ->> 'card_exp_year')::smallint
                  else m.card_exp_year end,
           scheduled_plan =
             case when changes ? 'scheduled_plan'
                  then changes ->> 'scheduled_plan'
                  else m.scheduled_plan end,
           scheduled_at =
             case when changes ? 'scheduled_at'
                  then (changes ->> 'scheduled_at')::timestamptz
                  else m.scheduled_at end,
           stripe_event_at =
             case when changes ? 'stripe_event_at'
                  then (changes ->> 'stripe_event_at')::timestamptz
                  else m.stripe_event_at end,
           updated_at = now()
     where m.user_id = target_user_id
       and m.club_id = target_club_id
       and (m.stripe_event_at is null or m.stripe_event_at <= event_created);
  end if;

  if payment is not null then
    insert into public.payments as p
      (user_id, club_id, stripe_invoice_id, amount_cents, currency,
       description, status, paid_at, card_brand, card_last4, failure_reason)
    values (target_user_id,
            target_club_id,
            payment ->> 'stripe_invoice_id',
            (payment ->> 'amount_cents')::integer,
            payment ->> 'currency',
            payment ->> 'description',
            payment ->> 'status',
            (payment ->> 'paid_at')::timestamptz,
            payment ->> 'card_brand',
            payment ->> 'card_last4',
            payment ->> 'failure_reason')
    on conflict (stripe_invoice_id)
    do update set amount_cents = excluded.amount_cents,
                  currency = excluded.currency,
                  description = excluded.description,
                  status = excluded.status,
                  paid_at = excluded.paid_at,
                  card_brand = excluded.card_brand,
                  card_last4 = excluded.card_last4,
                  failure_reason = excluded.failure_reason
          where p.status <> 'paid';
  end if;

  return 'applied';
end;
$$;

create or replace function public.apply_session_pack_payment(
  event_id text,
  event_type text,
  event_created timestamptz,
  target_user_id uuid,
  target_club_id uuid,
  payment jsonb,
  pack_sessions integer
)
  returns text
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  pack_payment_id uuid;
begin
  insert into public.stripe_events (id, type, created)
  values (event_id, event_type, event_created)
  on conflict (id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  insert into public.payments
    (user_id, club_id, stripe_charge_id, amount_cents, currency,
     description, status, paid_at, card_brand, card_last4)
  values (target_user_id,
          target_club_id,
          payment ->> 'stripe_charge_id',
          (payment ->> 'amount_cents')::integer,
          payment ->> 'currency',
          payment ->> 'description',
          'paid',
          (payment ->> 'paid_at')::timestamptz,
          payment ->> 'card_brand',
          payment ->> 'card_last4')
  on conflict (stripe_charge_id) do nothing
  returning id into pack_payment_id;

  if pack_payment_id is null then
    select p.id into strict pack_payment_id
      from public.payments p
     where p.stripe_charge_id = payment ->> 'stripe_charge_id'
       and p.user_id = target_user_id
       and p.club_id = target_club_id;
  end if;

  perform public.credit_session_pack(
    target_user_id, target_club_id, pack_sessions, pack_payment_id);

  return 'applied';
end;
$$;

create or replace function public.apply_levy_payment(
  event_id text,
  event_type text,
  event_created timestamptz,
  target_user_id uuid,
  target_club_id uuid,
  payment jsonb
)
  returns text
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  insert into public.stripe_events (id, type, created)
  values (event_id, event_type, event_created)
  on conflict (id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  insert into public.payments
    (user_id, club_id, stripe_charge_id, stripe_product_id, amount_cents,
     currency, description, status, paid_at, card_brand, card_last4)
  values (target_user_id,
          target_club_id,
          payment ->> 'stripe_charge_id',
          payment ->> 'stripe_product_id',
          (payment ->> 'amount_cents')::integer,
          payment ->> 'currency',
          payment ->> 'description',
          'paid',
          (payment ->> 'paid_at')::timestamptz,
          payment ->> 'card_brand',
          payment ->> 'card_last4')
  on conflict (stripe_charge_id) do nothing;

  return 'applied';
end;
$$;

-- `create or replace` conserva los privilegios de `0051`, `0057` y `0060`;
-- se repiten para que esta migración diga sola quién puede llamarlas.
revoke all on function
  public.apply_stripe_event(text, text, timestamptz, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  public.apply_stripe_event(text, text, timestamptz, uuid, uuid, jsonb, jsonb)
  to service_role;
revoke all on function public.apply_session_pack_payment(
  text, text, timestamptz, uuid, uuid, jsonb, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_session_pack_payment(
  text, text, timestamptz, uuid, uuid, jsonb, integer)
  to service_role;
revoke all on function public.apply_levy_payment(
  text, text, timestamptz, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_levy_payment(
  text, text, timestamptz, uuid, uuid, jsonb)
  to service_role;

notify pgrst, 'reload schema';
