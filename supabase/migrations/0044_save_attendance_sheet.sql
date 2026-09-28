-- Guardar la hoja de asistencia de un entrenamiento entera (issue #393, RF-3
-- de `docs/prd/e8-asistencia.md`, FR-041).
--
-- La hoja se guarda completa: las filas que no vienen en la lista salen, y
-- las que vienen se insertan o se reescriben. Hecho con escrituras sueltas
-- por PostgREST, un fallo a medias dejaría una hoja mezclada. Aquí va todo en
-- una función, y cualquier error la deshace entera: un miembro de otro club
-- hace fallar la llamada por la clave compuesta de `0043`.
--
-- La fila del evento se bloquea (`for update`) antes de tocar nada. Si dos
-- personas guardan la misma hoja a la vez, la segunda espera a que termine la
-- primera y escribe encima: la hoja queda como la dejó la última, entera.
--
-- Quién sale en la hoja (la audiencia, quien ya tenía fila) lo decide el
-- servidor (`src/lib/attendance/`). Lo que la función vuelve a mirar, con la
-- fila bloqueada, es el evento: pudo cancelarse o moverse al futuro entre que
-- el servidor lo leyó y lo escribe. Responde `saved`, o `not_found`,
-- `cancelled` o `not_started` sin escribir nada, para que el servidor
-- conteste el 404 o el 422 que toca. "Empezado" se decide con la hora de la
-- base, la misma regla del RSVP al revés.
--
-- `records` es una lista de `{ user_id, status }`.
--
-- `security definer` y sólo `service_role`, como `0036`: el servidor ya
-- comprobó que quien llama puede pasar lista (`buildTeamsAndTrackAttendance`)
-- y pasa su club, que sale de su fila de `members` y nunca del cuerpo de la
-- petición.
create or replace function public.save_attendance_sheet(
  acting_club_id uuid,
  acting_user_id uuid,
  target_event_id uuid,
  records jsonb
)
  returns text
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  target public.events%rowtype;
begin
  select * into target
    from public.events e
   where e.id = target_event_id
     and e.club_id = acting_club_id
     for update;

  if not found or target.event_type <> 'training' then
    return 'not_found';
  end if;
  if target.status = 'cancelled' then
    return 'cancelled';
  end if;
  if target.starts_at > now() then
    return 'not_started';
  end if;

  delete from public.attendance_records a
   where a.event_id = target_event_id
     and a.user_id not in (
       select (row ->> 'user_id')::uuid
         from jsonb_array_elements(records) as row
     );

  insert into public.attendance_records
    (event_id, user_id, club_id, status, recorded_by, recorded_at)
  select target_event_id,
         (row ->> 'user_id')::uuid,
         acting_club_id,
         row ->> 'status',
         acting_user_id,
         now()
    from jsonb_array_elements(records) as row
  on conflict (event_id, user_id)
  do update set status = excluded.status,
                recorded_by = excluded.recorded_by,
                recorded_at = excluded.recorded_at;

  return 'saved';
end;
$$;

-- Como `create_events`: Postgres concede `execute` a PUBLIC en toda función
-- nueva, y el `pg_default_acl` de Supabase además a `anon` y `authenticated`.
-- Abierta a ellos, cualquier socio podría escribir la asistencia de todos
-- llamándola por PostgREST.
revoke all on function public.save_attendance_sheet(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_attendance_sheet(uuid, uuid, uuid, jsonb)
  to service_role;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea la función en cuanto se
-- aplica, aunque faltara el event trigger que recarga su caché.
notify pgrst, 'reload schema';
