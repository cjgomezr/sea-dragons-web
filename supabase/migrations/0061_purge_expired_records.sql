-- La limpieza de datos viejos (#522, RF-1 a RF-3 de
-- `docs/prd/e16b-scheduler-y-carga.md`, D3 a D6). Varias migraciones dejaron
-- prometida la purga "para E16", y hasta aquí esas tablas sólo crecían:
--   - los registros que cuentan cupos (`0005`, `0006`, `0009`, `0010` y
--     `0059`) se borran a los 90 días: sólo sirven para contar de 1 a 24
--     horas hacia atrás;
--   - la bitácora (`0002`) se borra a los 12 meses, el mínimo de NFR-010;
--   - las notificaciones se podan para todos los socios con la regla de
--     `prune_member_notifications` (`0023`), que hasta ahora sólo corría al
--     llegar un aviso nuevo.
-- Se borra lo estrictamente más viejo que el plazo: una fila con 90 días
-- justos se queda. Las edades se miden con `now()`, que es un instante UTC.
--
-- Programarla cada noche con `pg_cron` es el ticket siguiente de E16b, que
-- llamará sólo a `purge_expired_records()`.
--
-- Las tres funciones son `security definer`: las corre `postgres`, dueño de
-- las tablas, y nadie más. Ningún rol de la API puede llamarlas.

-- Borra por lotes las filas de `target_table` cuyo `age_column` es anterior
-- a `cutoff`, y devuelve cuántas borró. La primera vez en producción hay
-- meses acumulados: un lote acotado mantiene corta cada sentencia, y el
-- borrado sólo bloquea las filas viejas, que ningún cupo vuelve a mirar.
-- Las inserciones de quien pide recuperar su contraseña siguen entrando.
-- Cuatro de las tablas no tienen un índice que empiece por la fecha, así que
-- cada lote puede recorrerlas enteras: con el volumen de un club no importa.
create or replace function public.delete_rows_older_than(
  target_table regclass,
  age_column name,
  cutoff timestamptz
)
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  delete_batch_size constant integer := 5000;
  batch_deleted integer;
  total_deleted integer := 0;
begin
  loop
    execute format(
      'delete from %s
        where id in (select id from %s where %I < $1 limit %s)',
      target_table, target_table, age_column, delete_batch_size)
      using cutoff;
    get diagnostics batch_deleted = row_count;
    exit when batch_deleted = 0;
    total_deleted := total_deleted + batch_deleted;
  end loop;
  return total_deleted;
end;
$$;

-- La poda de cada noche llama a la misma función que la inmediata, con los
-- socios que tienen avisos y de lote en lote: la regla vive sólo en `0023`.
create or replace function public.prune_all_member_notifications()
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  members_per_batch constant integer := 500;
  batch uuid[];
  last_user_id uuid;
  batch_deleted integer;
  total_deleted integer := 0;
begin
  loop
    select array_agg(recipients.user_id order by recipients.user_id)
      into batch
      from (
        select distinct n.user_id
          from public.notifications n
         where last_user_id is null or n.user_id > last_user_id
         order by n.user_id
         limit members_per_batch
      ) recipients;
    exit when batch is null;

    select coalesce(sum(pruned.deleted_count), 0)::integer
      into batch_deleted
      from public.prune_member_notifications(batch) pruned;
    total_deleted := total_deleted + batch_deleted;
    last_user_id := batch[array_upper(batch, 1)];
  end loop;
  return total_deleted;
end;
$$;

-- La única que llamará el trabajo nocturno. Devuelve una fila por tabla con
-- lo que borró, también cuando es cero, para que el historial diga qué pasó.
create or replace function public.purge_expired_records()
  returns table (table_name text, deleted_count integer)
  language plpgsql
  volatile
  security definer
  set search_path = ''
  -- Restar días a un `timestamptz` cuenta días del calendario de la sesión:
  -- con un cambio de hora en medio, "90 días" serían 89 días y 23 horas.
  set timezone = 'UTC'
as $$
declare
  quota_record_retention constant interval := interval '90 days';
  audit_log_retention constant interval := interval '12 months';
begin
  return query
    select purged.table_name,
           public.delete_rows_older_than(
             purged.target_table, purged.age_column,
             now() - purged.retention)
      from (values
        ('password_recovery_requests',
         'public.password_recovery_requests'::regclass,
         'requested_at'::name, quota_record_retention),
        ('confirmation_email_requests',
         'public.confirmation_email_requests'::regclass,
         'requested_at'::name, quota_record_retention),
        ('email_send_requests',
         'public.email_send_requests'::regclass,
         'requested_at'::name, quota_record_retention),
        ('registration_requests',
         'public.registration_requests'::regclass,
         'requested_at'::name, quota_record_retention),
        ('directory_email_sends',
         'public.directory_email_sends'::regclass,
         'created_at'::name, quota_record_retention),
        ('audit_log',
         'public.audit_log'::regclass,
         'created_at'::name, audit_log_retention)
      ) as purged (table_name, target_table, age_column, retention);

  return query
    select 'notifications'::text, public.prune_all_member_notifications();
end;
$$;

-- Postgres concede `execute` a PUBLIC en toda función nueva, y el
-- `pg_default_acl` de Supabase además a los roles de la API. Sólo `postgres`,
-- que es su dueño y quien correrá `pg_cron`, las ejecuta.
revoke all on function public.delete_rows_older_than(regclass, name, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.prune_all_member_notifications()
  from public, anon, authenticated, service_role;
revoke all on function public.purge_expired_records()
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
