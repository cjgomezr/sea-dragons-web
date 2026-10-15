-- Las unidades de cada pago (issue #632, RF-6 y D2 de
-- `docs/prd/e23-rediseno-pagos.md`).
--
-- Un extra puede venderse en varias unidades (ropa del club): el socio elige
-- cuántas en Checkout y el pago se apunta una sola vez, con el importe total y
-- `quantity`. Cuántas lleva compradas un socio de un extra es la suma de las
-- de sus pagos cobrados. Los pagos anteriores, y los que no son de un extra,
-- son de una unidad: eso pone el `default`.
--
-- `apply_levy_payment` recibe `quantity` en el `jsonb` del pago; una llamada
-- que no la manda apunta una unidad, como antes. El resto de la función es
-- igual que en `0066`.

alter table public.payments
  add column if not exists quantity integer not null default 1;

comment on column public.payments.quantity is
  'Las unidades que se compraron en el pago (#632). Una, salvo un extra.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'payments_quantity_check'
       and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
      add constraint payments_quantity_check check (quantity >= 1);
  end if;
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
     currency, description, status, paid_at, card_brand, card_last4,
     quantity)
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
          payment ->> 'card_last4',
          coalesce((payment ->> 'quantity')::integer, 1))
  on conflict (stripe_charge_id) do nothing;

  return 'applied';
end;
$$;

-- `create or replace` conserva los privilegios de `0060` y `0066`; se repiten
-- para que esta migración diga sola quién puede llamarla.
revoke all on function public.apply_levy_payment(
  text, text, timestamptz, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_levy_payment(
  text, text, timestamptz, uuid, uuid, jsonb)
  to service_role;

notify pgrst, 'reload schema';
