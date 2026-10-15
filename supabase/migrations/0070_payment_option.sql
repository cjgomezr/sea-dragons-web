-- La opción de cada pago de un extra (issue #637, RF-11 y D13 de
-- `docs/prd/e23-rediseno-pagos.md`).
--
-- Un extra puede pedir una opción al comprarlo, como la talla de una
-- camiseta: Checkout la pide con un desplegable y el webhook la apunta en el
-- pago con el texto que vio el socio. Así una compra conserva su opción
-- aunque el comité cambie la lista después. Nula en los pagos sin opción y
-- en todos los anteriores.
--
-- `apply_levy_payment` recibe `option` en el `jsonb` del pago; una llamada
-- que no la manda la deja nula, como antes. El resto de la función es igual
-- que en `0067`.

alter table public.payments
  add column if not exists option text;

comment on column public.payments.option is
  'La opción que el socio eligió al comprar un extra (#637); nula si no pedía.';

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
     quantity, option)
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
          coalesce((payment ->> 'quantity')::integer, 1),
          payment ->> 'option')
  on conflict (stripe_charge_id) do nothing;

  return 'applied';
end;
$$;

-- `create or replace` conserva los privilegios de `0067`; se repiten para que
-- esta migración diga sola quién puede llamarla.
revoke all on function public.apply_levy_payment(
  text, text, timestamptz, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_levy_payment(
  text, text, timestamptz, uuid, uuid, jsonb)
  to service_role;

notify pgrst, 'reload schema';
