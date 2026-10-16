-- Cambiar los días y la fecha final al partir una serie (#654, RF-11 y D2 del
-- PRD de E24).
--
-- `split_series` (`0073_split_series.sql`) recibe un quinto argumento,
-- `schedule`. A `null` hace lo mismo que antes. Con él, después de partir y
-- antes de aplicar los cambios, `reschedule_series_sessions` deja la parte
-- nueva con sus días y su fecha final:
--
--   `weekdays` y `ends_on` pasan a la serie de la parte nueva;
--   las sesiones futuras sin cancelar desde la elegida que no caen en
--     `session_dates` se cancelan, sin borrarlas: sus respuestas y su
--     asistencia siguen ahí;
--   en `added_dates` (las fechas que la serie no tenía) se reactiva la
--     cancelada de esa fecha, con los campos y la audiencia de la serie, o
--     se crea una sesión nueva si no hay ninguna. Nunca dos el mismo día.
--
-- Una cancelada en una fecha que la serie ya tenía sigue cancelada: alguien
-- la canceló a propósito. Las fechas las calcula el servidor con
-- `generateWeeklyOccurrences`, la misma cuenta que al crear la serie; aquí
-- sólo se comprueba que caen en la parte nueva.
--
-- Las sesiones reactivadas y las nuevas quedan futuras y sin cancelar, así
-- que `update_series` les aplica los cambios con las demás. Todo va en la
-- transacción de la llamada: si algo falla, no queda nada cambiado.
--
-- Partir desde la primera sesión edita la serie entera con las mismas reglas,
-- y su inicio pasa a ser esa sesión: antes no tiene ninguna, y así la fecha
-- final nueva se cuenta desde ahí, como en el servidor.

-- Una función con otra firma sería otra función: la de cuatro argumentos se
-- quita para que no queden dos.
drop function if exists public.split_series(uuid, uuid, uuid, jsonb);

create or replace function public.reschedule_series_sessions(
  acting_club_id uuid,
  target_series_id uuid,
  from_day date,
  schedule jsonb
)
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  new_ends_on date := (schedule ->> 'ends_on')::date;
  session_dates date[] := array(
    select day::date
      from jsonb_array_elements_text(schedule -> 'session_dates') as day
  );
  added_dates date[] := array(
    select day::date
      from jsonb_array_elements_text(schedule -> 'added_dates') as day
  );
  cancelled_count integer;
  rejoined_event_ids uuid[];
begin
  if exists (
       select 1
         from unnest(session_dates) as day
        where day < from_day or day > new_ends_on
     )
     or not added_dates <@ session_dates then
    raise exception
      'reschedule_series_sessions: fechas fuera de la parte nueva (desde %, hasta %)',
      from_day, new_ends_on
      using errcode = '22023';
  end if;

  update public.event_series s
     set weekdays = array(
           select day::smallint
             from jsonb_array_elements_text(schedule -> 'weekdays') as day
         ),
         starts_on = from_day,
         ends_on = new_ends_on
   where s.id = target_series_id
     and s.club_id = acting_club_id;

  with cancelled as (
    update public.events e
       set status = 'cancelled',
           cancelled_at = now()
     where e.series_id = target_series_id
       and e.club_id = acting_club_id
       and e.starts_on >= from_day
       and e.status = 'scheduled'
       and e.starts_at > now()
       and e.starts_on <> all(session_dates)
    returning e.id
  )
  select count(*) into cancelled_count from cancelled;

  with reactivated as (
    update public.events e
       set status = 'scheduled',
           cancelled_at = null,
           title = s.title,
           event_type = s.event_type,
           start_time = s.start_time,
           end_time = s.end_time,
           ends_on = null,
           location = s.location,
           place_name = s.place_name,
           place_address = s.place_address,
           place_lat = s.place_lat,
           place_lng = s.place_lng,
           place_detail = s.place_detail,
           notes = s.notes,
           audience = s.audience,
           cover_upload_id = s.cover_upload_id,
           cover_overridden = false
      from public.event_series s
     where s.id = target_series_id
       and e.series_id = s.id
       and e.club_id = acting_club_id
       and e.status = 'cancelled'
       and e.starts_on = any(added_dates)
    returning e.id
  ),
  created as (
    insert into public.events
      (club_id, title, event_type, starts_on, start_time, end_time,
       location, place_name, place_address, place_lat, place_lng,
       place_detail, notes, audience, cover_upload_id, series_id, author_id)
    select s.club_id, s.title, s.event_type, day, s.start_time, s.end_time,
           s.location, s.place_name, s.place_address, s.place_lat,
           s.place_lng, s.place_detail, s.notes, s.audience,
           s.cover_upload_id, s.id, s.author_id
      from public.event_series s
     cross join unnest(added_dates) as day
     where s.id = target_series_id
       and not exists (
             select 1
               from public.events e
              where e.series_id = s.id
                and e.starts_on = day
           )
    returning id
  )
  select coalesce(array_agg(id), '{}') into rejoined_event_ids
    from (select id from reactivated union all select id from created) ids;

  -- Cada sesión lleva su copia de la audiencia (`0034_events.sql`): las que
  -- vuelven o nacen toman la de la serie.
  delete from public.event_groups
   where event_id = any(rejoined_event_ids);
  insert into public.event_groups (event_id, group_id, club_id)
  select rejoined.id, g.group_id, g.club_id
    from unnest(rejoined_event_ids) as rejoined(id)
   cross join public.event_series_groups g
   where g.series_id = target_series_id;

  return cancelled_count;
end;
$$;

-- Sólo la llama `split_series`, que corre como su dueño.
revoke all on function public.reschedule_series_sessions(uuid, uuid, date, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.split_series(
  acting_club_id uuid,
  target_series_id uuid,
  from_event_id uuid,
  changes jsonb,
  schedule jsonb default null
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
  working_series_id uuid;
  outcome text;
  cancelled_count integer := 0;
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
    outcome := 'edited';
    working_series_id := target_series_id;
  else
    -- Sin sesiones por cambiar ni fechas por añadir no se parte nada.
    if not exists (
         select 1
           from public.events e
          where e.series_id = target_series_id
            and e.starts_on >= from_day
            and e.status = 'scheduled'
            and e.starts_at > now()
       )
       and jsonb_array_length(
             coalesce(schedule -> 'added_dates', '[]'::jsonb)
           ) = 0 then
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
    returning id into working_series_id;

    insert into public.event_series_groups (series_id, group_id, club_id)
    select working_series_id, g.group_id, g.club_id
      from public.event_series_groups g
     where g.series_id = target_series_id;

    update public.events e
       set series_id = working_series_id
     where e.series_id = target_series_id
       and e.starts_on >= from_day;

    update public.event_series s
       set ends_on = from_day - 1
     where s.id = target_series_id;

    outcome := 'split';
  end if;

  if schedule is not null then
    cancelled_count := public.reschedule_series_sessions(
      acting_club_id, working_series_id, from_day, schedule
    );
  end if;

  return jsonb_build_object(
    'outcome', outcome,
    'series_id', working_series_id,
    'updated_occurrences',
    cancelled_count
      + public.update_series(acting_club_id, working_series_id, changes)
  );
end;
$$;

revoke all on function public.split_series(uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.split_series(uuid, uuid, uuid, jsonb, jsonb)
  to service_role;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea la función en cuanto se
-- aplica.
notify pgrst, 'reload schema';
