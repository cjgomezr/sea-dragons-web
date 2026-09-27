-- Los eventos del club, sus series semanales y su audiencia (issue #306, RF-1
-- y RF-4 de `docs/prd/e7-calendario-eventos-rsvp.md`). Aquí sólo se guardan:
-- crear, editar, el calendario y el RSVP llegan en sus propios tickets.
--
-- La regla que no puede depender de que la aplicación se porte bien es la de
-- lectura: un miembro sólo recibe, aunque llame a la base directamente, los
-- eventos de su club dirigidos a él (AC-050, AC-052). Admin y Committee ven
-- todos por la API con la llave de servicio, no por una policy.
--
-- La audiencia sigue el modelo de `0029_news_posts.sql`: una columna dice si va
-- a todo el club o a grupos, y una tabla aparte lista los grupos. Hay una para
-- los eventos y otra para las series, porque una ocurrencia guarda su propia
-- copia de los campos de la serie para poder editarla sola (RF-11).

-- Días de la semana de una serie: entre uno y siete, del 1 (lunes) al 7
-- (domingo, ISO 8601, como `extract(isodow ...)`), sin repetir ni nulos. Un
-- `check` no admite subconsultas, así que la cuenta vive en una función.
create or replace function public.are_valid_weekdays(weekdays smallint[])
  returns boolean
  language sql
  immutable
  set search_path = ''
as $$
  select cardinality(weekdays) between 1 and 7
     and array_position(weekdays, null) is null
     and weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
     and (select count(distinct day) from unnest(weekdays) day)
         = cardinality(weekdays)
$$;

-- Sólo la usa el `check`, y sólo escribe el servidor.
revoke all on function public.are_valid_weekdays(smallint[])
  from public, anon, authenticated;
grant execute on function public.are_valid_weekdays(smallint[])
  to service_role;

-- Los campos que una serie comparte con sus ocurrencias llevan las mismas
-- reglas en las dos tablas. Como en `groups`, los largos se miden sobre el
-- texto recortado: un título de solo espacios cuenta como vacío. El servidor
-- exporta las mismas cifras para su formulario; aquí es la última barrera.
create table if not exists public.event_series (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id),
  title text not null
    constraint event_series_title_length
    check (char_length(btrim(title)) between 1 and 80),
  event_type text not null
    constraint event_series_event_type_check
    check (event_type in ('training', 'competition', 'meeting', 'social')),
  -- Hora de Melbourne: cada ocurrencia la combina con su fecha, y por eso la
  -- sesión de las 19:00 sigue a las 19:00 al cruzar un cambio de horario.
  start_time time not null,
  location text not null
    constraint event_series_location_length
    check (char_length(btrim(location)) between 1 and 120),
  notes text
    constraint event_series_notes_length
    check (char_length(notes) <= 2000),
  -- `all` no necesita filas en `event_series_groups`; `groups` sin filas se
  -- guarda igual y no alcanza a nadie. Que crear con cero grupos sea un error
  -- lo decide el servidor: borrar un grupo puede dejar una serie así.
  audience text not null
    constraint event_series_audience_check
    check (audience in ('all', 'groups')),
  weekdays smallint[] not null
    constraint event_series_weekdays_check
    check (public.are_valid_weekdays(weekdays)),
  starts_on date not null,
  ends_on date not null,
  author_id uuid not null,
  created_at timestamptz not null default now(),
  -- Una serie de un año de lunes a domingo son 366 ocurrencias, el máximo que
  -- el PRD admite (sección 7).
  constraint event_series_date_range
    check (
      ends_on >= starts_on
      and ends_on <= (starts_on + interval '1 year')::date
    ),
  -- El destino de las claves compuestas de las ocurrencias y de la audiencia.
  constraint event_series_id_club_id_key unique (id, club_id),
  -- Como en `news_posts`: el autor es socio del mismo club, y sin `on delete`
  -- quien deja el club pasa a `inactive` y lo que creó sigue con su nombre.
  constraint event_series_author_same_club_fkey
    foreign key (author_id, club_id)
    references public.members (user_id, club_id)
);

create index if not exists event_series_author_id_club_id_idx
  on public.event_series (author_id, club_id);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id),
  title text not null
    constraint events_title_length
    check (char_length(btrim(title)) between 1 and 80),
  event_type text not null
    constraint events_event_type_check
    check (event_type in ('training', 'competition', 'meeting', 'social')),
  -- Fecha y hora de Melbourne, como las escribe quien crea el evento.
  starts_on date not null,
  start_time time not null,
  -- El instante que las dos nombran, para ordenar y comparar con `now()`. Es
  -- derivado para que no pueda contradecirlas, y se calcula en la zona del
  -- club, como `members.joined_on` (NFR-003): a ambos lados de un cambio de
  -- horario, las 19:00 siguen siendo las 19:00 de Melbourne.
  starts_at timestamptz
    generated always as (
      (starts_on + start_time) at time zone 'Australia/Melbourne'
    ) stored,
  location text not null
    constraint events_location_length
    check (char_length(btrim(location)) between 1 and 120),
  notes text
    constraint events_notes_length
    check (char_length(notes) <= 2000),
  audience text not null
    constraint events_audience_check
    check (audience in ('all', 'groups')),
  -- Cancelar marca, no borra: E8 conserva el historial (PRD, sección 9).
  status text not null default 'scheduled'
    constraint events_status_check
    check (status in ('scheduled', 'cancelled')),
  cancelled_at timestamptz,
  -- Nula en un evento suelto.
  series_id uuid,
  author_id uuid not null,
  created_at timestamptz not null default now(),
  constraint events_cancelled_at_matches_status
    check ((status = 'cancelled') = (cancelled_at is not null)),
  -- El destino de la clave compuesta de la audiencia.
  constraint events_id_club_id_key unique (id, club_id),
  -- Una ocurrencia sólo puede ser de una serie de su mismo club. Sin
  -- `on delete`: una serie se cancela, no se borra.
  constraint events_series_same_club_fkey
    foreign key (series_id, club_id)
    references public.event_series (id, club_id),
  constraint events_author_same_club_fkey
    foreign key (author_id, club_id)
    references public.members (user_id, club_id)
);

-- El calendario: los de un club, por orden de inicio.
create index if not exists events_club_id_starts_at_idx
  on public.events (club_id, starts_at);

-- Las ocurrencias de una serie, para editarla o cancelarla entera (RF-12).
create index if not exists events_series_id_idx
  on public.events (series_id);

create index if not exists events_author_id_club_id_idx
  on public.events (author_id, club_id);

-- Las dos tablas de audiencia son la de `news_post_groups`: el `club_id`
-- redundante a propósito, atado por dos claves compuestas al club del evento y
-- al del grupo, es lo que impide dirigir un evento a un grupo ajeno sin un
-- trigger. Borrar un grupo quita su fila y el evento se queda (PRD, sección 7).
create table if not exists public.event_groups (
  event_id uuid not null,
  group_id uuid not null,
  club_id uuid not null references public.clubs (id),
  constraint event_groups_pkey primary key (event_id, group_id),
  constraint event_groups_event_same_club_fkey
    foreign key (event_id, club_id)
    references public.events (id, club_id) on delete cascade,
  constraint event_groups_group_same_club_fkey
    foreign key (group_id, club_id)
    references public.groups (id, club_id) on delete cascade
);

create index if not exists event_groups_group_id_idx
  on public.event_groups (group_id);

create table if not exists public.event_series_groups (
  series_id uuid not null,
  group_id uuid not null,
  club_id uuid not null references public.clubs (id),
  constraint event_series_groups_pkey primary key (series_id, group_id),
  constraint event_series_groups_series_same_club_fkey
    foreign key (series_id, club_id)
    references public.event_series (id, club_id) on delete cascade,
  constraint event_series_groups_group_same_club_fkey
    foreign key (group_id, club_id)
    references public.groups (id, club_id) on delete cascade
);

create index if not exists event_series_groups_group_id_idx
  on public.event_series_groups (group_id);

alter table public.events enable row level security;
alter table public.event_groups enable row level security;
alter table public.event_series enable row level security;
alter table public.event_series_groups enable row level security;

-- Un miembro que no es `inactive` ve los eventos de su club, cancelados
-- incluidos, que van a todo el club o a alguno de sus grupos. La audiencia se
-- resuelve al leer: quien entra en un grupo ve lo que ya estaba programado.
--
-- Como en `news_posts_select_audience`: la subconsulta de `members` pasa por
-- `members_select_own` y sólo encuentra la fila propia, y la de `event_groups`
-- pasa por la policy de abajo, que sólo deja ver las filas de los grupos
-- propios. Eso basta a `is_member_in_groups`, que ya excluye a los `inactive`.
drop policy if exists events_select_audience on public.events;
create policy events_select_audience
  on public.events
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.members m
       where m.user_id = (select auth.uid())
         and m.club_id = events.club_id
         and m.account_status <> 'inactive'
    )
    and (
      audience = 'all'
      or public.is_member_in_groups(
        (select auth.uid()),
        array(
          select eg.group_id
            from public.event_groups eg
           where eg.event_id = events.id
        )
      )
    )
  );

-- La misma regla para las series.
drop policy if exists event_series_select_audience on public.event_series;
create policy event_series_select_audience
  on public.event_series
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.members m
       where m.user_id = (select auth.uid())
         and m.club_id = event_series.club_id
         and m.account_status <> 'inactive'
    )
    and (
      audience = 'all'
      or public.is_member_in_groups(
        (select auth.uid()),
        array(
          select esg.group_id
            from public.event_series_groups esg
           where esg.series_id = event_series.id
        )
      )
    )
  );

-- Un miembro ve las filas de audiencia de sus grupos y ninguna más. No miran el
-- evento ni la serie: hacerlo cerraría un ciclo entre las policies. Lo que
-- dejan ver es que algo iba a un grupo suyo, y eso ya lo sabe su audiencia.
drop policy if exists event_groups_select_own_groups on public.event_groups;
create policy event_groups_select_own_groups
  on public.event_groups
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.group_memberships gm
       where gm.group_id = event_groups.group_id
         and gm.user_id = (select auth.uid())
    )
  );

drop policy if exists event_series_groups_select_own_groups
  on public.event_series_groups;
create policy event_series_groups_select_own_groups
  on public.event_series_groups
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.group_memberships gm
       where gm.group_id = event_series_groups.group_id
         and gm.user_id = (select auth.uid())
    )
  );

-- Revocar primero, como en `0015_groups.sql`: el proyecto concede todo a
-- `anon` y `authenticated` sobre cada tabla nueva, y RLS no filtra
-- `truncate`. Crear y editar pasa por el servidor, que comprueba el rol y
-- escribe con la llave de servicio.
revoke all on public.events from anon, authenticated;
grant select on public.events to authenticated;
grant select, insert, update, delete on public.events to service_role;

revoke all on public.event_groups from anon, authenticated;
grant select on public.event_groups to authenticated;
grant select, insert, update, delete on public.event_groups to service_role;

revoke all on public.event_series from anon, authenticated;
grant select on public.event_series to authenticated;
grant select, insert, update, delete on public.event_series to service_role;

revoke all on public.event_series_groups from anon, authenticated;
grant select on public.event_series_groups to authenticated;
grant select, insert, update, delete on public.event_series_groups
  to service_role;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea las tablas en cuanto se
-- aplica, aunque faltara el event trigger que recarga su caché.
notify pgrst, 'reload schema';
