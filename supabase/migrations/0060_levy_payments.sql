-- Los pagos de los levies (issue #473, RF-6 de
-- `docs/prd/e13-stripe-avanzado.md`, D4 y D8).
--
-- Un levy es un producto que el comité crea en Stripe. Para saber cuál pagó
-- cada socio, el pago guarda el id del producto de Stripe en
-- `stripe_product_id`; las cuotas y los packs lo dejan nulo. El índice parcial
-- sirve la pregunta de Pagos: qué productos pagó este socio.
--
-- `apply_levy_payment` escribe, como `0057_apply_session_pack_payment.sql`,
-- el id del evento y el pago en una sola función: un repetido devuelve
-- `duplicate` sin tocar nada, y otro evento del mismo pago lo encuentra por
-- su PaymentIntent en `stripe_charge_id`, que es único (`0050`). Pagar un levy
-- no cambia la membresía (D4), así que aquí no se toca.
--
-- `security definer` y sólo `service_role`: quien llama es el webhook, que ya
-- verificó la firma de Stripe.

alter table public.payments
  add column if not exists stripe_product_id text;

create index if not exists payments_user_id_stripe_product_id_idx
  on public.payments (user_id, stripe_product_id)
  where stripe_product_id is not null;

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
     currency, description, status, paid_at)
  values (target_user_id,
          target_club_id,
          payment ->> 'stripe_charge_id',
          payment ->> 'stripe_product_id',
          (payment ->> 'amount_cents')::integer,
          payment ->> 'currency',
          payment ->> 'description',
          'paid',
          (payment ->> 'paid_at')::timestamptz)
  on conflict (stripe_charge_id) do nothing;

  return 'applied';
end;
$$;

-- Como `apply_session_pack_payment`: Postgres concede `execute` a PUBLIC en
-- toda función nueva, y el `pg_default_acl` de Supabase además a `anon` y
-- `authenticated`. Abierta a ellos, cualquiera podría apuntarse un levy
-- pagado.
revoke all on function public.apply_levy_payment(
  text, text, timestamptz, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_levy_payment(
  text, text, timestamptz, uuid, uuid, jsonb)
  to service_role;

notify pgrst, 'reload schema';
