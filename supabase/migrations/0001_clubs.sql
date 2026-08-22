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
