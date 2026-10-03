-- El cambio de plan programado (issue #456, RF-6 de
-- `docs/prd/e12-stripe-base.md`, D5). Stripe lo aplica al acabar el periodo
-- en curso; la membresía lo guarda para que Pagos lo enseñe sin preguntar a
-- Stripe. Lo escribe el servidor cuando Stripe lo acepta, y el webhook lo
-- borra cuando se aplica.
--
-- Sin plan no hay fecha y sin fecha no hay plan: los dos o ninguno.

alter table public.memberships
  add column if not exists scheduled_plan text,
  add column if not exists scheduled_at timestamptz;

comment on column public.memberships.scheduled_plan is
  'El plan al que pasa el socio al acabar el periodo en curso (#456).';
comment on column public.memberships.scheduled_at is
  'Cuándo Stripe aplica el cambio de plan programado (#456).';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'memberships_scheduled_plan_check'
       and conrelid = 'public.memberships'::regclass
  ) then
    alter table public.memberships
      add constraint memberships_scheduled_plan_check
      check (scheduled_plan in ('Full', 'Student', 'Casual'));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'memberships_scheduled_change_check'
       and conrelid = 'public.memberships'::regclass
  ) then
    alter table public.memberships
      add constraint memberships_scheduled_change_check
      check ((scheduled_plan is null) = (scheduled_at is null));
  end if;
end;
$$;

-- `apply_stripe_event` de `0051` con dos claves más: el webhook las manda
-- vacías cuando Stripe aplica el cambio o la suscripción acaba. Lo demás es
-- igual; ver el comentario de `0051_apply_stripe_event.sql`.
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

-- `create or replace` conserva los privilegios de `0051`; se repiten para que
-- esta migración diga sola quién puede llamarla.
revoke all on function
  public.apply_stripe_event(text, text, timestamptz, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  public.apply_stripe_event(text, text, timestamptz, uuid, uuid, jsonb, jsonb)
  to service_role;

notify pgrst, 'reload schema';
