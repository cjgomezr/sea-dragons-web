-- El lugar estructurado de eventos y series (issue #645, RF-4 de
-- `docs/prd/e24-rediseno-calendario.md`).
--
-- Un lugar elegido del buscador guarda su nombre, su dirección y sus
-- coordenadas, y aparte "dónde exactamente" (la piscina, la sala). Las cinco
-- columnas son nulas: lo anterior a E24 y lo que sólo trae texto libre no las
-- tienen. `location` no cambia y sigue guardando el texto que se enseña, que
-- con un lugar elegido es su nombre. Que el nombre no venga en blanco y que
-- las coordenadas vayan las dos o ninguna lo decide también el servidor
-- (`src/lib/events/`); los `check` son la red por debajo.
--
-- `create_events`, `update_event` y `update_series`, en su versión de `0068`,
-- se amplían con `create or replace` para leer las claves `place_name`,
-- `place_address`, `place_lat`, `place_lng` y `place_detail` en `schedule` y
-- en `changes`. Una clave que no viene deja la columna como estaba; a `null`,
-- la vacía. Cada sesión de una serie recibe el lugar de la serie al crearla y
-- cuando la serie cambia de lugar.
alter table public.events
  add column if not exists place_name text,
  add column if not exists place_address text,
  add column if not exists place_lat double precision,
  add column if not exists place_lng double precision,
  add column if not exists place_detail text;

alter table public.event_series
  add column if not exists place_name text,
  add column if not exists place_address text,
  add column if not exists place_lat double precision,
  add column if not exists place_lng double precision,
  add column if not exists place_detail text;

-- Los mismos topes que `src/lib/events/event-place.ts`. Con guarda, como
-- `0067`: producción reaplica el histórico entero en cada merge.
do $$
declare
  target text;
  rule record;
begin
  foreach target in array array['events', 'event_series'] loop
    for rule in
      select *
        from (values
          ('place_name_length',
           'char_length(btrim(place_name)) between 1 and 120'),
          ('place_address_length', 'char_length(place_address) <= 200'),
          ('place_detail_length', 'char_length(place_detail) <= 120'),
          ('place_lat_range', 'place_lat between -90 and 90'),
          ('place_lng_range', 'place_lng between -180 and 180'),
          ('place_coordinates_pair',
           '(place_lat is null) = (place_lng is null)')
        ) as rules(suffix, expression)
    loop
      if not exists (
        select 1 from pg_constraint
         where conname = target || '_' || rule.suffix
           and conrelid = ('public.' || target)::regclass
      ) then
        execute format(
          'alter table public.%I add constraint %I check (%s)',
          target, target || '_' || rule.suffix, rule.expression
        );
      end if;
    end loop;
  end loop;
end;
$$;

-- Lo mismo que `0068_event_end_times.sql`, más el lugar.
create or replace function public.create_events(
  acting_club_id uuid,
  acting_user_id uuid,
  schedule jsonb
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  series jsonb := nullif(schedule -> 'series', 'null'::jsonb);
  new_series_id uuid;
  new_event_ids uuid[];
begin
  -- Sin la clave, `jsonb_array_length` da nulo: cuenta como ninguna fecha.
  if coalesce(jsonb_array_length(schedule -> 'occurrence_dates'), 0) = 0 then
    raise exception 'un evento necesita al menos una fecha'
      using errcode = 'invalid_parameter_value';
  end if;

  if series is not null then
    insert into public.event_series
      (club_id, title, event_type, start_time, end_time, location,
       place_name, place_address, place_lat, place_lng, place_detail, notes,
       audience, weekdays, starts_on, ends_on, author_id)
    values (
      acting_club_id,
      schedule ->> 'title',
      schedule ->> 'event_type',
      (schedule ->> 'start_time')::time,
      (schedule ->> 'end_time')::time,
      schedule ->> 'location',
      schedule ->> 'place_name',
      schedule ->> 'place_address',
      (schedule ->> 'place_lat')::double precision,
      (schedule ->> 'place_lng')::double precision,
      schedule ->> 'place_detail',
      schedule ->> 'notes',
      schedule ->> 'audience',
      array(
        select day::smallint
          from jsonb_array_elements_text(series -> 'weekdays') day
      ),
      (series ->> 'starts_on')::date,
      (series ->> 'ends_on')::date,
      acting_user_id
    )
    returning id into new_series_id;
  end if;

  with inserted as (
    insert into public.events
      (club_id, title, event_type, starts_on, start_time, end_time, ends_on,
       location, place_name, place_address, place_lat, place_lng,
       place_detail, notes, audience, series_id, author_id)
    select acting_club_id,
           schedule ->> 'title',
           schedule ->> 'event_type',
           occurrence.day::date,
           (schedule ->> 'start_time')::time,
           (schedule ->> 'end_time')::time,
           -- Las sesiones de una serie son de un día (D6).
           case when series is null
                then (schedule ->> 'ends_on')::date end,
           schedule ->> 'location',
           schedule ->> 'place_name',
           schedule ->> 'place_address',
           (schedule ->> 'place_lat')::double precision,
           (schedule ->> 'place_lng')::double precision,
           schedule ->> 'place_detail',
           schedule ->> 'notes',
           schedule ->> 'audience',
           new_series_id,
           acting_user_id
      from jsonb_array_elements_text(schedule -> 'occurrence_dates')
           as occurrence(day)
    returning id, starts_on
  )
  select array_agg(inserted.id order by inserted.starts_on)
    into new_event_ids
    from inserted;

  -- Cada ocurrencia lleva su propia copia de la audiencia, porque se puede
  -- editar sola (RF-11) y la lectura la resuelve fila a fila (RLS).
  insert into public.event_groups (event_id, group_id, club_id)
  select event_id, group_id::uuid, acting_club_id
    from unnest(new_event_ids) as event_id
         cross join jsonb_array_elements_text(schedule -> 'group_ids')
           as target(group_id);

  if new_series_id is not null then
    insert into public.event_series_groups (series_id, group_id, club_id)
    select new_series_id, group_id::uuid, acting_club_id
      from jsonb_array_elements_text(schedule -> 'group_ids')
           as target(group_id);
  end if;

  return jsonb_build_object(
    'series_id', new_series_id,
    'event_ids', to_jsonb(new_event_ids)
  );
end;
$$;

-- Lo mismo que `0068_event_end_times.sql`, más el lugar.
create or replace function public.update_event(
  acting_club_id uuid,
  target_event_id uuid,
  changes jsonb
)
  returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  update public.events e
     set title = case when changes ? 'title'
                      then changes ->> 'title' else e.title end,
         event_type = case when changes ? 'event_type'
                           then changes ->> 'event_type' else e.event_type end,
         starts_on = case when changes ? 'starts_on'
                          then (changes ->> 'starts_on')::date
                          else e.starts_on end,
         start_time = case when changes ? 'start_time'
                           then (changes ->> 'start_time')::time
                           else e.start_time end,
         end_time = case when changes ? 'end_time'
                         then (changes ->> 'end_time')::time
                         else e.end_time end,
         ends_on = case when changes ? 'ends_on'
                        then (changes ->> 'ends_on')::date
                        else e.ends_on end,
         location = case when changes ? 'location'
                         then changes ->> 'location' else e.location end,
         place_name = case when changes ? 'place_name'
                             then changes ->> 'place_name'
                             else e.place_name end,
         place_address = case when changes ? 'place_address'
                                then changes ->> 'place_address'
                                else e.place_address end,
         place_lat = case when changes ? 'place_lat'
                            then (changes ->> 'place_lat')::double precision
                            else e.place_lat end,
         place_lng = case when changes ? 'place_lng'
                            then (changes ->> 'place_lng')::double precision
                            else e.place_lng end,
         place_detail = case when changes ? 'place_detail'
                               then changes ->> 'place_detail'
                               else e.place_detail end,
         notes = case when changes ? 'notes'
                      then changes ->> 'notes' else e.notes end,
         audience = case when changes ? 'audience'
                         then changes ->> 'audience' else e.audience end
   where e.id = target_event_id
     and e.club_id = acting_club_id
     and e.status = 'scheduled'
     and e.starts_at > now();

  if not found then
    return false;
  end if;

  if changes ? 'audience' then
    delete from public.event_groups where event_id = target_event_id;
    insert into public.event_groups (event_id, group_id, club_id)
    select target_event_id, group_id::uuid, acting_club_id
      from jsonb_array_elements_text(
             coalesce(changes -> 'group_ids', '[]'::jsonb)
           ) as target(group_id);
  end if;

  return true;
end;
$$;

-- Lo mismo que `0068_event_end_times.sql`, más el lugar, que pasa a las
-- sesiones futuras igual que el resto de los campos.
create or replace function public.update_series(
  acting_club_id uuid,
  target_series_id uuid,
  changes jsonb
)
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  updated_event_ids uuid[];
begin
  -- Serializa las ediciones de una misma serie antes de elegir ocurrencias.
  perform 1
     from public.event_series s
    where s.id = target_series_id
      and s.club_id = acting_club_id
      for update;

  if not found then
    return 0;
  end if;

  with updated as (
    update public.events e
       set title = case when changes ? 'title'
                        then changes ->> 'title' else e.title end,
           event_type = case when changes ? 'event_type'
                             then changes ->> 'event_type'
                             else e.event_type end,
           start_time = case when changes ? 'start_time'
                             then (changes ->> 'start_time')::time
                             else e.start_time end,
           end_time = case when changes ? 'end_time'
                           then (changes ->> 'end_time')::time
                           else e.end_time end,
           location = case when changes ? 'location'
                           then changes ->> 'location' else e.location end,
           place_name = case when changes ? 'place_name'
                               then changes ->> 'place_name'
                               else e.place_name end,
           place_address = case when changes ? 'place_address'
                                  then changes ->> 'place_address'
                                  else e.place_address end,
           place_lat = case when changes ? 'place_lat'
                              then (changes ->> 'place_lat')::double precision
                              else e.place_lat end,
           place_lng = case when changes ? 'place_lng'
                              then (changes ->> 'place_lng')::double precision
                              else e.place_lng end,
           place_detail = case when changes ? 'place_detail'
                                 then changes ->> 'place_detail'
                                 else e.place_detail end,
           notes = case when changes ? 'notes'
                        then changes ->> 'notes' else e.notes end,
           audience = case when changes ? 'audience'
                           then changes ->> 'audience' else e.audience end
     where e.series_id = target_series_id
       and e.club_id = acting_club_id
       and e.status = 'scheduled'
       and e.starts_at > now()
    returning e.id
  )
  select coalesce(array_agg(id), '{}') into updated_event_ids from updated;

  if cardinality(updated_event_ids) = 0 then
    return 0;
  end if;

  update public.event_series s
     set title = case when changes ? 'title'
                      then changes ->> 'title' else s.title end,
         event_type = case when changes ? 'event_type'
                           then changes ->> 'event_type' else s.event_type end,
         start_time = case when changes ? 'start_time'
                           then (changes ->> 'start_time')::time
                           else s.start_time end,
         end_time = case when changes ? 'end_time'
                         then (changes ->> 'end_time')::time
                         else s.end_time end,
         location = case when changes ? 'location'
                         then changes ->> 'location' else s.location end,
         place_name = case when changes ? 'place_name'
                             then changes ->> 'place_name'
                             else s.place_name end,
         place_address = case when changes ? 'place_address'
                                then changes ->> 'place_address'
                                else s.place_address end,
         place_lat = case when changes ? 'place_lat'
                            then (changes ->> 'place_lat')::double precision
                            else s.place_lat end,
         place_lng = case when changes ? 'place_lng'
                            then (changes ->> 'place_lng')::double precision
                            else s.place_lng end,
         place_detail = case when changes ? 'place_detail'
                               then changes ->> 'place_detail'
                               else s.place_detail end,
         notes = case when changes ? 'notes'
                      then changes ->> 'notes' else s.notes end,
         audience = case when changes ? 'audience'
                         then changes ->> 'audience' else s.audience end
   where s.id = target_series_id
     and s.club_id = acting_club_id;

  if changes ? 'audience' then
    delete from public.event_series_groups
     where series_id = target_series_id;
    insert into public.event_series_groups (series_id, group_id, club_id)
    select target_series_id, target.group_id::uuid, acting_club_id
      from jsonb_array_elements_text(
             coalesce(changes -> 'group_ids', '[]'::jsonb)
           ) as target(group_id);

    delete from public.event_groups
     where event_id = any(updated_event_ids);
    insert into public.event_groups (event_id, group_id, club_id)
    select occurrence.id, target.group_id::uuid, acting_club_id
      from unnest(updated_event_ids) as occurrence(id)
     cross join jsonb_array_elements_text(
             coalesce(changes -> 'group_ids', '[]'::jsonb)
           ) as target(group_id);
  end if;

  return cardinality(updated_event_ids);
end;
$$;

-- `create or replace` conserva los privilegios de `0036`, `0040` y `0041`,
-- pero se repiten para que este archivo diga solo quién ejecuta lo que
-- define: abiertas a `anon` o `authenticated`, cualquier socio podría cambiar
-- el calendario llamándolas por PostgREST.
revoke all on function public.create_events(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_events(uuid, uuid, jsonb)
  to service_role;
revoke all on function public.update_event(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.update_event(uuid, uuid, jsonb)
  to service_role;
revoke all on function public.update_series(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.update_series(uuid, uuid, jsonb)
  to service_role;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea las columnas y las
-- funciones en cuanto se aplica, aunque faltara el event trigger que recarga
-- su caché.
notify pgrst, 'reload schema';
