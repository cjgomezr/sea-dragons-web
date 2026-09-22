-- Dar de baja y reactivar a un socio (issue #244, RF-6 de
-- `docs/prd/e5-directorio-perfiles.md`). Un Admin pone `inactive` a un socio
-- de su club (FR-085) y se lo quita (AC-040), y el club nunca se queda sin un
-- Admin que pueda entrar.
--
-- La baja no borra nada: sólo cambia `account_status`. Las solicitudes de rol,
-- las pertenencias a grupos y la bitácora del socio siguen donde estaban; lo
-- que lo saca de cada sitio es que quien lee ese sitio mira el estado.
--
-- Reactivar no escribe `active` a ciegas. Una cuenta pudo darse de baja sin
-- haber terminado su registro, y revivirla como `active` le saltaría los
-- requisitos de FR-083. Quien llama decide, con la regla del registro
-- (`resolveAccountStatus`), si vuelve `active` o `incomplete`, y la función
-- sólo acepta ese paso desde `inactive`.
--
-- Un Admin de baja no puede entrar, así que no cuenta como Admin del club: la
-- regla del último Admin cuenta los que no están de baja. Por eso esta
-- migración también reescribe `change_member_role` (0014) con ese mismo
-- conteo. Sin eso, dar de baja a un Admin y luego degradar al otro dejaba al
-- club sin nadie que pudiera administrarlo.
--
-- Las dos funciones bloquean el mismo conjunto de filas (los Admin del club,
-- en el mismo orden) antes de contar. Así una baja y una degradación que
-- llegan a la vez se esperan, y la segunda cuenta con lo que dejó la primera.
--
-- `security definer` para que el cuerpo escriba en `members` sin depender de
-- los privilegios de quien la llama; por eso sólo la ejecuta `service_role`.
-- La bitácora no se escribe aquí: su único camino es `recordAuditEvent`
-- (NFR-010).
create or replace function public.set_member_status(
  target_user_id uuid,
  acting_club_id uuid,
  acting_user_id uuid,
  new_status text
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  previous_status text;
  target_role text;
  is_deactivation boolean;
begin
  if new_status is null
     or new_status not in ('active', 'incomplete', 'inactive') then
    raise exception 'estado no válido: %', new_status
      using errcode = 'invalid_parameter_value';
  end if;
  is_deactivation := new_status = 'inactive';

  -- El mismo bloqueo que `change_member_role`, en el mismo orden.
  perform 1
     from public.members m
    where m.club_id = acting_club_id
      and m.role = 'Admin'
    order by m.id
      for update;

  -- El socio de otro club responde igual que uno que no existe.
  select m.account_status, m.role into previous_status, target_role
    from public.members m
   where m.user_id = target_user_id
     and m.club_id = acting_club_id
     for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- Reactivar sólo tiene sentido desde la baja: a una cuenta `incomplete` no
  -- se le salta el registro, y una `active` ya está donde se pide.
  if (is_deactivation and previous_status = 'inactive')
     or (not is_deactivation and previous_status <> 'inactive') then
    return jsonb_build_object('outcome', 'unchanged', 'status', previous_status);
  end if;

  -- Antes que la baja propia: el último Admin que intenta irse tiene que oír
  -- por qué no puede, no que se lo pida a otro Admin que no existe.
  if is_deactivation and target_role = 'Admin' and (
    select count(*)
      from public.members m
     where m.club_id = acting_club_id
       and m.role = 'Admin'
       and m.account_status <> 'inactive'
  ) = 1 then
    return jsonb_build_object(
      'outcome', 'last_admin',
      'previous_status', previous_status
    );
  end if;

  if is_deactivation and target_user_id = acting_user_id then
    return jsonb_build_object('outcome', 'self_deactivation');
  end if;

  -- La aplicación ya comprobó que quien actúa es Admin, pero antes de tomar
  -- el bloqueo: otro Admin pudo degradarlo o darlo de baja mientras tanto.
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

  update public.members
     set account_status = new_status
   where user_id = target_user_id;

  return jsonb_build_object(
    'outcome', 'changed',
    'user_id', target_user_id,
    'previous_status', previous_status,
    'new_status', new_status
  );
end;
$$;

-- Como `change_member_role`: abierta a `authenticated`, un socio de baja
-- podría reactivarse llamándola por PostgREST.
revoke all on function public.set_member_status(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_member_status(uuid, uuid, uuid, text)
  to service_role;

-- `change_member_role` de 0014, igual salvo en dos puntos: el conteo del
-- último Admin no incluye a los Admin de baja, y quien actúa tampoco puede
-- estarlo. Degradar a un Admin de baja sí se permite con un solo Admin
-- activo, porque no le quita al club a nadie que pueda entrar.
create or replace function public.change_member_role(
  target_user_id uuid,
  acting_club_id uuid,
  acting_user_id uuid,
  new_role text
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  previous_role text;
  target_status text;
begin
  if new_role is null
     or new_role not in ('Admin', 'Coach', 'Committee', 'Player') then
    raise exception 'rol no válido: %', new_role
      using errcode = 'invalid_parameter_value';
  end if;

  perform 1
     from public.members m
    where m.club_id = acting_club_id
      and m.role = 'Admin'
    order by m.id
      for update;

  select m.role, m.account_status into previous_role, target_status
    from public.members m
   where m.user_id = target_user_id
     and m.club_id = acting_club_id
     for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if previous_role = new_role then
    return jsonb_build_object('outcome', 'unchanged', 'role', previous_role);
  end if;

  if previous_role = 'Admin' and target_status <> 'inactive' and (
    select count(*)
      from public.members m
     where m.club_id = acting_club_id
       and m.role = 'Admin'
       and m.account_status <> 'inactive'
  ) = 1 then
    return jsonb_build_object('outcome', 'last_admin');
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

  update public.members
     set role = new_role
   where user_id = target_user_id;

  return jsonb_build_object(
    'outcome', 'changed',
    'user_id', target_user_id,
    'previous_role', previous_role,
    'new_role', new_role
  );
end;
$$;

-- `create or replace` conserva los privilegios de 0014, pero se repiten para
-- que esta migración no dependa de en qué estado los dejó la anterior.
revoke all on function public.change_member_role(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.change_member_role(uuid, uuid, uuid, text)
  to service_role;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea la función en cuanto se
-- aplica, aunque faltara el event trigger que recarga su caché.
notify pgrst, 'reload schema';
