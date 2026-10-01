-- La membresía de cada socio y lo que Stripe le cobra (issue #451, RF-1 y RF-7
-- de `docs/prd/e12-stripe-base.md`). La membresía deja de ser el texto de
-- `members.membership_type` y pasa a tener un estado (D1). Los pagos son el
-- historial que traen los webhooks (#452), y `stripe_events` recuerda qué
-- eventos ya se aplicaron para no aplicarlos dos veces.
--
-- Quién mueve el estado (los webhooks y la exención del Admin) lo decide el
-- servidor con la llave de servicio. Lo que la base afirma sola es la forma:
-- el plan, el estado, una membresía por socio, un pago por cobro de Stripe y
-- las cascadas.

create table if not exists public.memberships (
  user_id uuid not null,
  club_id uuid not null references public.clubs (id),
  -- Nulo sólo para el socio que todavía no eligió tipo: el relleno copia
  -- `members.membership_type`, que admite nulo.
  plan text
    constraint memberships_plan_check
    check (plan in ('Full', 'Student', 'Casual')),
  status text not null default 'pending'
    constraint memberships_status_check
    check (status in
      ('pending', 'trialing', 'active', 'past_due', 'cancelled', 'waived')),
  stripe_customer_id text constraint memberships_stripe_customer_id_key unique,
  stripe_subscription_id text
    constraint memberships_stripe_subscription_id_key unique,
  current_period_end timestamptz,
  trial_end timestamptz,
  -- De la tarjeta sólo lo que se enseña en el panel (NFR-006). Ni el número ni
  -- nada que sirva para cobrar: eso lo guarda Stripe.
  card_brand text,
  card_last4 text
    constraint memberships_card_last4_check
    check (card_last4 ~ '^[0-9]{4}$'),
  card_exp_month smallint
    constraint memberships_card_exp_month_check
    check (card_exp_month between 1 and 12),
  card_exp_year smallint,
  -- La exención del Admin (D4). Sin motivo no hay exención; la fecha de fin es
  -- opcional y se compara al leer, sin scheduler.
  waived_reason text,
  waived_until timestamptz,
  waived_by uuid,
  created_at timestamptz not null default now(),
  -- Sin trigger, como en `team_splits`: lo pone quien escribe la fila.
  updated_at timestamptz not null default now(),
  constraint memberships_waived_reason_check
    check (status <> 'waived' or waived_reason is not null),
  constraint memberships_pkey primary key (user_id, club_id),
  -- Borrar la identidad (que borra al socio) se lleva su membresía.
  constraint memberships_member_same_club_fkey
    foreign key (user_id, club_id)
    references public.members (user_id, club_id) on delete cascade,
  -- Si el Admin que eximió se va, la exención se queda sin su nombre.
  constraint memberships_waiver_same_club_fkey
    foreign key (waived_by, club_id)
    references public.members (user_id, club_id)
    on delete set null (waived_by)
);

-- Lo que eximió cada Admin, para el `set null` cuando se va.
create index if not exists memberships_waived_by_club_id_idx
  on public.memberships (waived_by, club_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  club_id uuid not null references public.clubs (id),
  -- Una cuota llega como factura; un cobro suelto (los packs de E13), como
  -- cargo. Cada uno entra una sola vez aunque Stripe repita el webhook.
  stripe_invoice_id text constraint payments_stripe_invoice_id_key unique,
  stripe_charge_id text constraint payments_stripe_charge_id_key unique,
  -- Centavos enteros (CON-005), nunca un decimal.
  amount_cents integer not null
    constraint payments_amount_cents_check check (amount_cents >= 0),
  -- En minúsculas, como la manda Stripe: así 'aud' y 'AUD' no conviven.
  currency text not null default 'aud'
    constraint payments_currency_check check (currency ~ '^[a-z]{3}$'),
  description text,
  status text not null
    constraint payments_status_check
    check (status in ('paid', 'failed', 'pending')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  constraint payments_stripe_reference_check
    check (stripe_invoice_id is not null or stripe_charge_id is not null),
  constraint payments_member_same_club_fkey
    foreign key (user_id, club_id)
    references public.members (user_id, club_id) on delete cascade
);

-- El historial de un socio, y la cascada desde su fila de `members`.
create index if not exists payments_user_id_club_id_idx
  on public.payments (user_id, club_id);

-- Sin `club_id`: un evento es de la cuenta de Stripe, no de un socio. Lo lee y
-- lo escribe sólo el webhook.
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  created timestamptz not null,
  processed_at timestamptz not null default now()
);

-- Cada socio que ya existía recibe su membresía, con el tipo que eligió en el
-- registro. `on conflict` hace que reaplicar el histórico no la resetee.
insert into public.memberships (user_id, club_id, plan, status)
select user_id, club_id, membership_type, 'pending'
  from public.members
on conflict (user_id, club_id) do nothing;

alter table public.memberships enable row level security;
alter table public.payments enable row level security;
alter table public.stripe_events enable row level security;

-- Cada socio ve sólo lo suyo. El panel del Admin lo sirve el servidor.
drop policy if exists memberships_select_own on public.memberships;
create policy memberships_select_own
  on public.memberships
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists payments_select_own on public.payments;
create policy payments_select_own
  on public.payments
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Revocar primero, como en `0043_attendance_records.sql`: el proyecto concede
-- todo a `anon` y `authenticated` sobre cada tabla nueva. Escribe sólo el
-- servidor; `stripe_events` ni siquiera se lee desde fuera.
revoke all on public.memberships from anon, authenticated;
grant select on public.memberships to authenticated;
grant select, insert, update, delete on public.memberships to service_role;

revoke all on public.payments from anon, authenticated;
grant select on public.payments to authenticated;
grant select, insert, update, delete on public.payments to service_role;

revoke all on public.stripe_events from anon, authenticated;
grant select, insert, update, delete on public.stripe_events to service_role;

notify pgrst, 'reload schema';
