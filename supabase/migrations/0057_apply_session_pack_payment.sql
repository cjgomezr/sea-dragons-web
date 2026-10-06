-- Aplicar el pago de un pack de sesiones (issue #471, RF-5 de
-- `docs/prd/e13-stripe-avanzado.md`, D1 y D2).
--
-- Un pack pagado escribe tres cosas: el id del evento en `stripe_events`, el
-- pago en `payments` y el crédito en `session_ledger`. Como en
-- `0051_apply_stripe_event.sql`, van en una sola función: un fallo entre la
-- primera y la última dejaría el evento apuntado sin las sesiones, y Stripe
-- lo reenviaría para que se ignorara siempre.
--
-- El id del evento entra primero: si ya estaba, `duplicate` sin tocar nada.
-- El pago es un cobro suelto, sin factura, y entra por su PaymentIntent en
-- `stripe_charge_id`, que es único (`0050`): otro evento del mismo pago lo
-- encuentra en vez de duplicarlo, y `credit_session_pack` (`0053`) no acredita
-- dos veces el mismo pago. El estado del Casual lo recalcula el trigger del
-- libro, así que aquí no se toca la membresía.
--
-- `security definer` y sólo `service_role`: quien llama es el webhook, que ya
-- verificó la firma de Stripe.

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
     description, status, paid_at)
  values (target_user_id,
          target_club_id,
          payment ->> 'stripe_charge_id',
          (payment ->> 'amount_cents')::integer,
          payment ->> 'currency',
          payment ->> 'description',
          'paid',
          (payment ->> 'paid_at')::timestamptz)
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

-- Como `apply_stripe_event`: Postgres concede `execute` a PUBLIC en toda
-- función nueva, y el `pg_default_acl` de Supabase además a `anon` y
-- `authenticated`. Abierta a ellos, cualquiera podría regalarse sesiones.
revoke all on function public.apply_session_pack_payment(
  text, text, timestamptz, uuid, uuid, jsonb, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_session_pack_payment(
  text, text, timestamptz, uuid, uuid, jsonb, integer)
  to service_role;

notify pgrst, 'reload schema';
