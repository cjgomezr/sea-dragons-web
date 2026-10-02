-- Aplicar un webhook de Stripe (issue #452, RF-7 y RF-8 de
-- `docs/prd/e12-stripe-base.md`, D7).
--
-- Un evento escribe hasta tres cosas: su id en `stripe_events`, la membresía
-- y un pago. Por PostgREST serían tres escrituras sueltas, y un fallo entre
-- la primera y la última dejaría el evento apuntado como aplicado sin
-- haberse aplicado: Stripe lo reenviaría y se ignoraría para siempre. Aquí
-- va todo en una función, y cualquier error la deshace entera.
--
-- El id entra primero con `on conflict do nothing`: si no entró, ya se aplicó
-- y la función responde `duplicate` sin tocar nada más. Si no, `applied`.
--
-- Qué escribir lo decide el servidor (`src/lib/stripe/webhook-events.ts`).
-- `membership_changes` trae sólo las columnas que cambian: una clave ausente
-- deja la columna como está, y una clave con `null` la vacía. Lo que la
-- función vuelve a mirar, con la fila en la mano, es el orden: Stripe no lo
-- garantiza, y dos eventos de la misma suscripción pueden aplicarse a la vez.
-- Un evento anterior al último que movió el estado (`stripe_event_at`) no
-- toca la membresía. El pago sí entra: el historial guarda lo que pasó.
--
-- Una factura es una fila (`payments_stripe_invoice_id_key`): un cobro que
-- falla y luego se paga la deja pagada, y un fallo que llega tarde no
-- deshace el pago.
--
-- `security definer` y sólo `service_role`, como `0044`: quien llama es el
-- webhook, que ya verificó la firma de Stripe.

alter table public.memberships
  add column if not exists stripe_event_at timestamptz;

comment on column public.memberships.stripe_event_at is
  'El created del último evento de Stripe que movió el estado (#452).';

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
       set status = case when changes ? 'status'
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
       description, status, paid_at)
    values (target_user_id,
            target_club_id,
            payment ->> 'stripe_invoice_id',
            (payment ->> 'amount_cents')::integer,
            payment ->> 'currency',
            payment ->> 'description',
            payment ->> 'status',
            (payment ->> 'paid_at')::timestamptz)
    on conflict (stripe_invoice_id)
    do update set amount_cents = excluded.amount_cents,
                  currency = excluded.currency,
                  description = excluded.description,
                  status = excluded.status,
                  paid_at = excluded.paid_at
          where p.status <> 'paid';
  end if;

  return 'applied';
end;
$$;

-- Como `save_attendance_sheet`: Postgres concede `execute` a PUBLIC en toda
-- función nueva, y el `pg_default_acl` de Supabase además a `anon` y
-- `authenticated`. Abierta a ellos, cualquiera podría ponerse al día
-- llamándola por PostgREST.
revoke all on function
  public.apply_stripe_event(text, text, timestamptz, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  public.apply_stripe_event(text, text, timestamptz, uuid, uuid, jsonb, jsonb)
  to service_role;

notify pgrst, 'reload schema';
