import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  freshDatabase,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0062_schedule_nightly_cleanup.sql` contra un Postgres desechable (#523,
 * RF-4 y RF-5 de `docs/prd/e16b-scheduler-y-carga.md`). El Postgres de CI no
 * trae `pg_cron`: la programación se prueba contra un esquema `cron` falso
 * que imita lo que la migración usa de él, y que `cron.schedule` reemplace el
 * trabajo con el mismo nombre en vez de duplicarlo.
 */

const JOB_NAME = "limpieza-nocturna";
const JOB_SCHEDULE = "30 16 * * *";
const JOB_COMMAND = "call public.run_nightly_cleanup()";
const CRON_HISTORY_RETENTION_DAYS = 30;
const RUN_CLEANUP = "call public.run_nightly_cleanup()";

const FAKE_CRON_SQL = `
  create schema cron;
  create table cron.job (
    jobid bigserial primary key,
    jobname text unique,
    schedule text not null,
    command text not null
  );
  create table cron.job_run_details (
    runid bigserial primary key,
    status text,
    return_message text,
    start_time timestamptz,
    end_time timestamptz
  );
  create function cron.schedule(job_name text, schedule text, command text)
    returns bigint
    language sql
  as $$
    insert into cron.job (jobname, schedule, command)
    values (job_name, schedule, command)
    on conflict (jobname) do update
      set schedule = excluded.schedule, command = excluded.command
    returning jobid;
  $$;`;

/** Base vacía con el `cron` falso puesto antes de aplicar el histórico. */
async function databaseWithFakeCron(): Promise<TemporaryDatabase> {
  const database = await freshDatabase();
  await database.query(FAKE_CRON_SQL);
  const applied = await applyRepositoryMigrations(database);
  expect(applied.code, applied.stderr).toBe(0);
  return database;
}

async function seedCronRun(
  database: TemporaryDatabase,
  daysAgo: number,
): Promise<void> {
  await database.query(
    `insert into cron.job_run_details (status, start_time, end_time)
     values ('succeeded', now() - interval '${daysAgo} days',
             now() - interval '${daysAgo} days')`,
  );
}

async function countCronRuns(database: TemporaryDatabase): Promise<number> {
  return Number(
    await database.query("select count(*) from cron.job_run_details"),
  );
}

/** Cambia la limpieza de #522 por una que siempre falla. */
async function breakExpiredRecordsPurge(
  database: TemporaryDatabase,
): Promise<void> {
  await database.query(
    `create or replace function public.purge_expired_records()
       returns table (table_name text, deleted_count integer)
       language plpgsql
     as $$
     begin
       raise exception 'purga rota por el test';
     end;
     $$;`,
  );
}

describeConPostgres("sin pg_cron", () => {
  it("la migración se aplica y no programa nada", async () => {
    const database = await migratedDatabase();

    const cronSchema = await database.query(
      "select coalesce(to_regnamespace('cron')::text, 'ninguno')",
    );

    expect(cronSchema).toBe("ninguno");
  });

  it("es idempotente: aplicada dos veces no falla", async () => {
    const database = await migratedDatabase();

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
  });
});

describeConPostgres("programación del trabajo", () => {
  it("programa un único trabajo con su nombre, horario y comando", async () => {
    const database = await databaseWithFakeCron();

    const jobs = await database.query(
      "select jobname || '|' || schedule || '|' || command from cron.job",
    );

    expect(jobs).toBe(`${JOB_NAME}|${JOB_SCHEDULE}|${JOB_COMMAND}`);
  });

  it("aplicada otra vez no duplica el trabajo", async () => {
    const database = await databaseWithFakeCron();

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(await database.query("select count(*) from cron.job")).toBe("1");
  });
});

describeConPostgres("historial de pg_cron", () => {
  it("borra las corridas de más de 30 días y deja las más nuevas", async () => {
    const database = await databaseWithFakeCron();
    await seedCronRun(database, CRON_HISTORY_RETENTION_DAYS + 1);
    await seedCronRun(database, CRON_HISTORY_RETENTION_DAYS - 1);

    const attempt = await database.attempt(RUN_CLEANUP);

    expect(attempt.code, attempt.stderr).toBe(0);
    expect(await countCronRuns(database)).toBe(1);
    expect(
      await database.query(
        `select count(*) from cron.job_run_details
          where start_time > now() - interval '${CRON_HISTORY_RETENTION_DAYS} days'`,
      ),
    ).toBe("1");
  });
});

describeConPostgres("cuando una limpieza falla", () => {
  it("limpia igual el historial y falla con el mensaje de la purga", async () => {
    const database = await databaseWithFakeCron();
    await seedCronRun(database, CRON_HISTORY_RETENTION_DAYS + 1);
    await breakExpiredRecordsPurge(database);

    const attempt = await database.attempt(RUN_CLEANUP);

    expect(attempt.code).toBeGreaterThan(0);
    expect(attempt.stderr).toMatch(/purga rota por el test/);
    expect(await countCronRuns(database)).toBe(0);
  });

  it("purga igual los registros viejos aunque falle el historial", async () => {
    // Sin `cron`, borrar el historial falla: la purga de antes ya quedó.
    const database = await migratedDatabase();
    await database.query(
      `insert into public.audit_log
         (club_id, actor_id, action, entity_type, entity_id, result, created_at)
       select id, gen_random_uuid(), 'test', 'member', 'x', 'success',
              now() - interval '13 months'
         from public.clubs where slug = 'victoria-seadragons'`,
    );

    const attempt = await database.attempt(RUN_CLEANUP);

    expect(attempt.code).toBeGreaterThan(0);
    expect(attempt.stderr).toMatch(/job_run_details/);
    expect(await database.query("select count(*) from public.audit_log")).toBe(
      "0",
    );
  });
});

describeConPostgres("quién puede correr la limpieza nocturna", () => {
  it.each(["anon", "authenticated", "service_role"])(
    "no deja a %s",
    async (role) => {
      const database = await migratedDatabase();

      const attempt = await database.attempt(
        `set role ${role}; ${RUN_CLEANUP}`,
      );

      expect(attempt.code).toBeGreaterThan(0);
      expect(attempt.stderr).toMatch(/permission denied for procedure/);
    },
  );

  it("deja a postgres, que es quien corre pg_cron", async () => {
    const database = await migratedDatabase();

    const canExecute = await database.query(
      `select has_function_privilege(
                'postgres', 'public.run_nightly_cleanup()', 'execute')`,
    );

    expect(canExecute).toBe("t");
  });
});
