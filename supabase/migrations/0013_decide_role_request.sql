-- Decidir una solicitud de rol (issue #210, RF-5 de `docs/prd/e3-roles-rbac.md`).
-- Un Admin aprueba o rechaza (FR-011); aprobar cambia el rol del socio y
-- rechazar lo deja como estaba (AC-006).
--
-- Va en una función y no en dos escrituras desde la aplicación por dos reglas
-- que no pueden depender de que la aplicación se porte bien: la solicitud y
-- el rol cambian juntos o no cambia ninguno, y dos Admin decidiendo a la vez
-- no se pisan. La función corre en una sola transacción y bloquea la fila de
-- la solicitud antes de mirar su estado: la segunda decisión espera a que la
-- primera confirme, relee la fila y la encuentra resuelta.
--
-- Devuelve un `jsonb` con un `outcome` en vez de lanzar, porque "ya estaba
-- resuelta", "ya tiene el rol" y "no existe" son respuestas esperadas que la
-- API traduce a 409, 422 y 404. Sólo una decisión que no es ninguna de las dos
-- lanza: eso es un fallo de quien llama, no un caso del negocio.
--
-- `security definer` para que el cuerpo escriba en `members` y `role_requests`
-- sin depender de los privilegios de quien la llama; por eso mismo sólo la
-- puede ejecutar `service_role` (ver los `revoke` del final). La bitácora no
-- se escribe aquí: su único camino es `recordAuditEvent` (NFR-010).
create or replace function public.decide_role_request(
  target_request_id uuid,
  deciding_club_id uuid,
  deciding_user_id uuid,
  decision text
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  target public.role_requests%rowtype;
  member_role text;
  decided_instant timestamptz;
begin
  if decision is null or decision not in ('approved', 'rejected') then
    raise exception 'decisión no válida: %', decision
      using errcode = 'invalid_parameter_value';
  end if;

  -- El club de quien decide acota la búsqueda: la solicitud de otro club
  -- responde igual que una que no existe.
  select r.* into target
    from public.role_requests r
   where r.id = target_request_id
     and r.club_id = deciding_club_id
     for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if target.status <> 'pending' then
    return jsonb_build_object(
      'outcome', 'already_decided', 'status', target.status
    );
  end if;

  if decision = 'approved' then
    -- Bloqueada también: el rol que se compara es el que se va a reemplazar.
    select m.role into member_role
      from public.members m
     where m.user_id = target.user_id
       for update;

    -- Coach y Committee están a la par; Admin está por encima de los dos.
    -- Aprobar nunca degrada a un Admin, y la solicitud sigue pendiente para
    -- que el Admin la rechace.
    if member_role = target.requested_role or member_role = 'Admin' then
      return jsonb_build_object('outcome', 'role_already_granted');
    end if;

    update public.members
       set role = target.requested_role
     where user_id = target.user_id;
  end if;

  update public.role_requests
     set status = decision,
         decided_by = deciding_user_id,
         decided_at = now()
   where id = target.id
  returning role_requests.decided_at into decided_instant;

  if decision = 'rejected' then
    return jsonb_build_object(
      'outcome', 'rejected',
      'id', target.id,
      'decided_by', deciding_user_id,
      'decided_at', decided_instant
    );
  end if;

  return jsonb_build_object(
    'outcome', 'approved',
    'id', target.id,
    'decided_by', deciding_user_id,
    'decided_at', decided_instant,
    'user_id', target.user_id,
    'previous_role', member_role,
    'new_role', target.requested_role
  );
end;
$$;

-- Postgres concede `execute` a PUBLIC en toda función nueva, y el
-- `pg_default_acl` de Supabase además a `anon`, `authenticated` y
-- `service_role`. Una función definer abierta a `authenticated` dejaría a
-- cualquier socio aprobarse a sí mismo llamándola por PostgREST, así que se
-- quita todo y sólo el servidor, con la llave de servicio, la ejecuta.
revoke all on function public.decide_role_request(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_role_request(uuid, uuid, uuid, text)
  to service_role;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea la función en cuanto se
-- aplica, aunque faltara el event trigger que recarga su caché.
notify pgrst, 'reload schema';
