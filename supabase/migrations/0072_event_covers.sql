-- La imagen de eventos y series (issue #644, RF-3 y D7 de
-- `docs/prd/e24-rediseno-calendario.md`).
--
-- Como la portada de noticias (`0063_news_post_covers.sql`): cada imagen
-- subida es una fila de `event_cover_uploads`, y eventos y series la apuntan
-- con `cover_upload_id`. Sus ficheros son dos WebP en el bucket privado
-- `event-covers`, en `<club_id>/<id>-thumb.webp` y `<club_id>/<id>-large.webp`:
-- la ruta se deduce del club y del id, así que la fila no la guarda. El
-- original subido no se guarda nunca.
--
-- A diferencia de una portada, una imagen la comparten muchas filas: la serie
-- y todas sus sesiones apuntan a la misma. Por eso no hay índice único.
--
-- La fila nace al subir, antes de que exista el evento, para que el servidor
-- compruebe al enlazarla que es del club y de alguien que organiza eventos.
-- Si se borra la ficha de quien la subió, la imagen sigue: los eventos que la
-- usan no tienen por qué perderla.
--
-- Nadie la toca con su sesión, como el bucket: ni la tabla ni los ficheros
-- tienen policy para `authenticated`. Quién recibe la dirección firmada lo
-- decide el servidor con la audiencia del evento.
--
-- La herencia se copia al escribir, como el resto de los campos de una serie
-- (`0034_events.sql`): crear da la imagen a la serie y a cada sesión, y
-- editar la serie la pasa a sus sesiones futuras. Las sesiones a las que se
-- les cambió o quitó la imagen solas (`cover_overridden`) se quedan con la
-- suya.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-covers',
  'event-covers',
  false,
  -- El tope de la subida (`NEWS_COVER_MAX_BYTES`): lo que se guarda, ya
  -- reducido, pesa mucho menos.
  10485760,
  array['image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.event_cover_uploads (
  -- Sin valor por defecto: el id es también el nombre de sus ficheros, y lo
  -- elige el servidor antes de subirlos.
  id uuid primary key,
  club_id uuid not null references public.clubs (id),
  -- Nula si se borró la ficha de quien la subió.
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  -- El destino de las claves compuestas de `events` y `event_series`: un
  -- evento no puede apuntar a la imagen de otro club.
  constraint event_cover_uploads_id_club_id_key unique (id, club_id),
  constraint event_cover_uploads_uploader_same_club_fkey
    foreign key (uploaded_by, club_id)
    references public.members (user_id, club_id)
    on delete set null (uploaded_by)
);

-- Borrar una ficha busca sus subidas por quien las subió.
create index if not exists event_cover_uploads_uploaded_by_idx
  on public.event_cover_uploads (uploaded_by);

alter table public.event_cover_uploads enable row level security;

revoke all on public.event_cover_uploads from anon, authenticated;
grant select, insert, delete on public.event_cover_uploads to service_role;

alter table public.events
  add column if not exists cover_upload_id uuid,
  add column if not exists cover_overridden boolean not null default false;

alter table public.event_series
  add column if not exists cover_upload_id uuid;

-- `do` porque `add constraint` no admite `if not exists`, y producción
-- reaplica el histórico entero en cada merge.
do $$
declare
  target text;
begin
  foreach target in array array['events', 'event_series'] loop
    if not exists (
      select 1 from pg_constraint
       where conname = target || '_cover_same_club_fkey'
         and conrelid = ('public.' || target)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key '
        '(cover_upload_id, club_id) references '
        'public.event_cover_uploads (id, club_id)',
        target, target || '_cover_same_club_fkey'
      );
    end if;
  end loop;
end;
$$;

-- Sirven a las claves foráneas al borrar una subida.
create index if not exists events_cover_upload_id_idx
  on public.events (cover_upload_id)
  where cover_upload_id is not null;
create index if not exists event_series_cover_upload_id_idx
  on public.event_series (cover_upload_id)
  where cover_upload_id is not null;

-- Lo mismo que `0069_event_places.sql`, más la imagen.
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
       audience, cover_upload_id, weekdays, starts_on, ends_on, author_id)
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
      (schedule ->> 'cover_upload_id')::uuid,
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
       place_detail, notes, audience, cover_upload_id, series_id, author_id)
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
           (schedule ->> 'cover_upload_id')::uuid,
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

-- Lo mismo que `0069_event_places.sql`, más la imagen. Cambiarla en una
-- sesión de una serie la marca: desde entonces editar la serie no se la toca.
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
                         then changes ->> 'audience' else e.audience end,
         cover_upload_id = case when changes ? 'cover_upload_id'
                                then (changes ->> 'cover_upload_id')::uuid
                                else e.cover_upload_id end,
         cover_overridden = e.cover_overridden
                            or (changes ? 'cover_upload_id'
                                and e.series_id is not null)
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

-- Lo mismo que `0069_event_places.sql`, más la imagen, que pasa a las
-- sesiones futuras salvo a las que la cambiaron solas.
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
                           then changes ->> 'audience' else e.audience end,
           cover_upload_id = case when changes ? 'cover_upload_id'
                                       and not e.cover_overridden
                                  then (changes ->> 'cover_upload_id')::uuid
                                  else e.cover_upload_id end
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
                         then changes ->> 'audience' else s.audience end,
         cover_upload_id = case when changes ? 'cover_upload_id'
                                then (changes ->> 'cover_upload_id')::uuid
                                else s.cover_upload_id end
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

-- `create or replace` conserva los privilegios, pero se repiten para que
-- este archivo diga solo quién ejecuta lo que define, como en `0069`.
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

-- Como en `0008_sonda_salud.sql`: que PostgREST vea las columnas en cuanto
-- se aplica.
notify pgrst, 'reload schema';
