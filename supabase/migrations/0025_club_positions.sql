-- Las posiciones de juego, por club (#298, RF-7 del PRD de E18a). Hasta aquí
-- eran tres valores fijos en `members_position_check` (`0016`), en la
-- constante `POSITIONS` del dominio y en las claves `position.*` de los dos
-- catálogos de idioma. Un club de otro deporte no podría describir a sus
-- miembros.
--
-- Dos tablas: la posición (su club, su orden y si está archivada) y sus
-- nombres, una fila por idioma. Es el mecanismo de la decisión D2 del PRD,
-- que comparten los textos del inicio de sesión (RF-5): si falta un idioma,
-- la aplicación cae al otro, y eso se decide al leer, no aquí.
--
-- Archivar es una fecha, no un borrado (D3): quien tenía la posición la
-- conserva. Por eso no hay `on delete` en las referencias.
--
-- Todavía nadie lee el catálogo: eso es el #299. Hasta entonces la aplicación
-- sigue escribiendo `members.position`, así que esa columna se queda y un
-- trigger mantiene `members.position_id` al día. El `check` con las tres
-- grafías fijas sí se va: quien decide qué posiciones valen es ya el
-- catálogo. El #299 pasa la aplicación a `position_id` y retira la columna de
-- texto con su trigger.

create table if not exists public.club_positions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id),
  -- El orden lo decide el club, no el alfabeto. Sin `unique`: reordenar sería
  -- una carrera de intercambios, y un empate sólo deja dos posiciones en el
  -- orden en que se crearon.
  sort_order integer not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  -- El destino de las claves foráneas compuestas de los nombres y de
  -- `members`: con ellas nada puede apuntar a una posición de otro club.
  constraint club_positions_id_club_id_key unique (id, club_id)
);

create index if not exists club_positions_club_id_sort_order_idx
  on public.club_positions (club_id, sort_order);

create table if not exists public.club_position_names (
  position_id uuid not null,
  -- Redundante a propósito: es lo que deja al índice único de abajo comparar
  -- nombres dentro de un club sin un trigger.
  club_id uuid not null references public.clubs (id),
  locale text not null
    constraint club_position_names_locale_check check (locale in ('en', 'es')),
  -- El largo cabe en el desplegable del perfil y en la columna del
  -- directorio; se mide recortado, así que sólo espacios cuenta como vacío.
  name text not null
    constraint club_position_names_name_length
    check (char_length(btrim(name)) between 1 and 40),
  -- Un nombre por posición e idioma.
  constraint club_position_names_pkey primary key (position_id, locale),
  constraint club_position_names_position_same_club_fkey
    foreign key (position_id, club_id)
    references public.club_positions (id, club_id)
);

-- Dos posiciones no pueden llamarse igual en el mismo club y el mismo idioma,
-- sin distinguir mayúsculas ni espacios, como los grupos (`0015`).
create unique index if not exists club_position_names_club_id_locale_name_key
  on public.club_position_names (club_id, locale, lower(btrim(name)));

-- Las tres de hoy, en el orden del SRD que sigue el directorio, con los
-- textos de `position.*` de los catálogos. Sólo en los clubes que no tienen
-- ninguna: al repetirse, la migración no debe resucitar una posición que el
-- club archivó ni pisar un nombre que cambió.
with seed (sort_order, name_en, name_es) as (
  values
    (1, 'Goalkeeper', 'Portería'),
    (2, 'Defender', 'Defensa'),
    (3, 'Forward', 'Ataque')
),
clubs_without_positions as (
  select c.id
    from public.clubs c
   where not exists (
     select 1 from public.club_positions p where p.club_id = c.id
   )
),
inserted as (
  insert into public.club_positions (club_id, sort_order)
  select c.id, s.sort_order
    from clubs_without_positions c
   cross join seed s
  returning id, club_id, sort_order
)
insert into public.club_position_names (position_id, club_id, locale, name)
select i.id, i.club_id, names.locale, names.name
  from inserted i
  join seed s on s.sort_order = i.sort_order
 cross join lateral (
   values ('en', s.name_en), ('es', s.name_es)
 ) as names (locale, name);

alter table public.members
  add column if not exists position_id uuid;

alter table public.members
  drop constraint if exists members_position_same_club_fkey;
alter table public.members
  add constraint members_position_same_club_fkey
  foreign key (position_id, club_id)
  references public.club_positions (id, club_id);

-- La que recorre la clave foránea al archivar o al contar quién juega dónde.
create index if not exists members_position_id_club_id_idx
  on public.members (position_id, club_id);

-- `0016` ya no lo repone si esta tabla existe: al repetirse el histórico, el
-- `check` fijo rechazaría las posiciones que el club haya añadido.
alter table public.members
  drop constraint if exists members_position_check;

-- De la grafía del SRD (`members.position`) a la posición del club del
-- miembro. El nombre inglés sembrado es esa misma grafía. Si no la encuentra,
-- rechaza la fila con el nombre y el código del `check` al que sustituye:
-- así quien ya interpretaba ese rechazo (la API, los tests de `0016`) no nota
-- el cambio, y una referencia vacía no pierde el dato en silencio.
create or replace function public.members_sync_position_id()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.position is null then
    new.position_id := null;
    return new;
  end if;

  select n.position_id
    into new.position_id
    from public.club_position_names n
   where n.club_id = new.club_id
     and n.locale = 'en'
     and n.name = new.position;

  if new.position_id is null then
    raise exception
      'new row for relation "members" violates check constraint "members_position_check"'
      using errcode = 'check_violation',
            constraint = 'members_position_check',
            detail = format('El club %s no tiene la posición %L.',
                            new.club_id, new.position);
  end if;
  return new;
end
$$;

drop trigger if exists members_sync_position_id on public.members;
create trigger members_sync_position_id
  before insert or update of position on public.members
  for each row execute function public.members_sync_position_id();

-- El relleno de quien ya tenía posición. `where position_id is null` lo hace
-- idempotente, y el trigger de arriba hace el trabajo al tocar la columna.
update public.members
   set position = position
 where position is not null
   and position_id is null;

alter table public.club_positions enable row level security;
alter table public.club_position_names enable row level security;

-- Un miembro ve las posiciones de su club. La subconsulta pasa por
-- `members_select_own` (`0003`), así que sólo encuentra su propia fila.
drop policy if exists club_positions_select_own_club on public.club_positions;
create policy club_positions_select_own_club
  on public.club_positions
  for select
  to authenticated
  using (
    club_id in (
      select m.club_id from public.members m
       where m.user_id = (select auth.uid())
    )
  );

drop policy if exists club_position_names_select_own_club
  on public.club_position_names;
create policy club_position_names_select_own_club
  on public.club_position_names
  for select
  to authenticated
  using (
    club_id in (
      select m.club_id from public.members m
       where m.user_id = (select auth.uid())
    )
  );

-- Revocar primero, como en `0015_groups.sql`: el proyecto concede todo a
-- `anon` y `authenticated` sobre cada tabla nueva. Escribir es de la llave de
-- servicio; la pantalla del Admin (#300) pasa por el servidor.
revoke all on public.club_positions from anon, authenticated;
grant select on public.club_positions to authenticated;
grant select, insert, update, delete on public.club_positions to service_role;

revoke all on public.club_position_names from anon, authenticated;
grant select on public.club_position_names to authenticated;
grant select, insert, update, delete on public.club_position_names
  to service_role;

-- El trigger no se llama a mano.
revoke all on function public.members_sync_position_id()
  from public, anon, authenticated;
