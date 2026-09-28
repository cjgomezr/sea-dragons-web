-- El reparto de equipos de cada evento y la función de cada posición (issue
-- #399, RF-1 y RF-2 de `docs/prd/e10-team-builder.md`, FR-046 a FR-049).
--
-- Un reparto por evento: dos equipos con nombre y color, el modo, si está
-- publicado y a qué equipo va cada jugador. Quién arma los equipos (Admin o
-- Coach) y con quién (la escuadra del evento) lo decide el servidor antes de
-- escribir, con la llave de servicio. Lo que la base afirma sola es la forma,
-- el club, las cascadas y quién lee un reparto publicado.
--
-- Los nombres y colores por defecto ("Team Kelp" azul, "Team Tide" amarillo,
-- D5) viven en el dominio, no aquí: la base sólo guarda los de cada evento.

create table if not exists public.team_splits (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  club_id uuid not null references public.clubs (id),
  -- El largo se mide recortado, como los nombres de las posiciones (`0025`).
  team_a_name text not null
    constraint team_splits_team_a_name_length
    check (char_length(btrim(team_a_name)) between 1 and 40),
  team_a_color text not null
    constraint team_splits_team_a_color_check
    check (team_a_color ~ '^#[0-9a-fA-F]{6}$'),
  team_b_name text not null
    constraint team_splits_team_b_name_length
    check (char_length(btrim(team_b_name)) between 1 and 40),
  team_b_color text not null
    constraint team_splits_team_b_color_check
    check (team_b_color ~ '^#[0-9a-fA-F]{6}$'),
  mode text not null
    constraint team_splits_mode_check
    check (mode in ('manual', 'auto')),
  -- Nula mientras es borrador: un borrador no lo lee nadie con su sesión.
  published_at timestamptz,
  -- Quién lo creó. Si esa persona se va del club el reparto se queda.
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_splits_event_id_key unique (event_id),
  -- El destino de la clave compuesta de `team_split_members`: con ella una
  -- fila de equipo no puede colgar de un reparto de otro club.
  constraint team_splits_id_club_id_key unique (id, club_id),
  -- Como en `event_rsvps` (`0038`): evento del mismo club, sin trigger.
  -- Borrar el evento se lleva el reparto.
  constraint team_splits_event_same_club_fkey
    foreign key (event_id, club_id)
    references public.events (id, club_id) on delete cascade,
  -- La lista de columnas del `set null` deja el `club_id` en su sitio.
  constraint team_splits_creator_same_club_fkey
    foreign key (created_by, club_id)
    references public.members (user_id, club_id)
    on delete set null (created_by)
);

-- Lo que creó cada quien, para el `set null` cuando se va.
create index if not exists team_splits_created_by_club_id_idx
  on public.team_splits (created_by, club_id);

create table if not exists public.team_split_members (
  split_id uuid not null,
  user_id uuid not null,
  club_id uuid not null references public.clubs (id),
  team text not null
    constraint team_split_members_team_check
    check (team in ('a', 'b')),
  -- Una fila por jugador y reparto: asignarlo otra vez lo mueve de equipo.
  constraint team_split_members_pkey primary key (split_id, user_id),
  -- Borrar el reparto (o su evento) se lleva sus filas.
  constraint team_split_members_split_same_club_fkey
    foreign key (split_id, club_id)
    references public.team_splits (id, club_id) on delete cascade,
  -- Borrar la identidad (que borra al socio) se lleva su fila; el reparto
  -- sigue.
  constraint team_split_members_member_same_club_fkey
    foreign key (user_id, club_id)
    references public.members (user_id, club_id) on delete cascade
);

-- Los repartos de un jugador: para la cascada de su fila de `members` y para
-- la función de abajo, que busca por jugador.
create index if not exists team_split_members_user_id_club_id_idx
  on public.team_split_members (user_id, club_id);

-- Si quien pregunta tiene fila en el reparto. Es `security definer` para
-- cortar el ciclo entre las dos policies: la de `team_splits` pregunta por
-- `team_split_members`, y la de `team_split_members` pregunta por
-- `team_splits`. En `0029` el ciclo se evitó con una policy de grupos que no
-- mira la publicación; aquí no basta, porque las filas de un equipo sólo se
-- leen si el reparto está publicado. Responde sólo por quien pregunta, así
-- que no deja averiguar dónde juega otro.
create or replace function public.is_assigned_to_team_split(
  target_split_id uuid
)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
      from public.team_split_members tsm
     where tsm.split_id = target_split_id
       and tsm.user_id = (select auth.uid())
  )
$$;

-- Toda función nueva nace ejecutable por los tres roles de la API. Un cliente
-- anónimo no tiene repartos por los que preguntar.
revoke all on function public.is_assigned_to_team_split(uuid)
  from public, anon;
grant execute on function public.is_assigned_to_team_split(uuid)
  to authenticated, service_role;

alter table public.team_splits enable row level security;
alter table public.team_split_members enable row level security;

-- Un reparto publicado lo lee su audiencia, asignada o no (para ver que hay
-- equipos y que no está), y quien juega en él aunque haya salido de la
-- audiencia. La subconsulta sobre `events` pasa por `events_select_audience`
-- (`0034`), que ya decide quién es la audiencia viva del evento.
drop policy if exists team_splits_select_published on public.team_splits;
create policy team_splits_select_published
  on public.team_splits
  for select
  to authenticated
  using (
    published_at is not null
    and (
      exists (
        select 1 from public.events e where e.id = team_splits.event_id
      )
      or public.is_assigned_to_team_split(team_splits.id)
    )
  );

-- Las filas de los dos equipos se leen si el reparto se lee.
drop policy if exists team_split_members_select_published
  on public.team_split_members;
create policy team_split_members_select_published
  on public.team_split_members
  for select
  to authenticated
  using (
    exists (
      select 1 from public.team_splits s
       where s.id = team_split_members.split_id
    )
  );

-- Revocar primero, como en `0043_attendance_records.sql`: el proyecto concede
-- todo a `anon` y `authenticated` sobre cada tabla nueva. Armar y publicar
-- pasa por el servidor.
revoke all on public.team_splits from anon, authenticated;
grant select on public.team_splits to authenticated;
grant select, insert, update, delete on public.team_splits to service_role;

revoke all on public.team_split_members from anon, authenticated;
grant select on public.team_split_members to authenticated;
grant select, insert, update, delete on public.team_split_members
  to service_role;

-- La función de cada posición (D4): qué hueco cubre en el auto-balance
-- aunque el club la renombre. Nula es "ninguna". La columna, su `check` y el
-- relleno de las tres sembradas van juntos y sólo la primera vez: al
-- repetirse, el relleno no debe devolver una función que el club quitó.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'club_positions'
       and column_name = 'coverage'
  ) then
    alter table public.club_positions
      add column coverage text
      constraint club_positions_coverage_check
      check (coverage in ('goalkeeper', 'defender', 'forward'));

    -- Por el nombre inglés sembrado en `0025`, que es la grafía de la
    -- función. Una posición que el club ya renombró se queda sin ella.
    update public.club_positions p
       set coverage = lower(n.name)
      from public.club_position_names n
     where n.position_id = p.id
       and n.locale = 'en'
       and n.name in ('Goalkeeper', 'Defender', 'Forward');
  end if;
end;
$$;

-- La siembra de `0025` para los clubes nuevos, ahora con la función.
create or replace function public.clubs_seed_default_positions()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  seeded record;
begin
  for seeded in
    with seed (sort_order, name_en, name_es, coverage) as (
      values
        (1, 'Goalkeeper', 'Portería', 'goalkeeper'),
        (2, 'Defender', 'Defensa', 'defender'),
        (3, 'Forward', 'Ataque', 'forward')
    ),
    inserted as (
      insert into public.club_positions (club_id, sort_order, coverage)
      select new.id, s.sort_order, s.coverage from seed s
      returning id, sort_order
    )
    select i.id, s.name_en, s.name_es
      from inserted i
      join seed s on s.sort_order = i.sort_order
  loop
    insert into public.club_position_names (position_id, club_id, locale, name)
    values
      (seeded.id, new.id, 'en', seeded.name_en),
      (seeded.id, new.id, 'es', seeded.name_es);
  end loop;
  return new;
end;
$$;

-- El trigger no se llama a mano. `create or replace` conserva los permisos,
-- pero repetirlo aquí no depende de eso.
revoke all on function public.clubs_seed_default_positions()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
