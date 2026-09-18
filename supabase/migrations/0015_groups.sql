-- Los grupos del club y sus socios (issue #225, RF-1 y RF-9 de
-- `docs/prd/e4-grupos.md`). El club organiza a sus socios en grupos como
-- "Senior Squad" o "Junior Squad" (FR-023 a FR-026), y E7 y E11 los usarán
-- como audiencia de eventos y noticias (FR-027). Aquí sólo se guardan: la API
-- y la pantalla llegan en sus propios tickets.
--
-- Las reglas que no pueden depender de que la aplicación se porte bien viven
-- en la base: nombre único por club sin distinguir mayúsculas ni espacios, un
-- socio una sola vez por grupo, y ningún grupo ni socio de otro club mezclado
-- en la misma pertenencia.

-- Lo que pide la clave foránea compuesta de las pertenencias contra
-- `members`. `user_id` ya es único, así que esto no cambia qué filas caben:
-- sólo le da a Postgres la pareja `(user_id, club_id)` como destino. Va en un
-- bloque porque `add constraint` no tiene `if not exists`.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.members'::regclass
       and conname = 'members_user_id_club_id_key'
  ) then
    alter table public.members
      add constraint members_user_id_club_id_key unique (user_id, club_id);
  end if;
end
$$;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id),
  -- El límite se mide sobre el nombre recortado, que es el que ve la gente:
  -- así un nombre de solo espacios cuenta como vacío. La aplicación guarda el
  -- nombre ya recortado y exporta la misma cifra para su formulario; aquí es
  -- la última barrera, no el mensaje que ve quien lo escribe.
  name text not null
    constraint groups_name_length
    check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  -- El destino de la clave foránea compuesta de las pertenencias: con ella,
  -- una pertenencia sólo puede nombrar un grupo de su mismo club.
  constraint groups_id_club_id_key unique (id, club_id)
);

-- Nombre único por club, sin distinguir mayúsculas ni espacios alrededor. Es
-- un índice y no un `unique` porque compara una expresión, no la columna.
create unique index if not exists groups_club_id_name_key
  on public.groups (club_id, lower(btrim(name)));

create table if not exists public.group_memberships (
  group_id uuid not null,
  -- El socio por su `user_id`, como en `role_requests`: la policy lo compara
  -- con `auth.uid()` sin cruzar `members`.
  user_id uuid not null,
  -- Redundante a propósito. Las dos claves compuestas de abajo lo atan a la
  -- vez al club del grupo y al del socio, y eso es lo que impide mezclar
  -- clubes sin un trigger.
  club_id uuid not null references public.clubs (id),
  assigned_at timestamptz not null default now(),
  -- Un socio una sola vez por grupo.
  constraint group_memberships_pkey primary key (group_id, user_id),
  -- Borrar un grupo se lleva sus pertenencias y no toca a los socios.
  constraint group_memberships_group_same_club_fkey
    foreign key (group_id, club_id)
    references public.groups (id, club_id) on delete cascade,
  -- Borrar la identidad borra el socio (`0003_members.sql`), y el socio
  -- arrastra sus pertenencias.
  constraint group_memberships_member_same_club_fkey
    foreign key (user_id, club_id)
    references public.members (user_id, club_id) on delete cascade
);

-- La consulta de "mis grupos", la que filtra la policy, y la que recorre la
-- cascada al borrar un socio. La del grupo ya la sirve la clave primaria.
create index if not exists group_memberships_user_id_club_id_idx
  on public.group_memberships (user_id, club_id);

alter table public.groups enable row level security;
alter table public.group_memberships enable row level security;

-- Un socio ve sus pertenencias y ninguna más. La gestión (RF-2 en adelante)
-- la hace el servidor con la llave de servicio.
drop policy if exists group_memberships_select_own on public.group_memberships;
create policy group_memberships_select_own
  on public.group_memberships
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Y ve los grupos a los que pertenece. La subconsulta pasa a su vez por la
-- policy de arriba, así que sólo puede encontrar pertenencias propias.
drop policy if exists groups_select_own on public.groups;
create policy groups_select_own
  on public.groups
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.group_memberships gm
       where gm.group_id = groups.id
         and gm.user_id = (select auth.uid())
    )
  );

-- Revocar primero, como en `0003_members.sql`: el proyecto concede todos los
-- privilegios a `anon` y `authenticated` sobre cada tabla nueva, y RLS no
-- filtra `truncate`. Sin el privilegio, un socio que intente escribir recibe
-- un rechazo claro en vez de un "cero filas" en verde.
revoke all on public.groups from anon, authenticated;
grant select on public.groups to authenticated;
grant select, insert, update, delete on public.groups to service_role;

revoke all on public.group_memberships from anon, authenticated;
grant select on public.group_memberships to authenticated;
grant select, insert, update, delete on public.group_memberships
  to service_role;

-- ¿Pertenece este socio a alguno de estos grupos? Es la pregunta que harán las
-- policies de audiencia de E7 y E11. Un socio dado de baja (`inactive`) no
-- pertenece a nada aunque siga asignado: la baja (FR-085) no borra sus
-- pertenencias, pero sí lo saca de toda audiencia.
--
-- `security invoker`: lee con los privilegios y las policies de quien llama.
-- Un socio sólo puede obtener verdadero al preguntar por sí mismo, que es lo
-- que una policy necesita, y no puede sondear los grupos de otro. El servidor,
-- con la llave de servicio, pregunta por cualquiera.
create or replace function public.is_member_in_groups(
  target_user_id uuid,
  group_ids uuid[]
)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select exists (
    select 1
      from public.group_memberships gm
      join public.members m on m.user_id = gm.user_id
     where gm.user_id = target_user_id
       and gm.group_id = any (group_ids)
       and m.account_status <> 'inactive'
  )
$$;

-- Toda función nueva nace ejecutable por los tres roles de la API. Un cliente
-- anónimo no tiene grupos por los que preguntar.
revoke all on function public.is_member_in_groups(uuid, uuid[])
  from public, anon;
grant execute on function public.is_member_in_groups(uuid, uuid[])
  to authenticated, service_role;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea las tablas y la función en
-- cuanto se aplica, aunque faltara el event trigger que recarga su caché.
notify pgrst, 'reload schema';
