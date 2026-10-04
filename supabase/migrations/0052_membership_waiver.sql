-- La exención manual del Admin (issue #457, RF-4 de
-- `docs/prd/e12-stripe-base.md`, D4). Un Admin exime de cuota a un socio de su
-- club, con motivo y fecha de fin opcional, y se la retira.
--
-- La fecha de fin es un día del club: la exención deja de contar al empezar
-- ese día en Melbourne (NFR-003). Se guarda el instante, y quien lee lo
-- compara con la hora (`resolveMembership`), sin scheduler.
--
-- Retirar no escribe `pending` a ciegas. Quien tenía suscripción vuelve a lo
-- que digan sus fechas, con la misma regla que aplica la aplicación a una
-- exención vencida (`statusAfterWaiver` en `src/lib/membership/membership.ts`):
-- en prueba, en curso o ya terminada.
--
-- Las dos funciones devuelven además lo que el servidor necesita para
-- cancelar en Stripe la suscripción de quien queda exento: el estado
-- anterior y la suscripción. La cancelación va después y fuera de aquí; si
-- falla, la exención se queda.
--
-- `security definer` y sólo `service_role`, como `set_member_status`
-- (`0017`): abierta a `authenticated`, cualquiera podría eximirse llamándola
-- por PostgREST. La bitácora no se escribe aquí: su único camino es
-- `recordAuditEvent` (NFR-010).

create or replace function public.waive_membership(
  target_user_id uuid,
  acting_club_id uuid,
  acting_user_id uuid,
  reason text,
  until_day date
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  waiver_reason text := btrim(reason);
  waiver_until timestamptz;
  previous_status text;
  subscription_id text;
begin
  if waiver_reason is null or waiver_reason = ''
     or char_length(waiver_reason) > 200 then
    raise exception 'motivo de exención no válido'
      using errcode = 'invalid_parameter_value';
  end if;
  if until_day is not null
     and until_day <= (now() at time zone 'Australia/Melbourne')::date then
    raise exception 'la exención tiene que terminar después de hoy: %',
      until_day
      using errcode = 'invalid_parameter_value';
  end if;
  waiver_until := until_day::timestamp at time zone 'Australia/Melbourne';

  -- El socio de otro club responde igual que uno que no existe.
  if not exists (
    select 1
      from public.members m
     where m.user_id = target_user_id
       and m.club_id = acting_club_id
  ) then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- La aplicación ya comprobó que quien actúa es Admin, pero otro Admin pudo
  -- degradarlo o darlo de baja mientras tanto.
  if not exists (
    select 1
      from public.members m
     where m.user_id = acting_user_id
       and m.club_id = acting_club_id
       and m.role = 'Admin'
       and m.account_status <> 'inactive'
  ) then
    return jsonb_build_object('outcome', 'actor_not_admin');
  end if;

  -- Quien todavía no activó su cuenta puede no tener membresía (nace al
  -- activarla): eximirlo se la crea.
  insert into public.memberships (user_id, club_id, status)
  values (target_user_id, acting_club_id, 'pending')
  on conflict (user_id, club_id) do nothing;

  select ms.status, ms.stripe_subscription_id
    into previous_status, subscription_id
    from public.memberships ms
   where ms.user_id = target_user_id
     and ms.club_id = acting_club_id
     for update;

  update public.memberships
     set status = 'waived',
         waived_reason = waiver_reason,
         waived_until = waiver_until,
         waived_by = acting_user_id,
         updated_at = now()
   where user_id = target_user_id
     and club_id = acting_club_id;

  return jsonb_build_object(
    'outcome', 'waived',
    'previous_status', previous_status,
    'stripe_subscription_id', subscription_id,
    'reason', waiver_reason,
    'until', waiver_until
  );
end;
$$;

create or replace function public.remove_membership_waiver(
  target_user_id uuid,
  acting_club_id uuid,
  acting_user_id uuid
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  current_status text;
  subscription_id text;
  trial_ends timestamptz;
  period_ends timestamptz;
  next_status text;
begin
  if not exists (
    select 1
      from public.members m
     where m.user_id = target_user_id
       and m.club_id = acting_club_id
  ) then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if not exists (
    select 1
      from public.members m
     where m.user_id = acting_user_id
       and m.club_id = acting_club_id
       and m.role = 'Admin'
       and m.account_status <> 'inactive'
  ) then
    return jsonb_build_object('outcome', 'actor_not_admin');
  end if;

  select ms.status, ms.stripe_subscription_id, ms.trial_end,
         ms.current_period_end
    into current_status, subscription_id, trial_ends, period_ends
    from public.memberships ms
   where ms.user_id = target_user_id
     and ms.club_id = acting_club_id
     for update;

  if not found or current_status <> 'waived' then
    return jsonb_build_object(
      'outcome', 'not_waived',
      'status', coalesce(current_status, 'pending')
    );
  end if;

  next_status := case
    when subscription_id is null then 'pending'
    when trial_ends > now() then 'trialing'
    when period_ends > now() then 'active'
    else 'cancelled'
  end;

  update public.memberships
     set status = next_status,
         waived_reason = null,
         waived_until = null,
         waived_by = null,
         updated_at = now()
   where user_id = target_user_id
     and club_id = acting_club_id;

  return jsonb_build_object('outcome', 'removed', 'status', next_status);
end;
$$;

-- Postgres concede `execute` a PUBLIC en toda función nueva, y el
-- `pg_default_acl` de Supabase además a `anon` y `authenticated`.
revoke all on function
  public.waive_membership(uuid, uuid, uuid, text, date)
  from public, anon, authenticated, service_role;
grant execute on function
  public.waive_membership(uuid, uuid, uuid, text, date)
  to service_role;

revoke all on function
  public.remove_membership_waiver(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.remove_membership_waiver(uuid, uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
