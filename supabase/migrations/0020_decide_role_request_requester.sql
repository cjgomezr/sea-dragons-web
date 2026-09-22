-- Al rechazar una solicitud, decir a quién avisar y de qué (issue #267, RF-6
-- de `docs/prd/e6-notificaciones.md`). Quien pidió un rol recibe un aviso
-- `role_request_rejected` con el rol que había pedido, y la aplicación no
-- sabía ninguna de las dos cosas: `0013_decide_role_request.sql` sólo las
-- devolvía al aprobar.
--
-- Mismo cuerpo que en 0013 salvo el `jsonb` del rechazo, que suma `user_id` y
-- `requested_role`. Se reemplaza la función con la misma firma, así que los
-- privilegios de 0013 se conservan; se repiten igual por si alguien la
-- aplicara sobre una base donde se tocaron a mano.
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
      'decided_at', decided_instant,
      'user_id', target.user_id,
      'requested_role', target.requested_role
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

revoke all on function public.decide_role_request(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_role_request(uuid, uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';
