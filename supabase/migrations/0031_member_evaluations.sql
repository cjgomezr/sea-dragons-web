-- Las evaluaciones de los miembros y el catálogo de categorías que miden
-- (#321, RF-1 y RF-3 del PRD de E9). Aquí sólo se guardan: la API y las
-- pantallas llegan en sus propios tickets.
--
-- La regla que manda es FR-055: un jugador no ve ninguna nota, ni la suya. Por
-- eso ninguna de estas tablas tiene una policy ni un privilegio para `anon` o
-- `authenticated`. Quien pide es Admin o Coach lo comprueba el servidor, que
-- lee y escribe con la llave de servicio.
--
-- Una evaluación guarda su propio conjunto de categorías (RF-4, AC-035): son
-- sus filas de `member_evaluation_ratings`, no el catálogo actual. Añadir o
-- desactivar una categoría no cambia ninguna evaluación guardada, y renombrarla
-- sí se ve en todas, porque la valoración apunta a la categoría por su `id`.

create table if not exists public.evaluation_categories (
  id uuid primary key default gen_random_uuid(),
  -- En cascada, como las posiciones (`0025`): la limpieza de los clubes
  -- desechables de las pruebas de integración borra el club al final (#348).
  club_id uuid not null references public.clubs (id) on delete cascade,
  -- Cabe en la ficha a 375 px (PRD, casos borde). Se mide recortado, así que
  -- un nombre de solo espacios cuenta como vacío.
  name text not null
    constraint evaluation_categories_name_length
    check (char_length(btrim(name)) between 1 and 40),
  -- El orden lo decide el club, como el de las posiciones de E18a. Sin
  -- `unique` por la misma razón: reordenar no debe ser una carrera.
  sort_order integer not null,
  -- Desactivar es una fecha, no un borrado: las evaluaciones que ya la usan la
  -- conservan hasta que alguien las ponga al día (FR-053).
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  -- El destino de la clave foránea compuesta de las valoraciones: con ella una
  -- evaluación no puede usar una categoría de otro club.
  constraint evaluation_categories_id_club_id_key unique (id, club_id)
);

-- Nombre único por club, sin distinguir mayúsculas ni espacios, como los
-- grupos (`0015`). Cuenta también las desactivadas: reactivar una no puede
-- chocar con otra que se llame igual.
create unique index if not exists evaluation_categories_club_id_name_key
  on public.evaluation_categories (club_id, lower(btrim(name)));

create index if not exists evaluation_categories_club_id_sort_order_idx
  on public.evaluation_categories (club_id, sort_order);

create table if not exists public.member_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  -- Redundante a propósito: la clave compuesta de abajo lo ata al club del
  -- miembro, y las valoraciones lo usan para no mezclar clubes.
  club_id uuid not null references public.clubs (id),
  created_at timestamptz not null default now(),
  -- Lo que RF-1 necesita para que dos personas guardando a la vez no se pisen
  -- en silencio: la segunda guarda contra la fecha que leyó.
  updated_at timestamptz not null default now(),
  -- Una evaluación por miembro, sin historial (ASS-008).
  constraint member_evaluations_user_id_key unique (user_id),
  constraint member_evaluations_id_club_id_key unique (id, club_id),
  -- Borrar la identidad borra el miembro (`0003_members.sql`), y el miembro
  -- arrastra su evaluación.
  constraint member_evaluations_member_same_club_fkey
    foreign key (user_id, club_id)
    references public.members (user_id, club_id) on delete cascade
);

create table if not exists public.member_evaluation_ratings (
  evaluation_id uuid not null,
  category_id uuid not null,
  club_id uuid not null references public.clubs (id),
  -- `numeric` y no `smallint`: un entero redondea en silencio un 5.5 a 6 al
  -- guardarlo, y FR-050 pide rechazar los decimales, no corregirlos.
  rating numeric not null
    constraint member_evaluation_ratings_rating_check
    check (rating between 1 and 10 and rating = trunc(rating)),
  -- Una valoración por categoría dentro de cada evaluación.
  constraint member_evaluation_ratings_pkey
    primary key (evaluation_id, category_id),
  constraint member_evaluation_ratings_evaluation_same_club_fkey
    foreign key (evaluation_id, club_id)
    references public.member_evaluations (id, club_id) on delete cascade,
  -- Sin `on delete`: una categoría en uso no se borra, se desactiva (RF-4). Es
  -- `no action` y no `restrict` para que borrar un club, que se lleva a la vez
  -- sus categorías y sus evaluaciones, no choque a mitad de la cascada.
  constraint member_evaluation_ratings_category_same_club_fkey
    foreign key (category_id, club_id)
    references public.evaluation_categories (id, club_id)
);

-- La que recorre la clave foránea al desactivar o renombrar una categoría. La
-- de la evaluación ya la sirve la clave primaria.
create index if not exists member_evaluation_ratings_category_id_club_id_idx
  on public.member_evaluation_ratings (category_id, club_id);

-- Las diez del SRD, en su orden. Una sola lista para la siembra de los clubes
-- que ya existen y para el trigger de los que se creen después (la lección
-- del #348 con las posiciones).
create or replace function public.seed_default_evaluation_categories(
  target_club_id uuid
)
  returns void
  language sql
  set search_path = ''
as $$
  insert into public.evaluation_categories (club_id, name, sort_order)
  select target_club_id, seed.name, seed.sort_order
    from (
      values
        (1, 'Fitness'),
        (2, 'Speed'),
        (3, 'Endurance'),
        (4, 'Experience'),
        (5, 'Game awareness'),
        (6, 'Tactical'),
        (7, 'Passing'),
        (8, 'Ball control'),
        (9, 'Defense'),
        (10, 'Teamwork')
    ) as seed (sort_order, name)
$$;

-- La usan la migración y el trigger, nadie más.
revoke all on function public.seed_default_evaluation_categories(uuid)
  from public, anon, authenticated;

-- Sólo en los clubes que no tienen ninguna: al repetirse, la migración no debe
-- resucitar una categoría que el club desactivó ni pisar una que renombró.
select public.seed_default_evaluation_categories(c.id)
  from public.clubs c
 where not exists (
   select 1 from public.evaluation_categories e where e.club_id = c.id
 );

alter table public.evaluation_categories enable row level security;
alter table public.member_evaluations enable row level security;
alter table public.member_evaluation_ratings enable row level security;

-- Sin ninguna policy a propósito: no hay caso en que un miembro lea esto
-- directamente de la base. Y revocando todo, como en `0015_groups.sql`, porque
-- el proyecto concede todos los privilegios a `anon` y `authenticated` sobre
-- cada tabla nueva: así quien lo intente recibe un rechazo claro.
revoke all on public.evaluation_categories from anon, authenticated;
grant select, insert, update, delete on public.evaluation_categories
  to service_role;

revoke all on public.member_evaluations from anon, authenticated;
grant select, insert, update, delete on public.member_evaluations
  to service_role;

revoke all on public.member_evaluation_ratings from anon, authenticated;
grant select, insert, update, delete on public.member_evaluation_ratings
  to service_role;

-- Un club creado después de esta migración recibe las diez aquí: la siembra de
-- arriba sólo alcanza a los que ya existían.
create or replace function public.clubs_seed_default_evaluation_categories()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  perform public.seed_default_evaluation_categories(new.id);
  return new;
end;
$$;

drop trigger if exists clubs_seed_default_evaluation_categories
  on public.clubs;
create trigger clubs_seed_default_evaluation_categories
  after insert on public.clubs
  for each row
  execute function public.clubs_seed_default_evaluation_categories();

-- El trigger no se llama a mano.
revoke all on function public.clubs_seed_default_evaluation_categories()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
