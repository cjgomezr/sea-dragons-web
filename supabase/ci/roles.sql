-- Un Postgres recién creado no es un Postgres de Supabase. Las migraciones de
-- este repositorio hacen GRANT a los tres roles de la API (anon,
-- authenticated, service_role), que Supabase trae de fábrica y un contenedor
-- `postgres:17` no. Sin ellos, cada migración falla por el motivo equivocado:
-- no porque el esquema esté mal, sino porque el sustrato no se parece a
-- producción.
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
