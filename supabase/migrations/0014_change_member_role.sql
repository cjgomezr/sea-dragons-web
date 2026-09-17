-- Cambiar el rol de un socio (issue #211, RF-6 y RF-7 de
-- `docs/prd/e3-roles-rbac.md`). Un Admin pone cualquiera de los cuatro roles
-- a un socio de su club (FR-014), y el club nunca se queda sin Admin.
--
-- La regla del último Admin no puede ser "leo cuántos hay y luego actualizo"
-- desde la aplicación: dos degradaciones simultáneas leerían dos y dejarían
-- cero. La función bloquea antes de contar todas las filas Admin del club, en
-- el mismo orden siempre para que dos llamadas no se interbloqueen. La segunda
-- espera a que la primera confirme y cuenta con lo que ya quedó escrito.
--
-- Devuelve un `jsonb` con un `outcome` en vez de lanzar, porque "no existe",
-- "ya tiene ese rol", "es el último Admin" y "quien llama ya no es Admin" son
-- respuestas esperadas que la API traduce. Sólo un rol que no es ninguno de
-- los cuatro lanza: eso es un fallo de quien llama, no un caso del negocio.
--
-- `decide_role_request` (0013) también escribe `members.role` y no pasa por
-- aquí: sólo concede Coach o Committee y nunca toca a un Admin, así que no
-- puede dejar al club sin ninguno.
--
-- `security definer` para que el cuerpo escriba en `members` sin depender de
-- los privilegios de quien la llama; por eso mismo sólo la puede ejecutar
-- `service_role`. La bitácora no se escribe aquí: su único camino es
-- `recordAuditEvent` (NFR-010).
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
begin
  if new_role is null
     or new_role not in ('Admin', 'Coach', 'Committee', 'Player') then
    raise exception 'rol no válido: %', new_role
      using errcode = 'invalid_parameter_value';
  end if;

  -- Toda llamada pasa por este bloqueo, también la que promueve o toca a
  -- alguien que no es Admin: así ningún cambio del club corre en paralelo a
  -- una degradación.
  perform 1
     from public.members m
    where m.club_id = acting_club_id
      and m.role = 'Admin'
    order by m.id
      for update;

  -- El club de quien actúa acota la búsqueda: el socio de otro club responde
  -- igual que uno que no existe.
  select m.role into previous_role
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

  if previous_role = 'Admin' and (
    select count(*)
      from public.members m
     where m.club_id = acting_club_id
       and m.role = 'Admin'
  ) = 1 then
    return jsonb_build_object('outcome', 'last_admin');
  end if;

  -- La aplicación ya comprobó que quien actúa es Admin, pero antes de tomar
  -- el bloqueo: otro Admin pudo degradarlo mientras tanto.
  if not exists (
    select 1
      from public.members m
     where m.user_id = acting_user_id
       and m.club_id = acting_club_id
       and m.role = 'Admin'
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

-- Postgres concede `execute` a PUBLIC en toda función nueva, y el
-- `pg_default_acl` de Supabase además a `anon`, `authenticated` y
-- `service_role`. Abierta a `authenticated`, cualquier socio podría hacerse
-- Admin llamándola por PostgREST, así que se quita todo y sólo el servidor,
-- con la llave de servicio, la ejecuta.
revoke all on function public.change_member_role(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.change_member_role(uuid, uuid, uuid, text)
  to service_role;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea la función en cuanto se
-- aplica, aunque faltara el event trigger que recarga su caché.
notify pgrst, 'reload schema';
