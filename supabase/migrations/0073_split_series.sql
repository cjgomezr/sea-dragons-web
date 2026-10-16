-- Partir una serie desde una sesión (#653, RF-11 y D2 del PRD de E24).
--
-- "Esta y las siguientes": la serie original pasa a terminar el día anterior
-- a la sesión elegida y nace otra, con los mismos días, desde esa fecha hasta
-- el final original. Las sesiones desde esa fecha pasan a la nueva con su id,
-- así que sus respuestas, su asistencia y sus equipos van con ellas. Las
-- anteriores no cambian, aunque sean futuras.
--
-- Los cambios los aplica `update_series` sobre la serie nueva, la versión de
-- `0072_event_covers.sql`, sin tocarla: cambia la serie y sus sesiones
-- futuras no canceladas (las editadas solas incluidas) y sustituye la
-- audiencia si viene. Las canceladas se mueven y siguen como estaban.
--
-- Todo va en la transacción de la llamada, con la serie original bloqueada:
-- dos particiones desde la misma sesión se serializan y la segunda ya no la
-- encuentra en esa serie (`session_not_in_series`). "Ya empezó" se decide con
-- `now()`, la misma regla que el RSVP (#308).
--
-- Devuelve un jsonb con `outcome`:
--   `split`, con la serie nueva en `series_id` y cuántas sesiones cambiaron;
--   `edited`, si la elegida es la primera de la serie: no queda una serie
--     vacía, se edita la entera y `series_id` es la misma;
--   `occurrence_started` o `session_not_in_series`, sin escribir nada.
-- Con `updated_occurrences` a 0 no escribe nada: desde la elegida no queda
-- ninguna sesión futura sin cancelar, y responde `edited` sobre la misma.
create or replace function public.split_series(
  acting_club_id uuid,
  target_series_id uuid,
  from_event_id uuid,
  changes jsonb
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  from_day date;
  from_instant timestamptz;
  new_series_id uuid;
begin
  perform 1
     from public.event_series s
    where s.id = target_series_id
      and s.club_id = acting_club_id
      for update;

  if not found then
    return jsonb_build_object('outcome', 'session_not_in_series');
  end if;

  select e.starts_on, e.starts_at
    into from_day, from_instant
    from public.events e
   where e.id = from_event_id
     and e.series_id = target_series_id
     and e.club_id = acting_club_id;

  if not found then
    return jsonb_build_object('outcome', 'session_not_in_series');
  end if;

  if from_instant <= now() then
    return jsonb_build_object('outcome', 'occurrence_started');
  end if;

  if not exists (
    select 1
      from public.events e
     where e.series_id = target_series_id
       and e.starts_on < from_day
  ) then
    return jsonb_build_object(
      'outcome', 'edited',
      'series_id', target_series_id,
      'updated_occurrences',
      public.update_series(acting_club_id, target_series_id, changes)
    );
  end if;

  if not exists (
    select 1
      from public.events e
     where e.series_id = target_series_id
       and e.starts_on >= from_day
       and e.status = 'scheduled'
       and e.starts_at > now()
  ) then
    return jsonb_build_object(
      'outcome', 'edited',
      'series_id', target_series_id,
      'updated_occurrences', 0
    );
  end if;

  insert into public.event_series
    (club_id, title, event_type, start_time, end_time, location, place_name,
     place_address, place_lat, place_lng, place_detail, notes, audience,
     weekdays, starts_on, ends_on, author_id, cover_upload_id)
  select s.club_id, s.title, s.event_type, s.start_time, s.end_time,
         s.location, s.place_name, s.place_address, s.place_lat, s.place_lng,
         s.place_detail, s.notes, s.audience, s.weekdays, from_day, s.ends_on,
         s.author_id, s.cover_upload_id
    from public.event_series s
   where s.id = target_series_id
  returning id into new_series_id;

  insert into public.event_series_groups (series_id, group_id, club_id)
  select new_series_id, g.group_id, g.club_id
    from public.event_series_groups g
   where g.series_id = target_series_id;

  update public.events e
     set series_id = new_series_id
   where e.series_id = target_series_id
     and e.starts_on >= from_day;

  update public.event_series s
     set ends_on = from_day - 1
   where s.id = target_series_id;

  return jsonb_build_object(
    'outcome', 'split',
    'series_id', new_series_id,
    'updated_occurrences',
    public.update_series(acting_club_id, new_series_id, changes)
  );
end;
$$;

revoke all on function public.split_series(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.split_series(uuid, uuid, uuid, jsonb)
  to service_role;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea la función en cuanto se
-- aplica.
notify pgrst, 'reload schema';
