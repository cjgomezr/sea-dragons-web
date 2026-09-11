-- Un Postgres recién creado no es un Postgres de Supabase. Las migraciones de
-- este repositorio hacen GRANT a los tres roles de la API (anon,
-- authenticated, service_role) y, desde `0003_members`, referencian el esquema
-- `auth`; todo eso lo trae Supabase de fábrica y un contenedor `postgres:17`
-- no. Sin ello, cada migración falla por el motivo equivocado: no porque el
-- esquema esté mal, sino porque el sustrato no se parece a producción.
--
-- Esto NO es una migración y no vive en supabase/migrations: aplicarlo contra
-- un Supabase de verdad no haría nada. Lo aplica quien levanta un Postgres
-- limpio (hoy, el workflow de migraciones y los tests del aplicador) antes de
-- correr `scripts/apply-migrations.sh`.
--
-- `nologin` a propósito: son roles a los que PostgREST cambia con SET ROLE,
-- nadie se conecta con ellos.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

-- Lo mínimo del esquema `auth` de Supabase que el repositorio necesita para
-- que sus migraciones apliquen: la tabla a la que `public.members` apunta y la
-- función que sus policies llaman. No es una réplica de Supabase Auth y no
-- pretende serlo; aquí no hay contraseñas, ni sesiones, ni confirmación de
-- correo, porque ninguna migración de este repositorio las toca.
--
-- Lo que esto NO es: una base contra la que probar policies. Sin PostgREST
-- nadie pone el JWT en la sesión, así que `auth.uid()` devuelve null y toda
-- policy niega. Los tests de RLS van contra `seadragons-dev`, que es una base
-- de verdad (`tests/rls/`).
create schema if not exists auth;

create table if not exists auth.users (id uuid primary key);

-- Copia de la definición de Supabase: lee el `sub` del JWT que PostgREST deja
-- en la configuración de la sesión. Los dos nombres de ajuste son los dos que
-- Supabase ha usado, y `true` en `current_setting` evita el error cuando no
-- hay ninguno puesto.
create or replace function auth.uid() returns uuid
  language sql
  stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
