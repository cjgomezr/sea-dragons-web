-- Crear un evento suelto o una serie semanal con todas sus ocurrencias (issue
-- #307, RF-2 y RF-3 de `docs/prd/e7-calendario-eventos-rsvp.md`).
--
-- Una serie de un año son hasta 366 ocurrencias, cada una con su copia de la
-- audiencia, más la serie y la suya. Hecho con escrituras sueltas por
-- PostgREST, un fallo a medias dejaría una temporada partida. Aquí va todo en
-- una función, y cualquier error la deshace entera. Un evento suelto pasa por
-- el mismo camino: es una sola fecha y ninguna serie.
--
-- Las fechas llegan ya calculadas. Qué días salen, cuáles ya pasaron y los
-- límites del rango los decide el servidor (`src/lib/events/`), que es quien
-- sabe qué hora es en Melbourne. Esta función sólo escribe, y las `check` y
-- las claves compuestas de `0034_events.sql` siguen siendo la última barrera:
-- un grupo de otro club o un título vacío hacen fallar la llamada entera.
--
-- `schedule` es un objeto con `title`, `event_type`, `start_time`,
-- `location`, `notes`, `audience` (`all` o `groups`), `group_ids`,
-- `occurrence_dates` y `series`, que es nulo en un evento suelto o
-- `{ weekdays, starts_on, ends_on }` en una serie. Devuelve el id de la serie
-- (nulo en un evento suelto) y los de las ocurrencias, en el orden de sus
-- fechas.
--
-- `security definer` y sólo `service_role`, como `0032`: el servidor ya
-- comprobó que quien llama puede crear eventos (`createEvents`) y pasa su
-- club, que sale de su fila de `members` y nunca del cuerpo de la petición.
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
  if jsonb_array_length(schedule -> 'occurrence_dates') = 0 then
    raise exception 'un evento necesita al menos una fecha'
      using errcode = 'invalid_parameter_value';
  end if;

  if series is not null then
    insert into public.event_series
      (club_id, title, event_type, start_time, location, notes, audience,
       weekdays, starts_on, ends_on, author_id)
    values (
      acting_club_id,
      schedule ->> 'title',
      schedule ->> 'event_type',
      (schedule ->> 'start_time')::time,
      schedule ->> 'location',
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
      (club_id, title, event_type, starts_on, start_time, location, notes,
       audience, series_id, author_id)
    select acting_club_id,
           schedule ->> 'title',
           schedule ->> 'event_type',
           occurrence.day::date,
           (schedule ->> 'start_time')::time,
           schedule ->> 'location',
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

-- Postgres concede `execute` a PUBLIC en toda función nueva, y el
-- `pg_default_acl` de Supabase además a `anon` y `authenticated`. Abierta a
-- ellos, cualquier socio podría publicar en el calendario llamándola por
-- PostgREST, así que sólo el servidor la ejecuta.
revoke all on function public.create_events(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_events(uuid, uuid, jsonb)
  to service_role;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea la función en cuanto se
-- aplica, aunque faltara el event trigger que recarga su caché.
notify pgrst, 'reload schema';
