-- La limpieza nocturna con `pg_cron` (#523, RF-4 y RF-5 de
-- `docs/prd/e16b-scheduler-y-carga.md`). Un único trabajo, `limpieza-nocturna`,
-- llama cada noche a `run_nightly_cleanup()`, que corre la purga de `0061` y
-- borra el historial del propio `pg_cron` de más de 30 días: sin eso,
-- `cron.job_run_details` crece sin límite.
--
-- El Postgres desechable de CI no trae `pg_cron`. Ahí se crea el
-- procedimiento y no se programa nada.

-- Es un procedimiento y no una función para poder confirmar cada limpieza por
-- separado: si una falla, lo que borraron las otras se queda. Al final falla
-- con los mensajes de las que fallaron, y así el error queda en
-- `cron.job_run_details`. Postgres no deja confirmar desde un procedimiento
-- con `security definer` ni con `set`: lo corre `postgres`, dueño del trabajo,
-- y todo lo que toca va cualificado con su esquema.
create or replace procedure public.run_nightly_cleanup()
  language plpgsql
as $$
declare
  cleanup_steps constant text[] := array[
    'select from public.purge_expired_records()',
    'delete from cron.job_run_details
      where start_time < now() - interval ''30 days'''
  ];
  step text;
  failures text[] := '{}';
begin
  foreach step in array cleanup_steps loop
    begin
      execute step;
    exception when others then
      failures := failures || format('%s: %s', step, sqlerrm);
    end;
    commit;
  end loop;

  if cardinality(failures) > 0 then
    raise exception 'la limpieza nocturna falló: %',
      array_to_string(failures, '; ');
  end if;
end;
$$;

-- Postgres concede `execute` a PUBLIC en toda rutina nueva, y el
-- `pg_default_acl` de Supabase además a los roles de la API.
revoke all on procedure public.run_nightly_cleanup()
  from public, anon, authenticated, service_role;

-- `pg_cron` sólo se instala donde existe: `create extension` fallaría en CI y
-- `scripts/apply-migrations.sh` aplica cada archivo en una sola transacción.
-- La programación mira el esquema `cron` y no la extensión, para que el test
-- pueda probarla con un `cron` falso.
do $$
declare
  nightly_cleanup_job constant text := 'limpieza-nocturna';
  -- `pg_cron` lee el horario en UTC: las 16:30 UTC son las 02:30 en Melbourne
  -- en verano (AEDT, UTC+11) y las 03:30 en invierno (AEST, UTC+10). Las dos
  -- caen fuera de las franjas de NFR-003.
  nightly_cleanup_schedule constant text := '30 16 * * *';
begin
  if exists (select from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    grant usage on schema cron to postgres;
    grant all privileges on all tables in schema cron to postgres;
  end if;

  if to_regnamespace('cron') is null then
    raise notice 'sin pg_cron: la limpieza nocturna no queda programada';
    return;
  end if;

  -- Con el mismo nombre, `cron.schedule` reemplaza el trabajo que ya existe.
  perform cron.schedule(
    nightly_cleanup_job,
    nightly_cleanup_schedule,
    'call public.run_nightly_cleanup()');
end;
$$;
