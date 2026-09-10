-- Descripción canónica del esquema `public`: una línea por objeto, ordenada,
-- pensada para compararse contra otra corrida con `diff` o con un test.
--
-- Se lee del catálogo en vez de usar `pg_dump` a propósito. pg_dump se niega a
-- hablar con un servidor más nuevo que él, y el runner de GitHub no trae
-- necesariamente el cliente de la misma versión que la imagen del servicio;
-- una consulta normal no tiene ese problema. De paso, el resultado es texto
-- estable y legible en el log cuando la comparación falla.
--
-- Cubre lo que una migración puede cambiar hoy en este repositorio: tablas
-- (con su bandera de RLS), columnas, restricciones, índices, policies, GRANTs,
-- funciones propias y triggers. Se excluye lo que instala una extensión
-- (pgcrypto deja sus funciones en `public`), que no es esquema declarado por
-- el repositorio.
--
-- Correr con: psql -At -f supabase/ci/schema-snapshot.sql
with objetos as (
  select format('tabla %s rls=%s', c.relname, c.relrowsecurity) as descripcion
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
  union all
  select format(
           'columna %s.%s tipo=%s null=%s default=%s',
           table_name, column_name, data_type, is_nullable,
           coalesce(column_default, '-')
         )
    from information_schema.columns
   where table_schema = 'public'
  union all
  select format(
           'restriccion %s.%s %s',
           co.conrelid::regclass::text, co.conname, pg_get_constraintdef(co.oid)
         )
    from pg_constraint co
    join pg_namespace n on n.oid = co.connamespace
   where n.nspname = 'public'
  union all
  select format('indice %s %s', indexname, indexdef)
    from pg_indexes
   where schemaname = 'public'
  union all
  select format(
           'policy %s.%s cmd=%s roles=%s using=%s check=%s',
           tablename, policyname, cmd, roles::text,
           coalesce(qual, '-'), coalesce(with_check, '-')
         )
    from pg_policies
   where schemaname = 'public'
  union all
  select format('grant %s %s %s', table_name, grantee, privilege_type)
    from information_schema.role_table_grants
   where table_schema = 'public'
  union all
  select format(
           'funcion %s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)
         )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (
           select 1 from pg_depend d
            where d.objid = p.oid and d.deptype = 'e'
         )
  union all
  select format('trigger %s %s', t.tgname, pg_get_triggerdef(t.oid))
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and not t.tgisinternal
)
select descripcion from objetos order by 1;
