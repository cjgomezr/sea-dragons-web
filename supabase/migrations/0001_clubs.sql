-- E1 (fundación técnica) extenderá este archivo. Aquí solo vive el patrón que
-- toda tabla posterior repite, para que NFR-009 (multi-club futuro) y BR-007
-- (privacidad por rol) no haya que retrofitearlos.
--
-- Patrón obligatorio para CADA tabla nueva del proyecto:
--   1. columna `club_id uuid not null references public.clubs (id)`
--   2. `alter table ... enable row level security;`
--   3. al menos una policy explícita; sin policy, RLS niega todo.
--
-- `clubs` es la raíz del tenant: es la única tabla cuyo identificador de club
-- es su propia clave primaria.

create extension if not exists "pgcrypto";

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.clubs enable row level security;

drop policy if exists clubs_select_authenticated on public.clubs;
create policy clubs_select_authenticated
  on public.clubs
  for select
  to authenticated
  using (true);

-- CON-004 / ASS-002: Release 1 opera un único club.
insert into public.clubs (slug, name)
values ('victoria-seadragons', 'Victoria Seadragons')
on conflict (slug) do nothing;

-- Los GRANT que esta tabla necesita de verdad. RLS sigue siendo la frontera: el
-- GRANT solo deja pasar la puerta.
--
-- Lo que decía aquí hasta el 11 de septiembre de 2026 era falso al revés: este
-- proyecto de Supabase SÍ concede por defecto todos los privilegios a `anon` y
-- a `authenticated` sobre cada tabla nueva del esquema `public`, así que este
-- `grant` no añadía nada y, sobre todo, no quitaba los seis privilegios que
-- sobraban. `0004_privilegios_clubs_audit_log.sql` los quita. Toda tabla nueva
-- empieza por `revoke all`, como hace `0003_members.sql`.
grant select on public.clubs to anon, authenticated;
grant select, insert, update, delete on public.clubs to service_role;
