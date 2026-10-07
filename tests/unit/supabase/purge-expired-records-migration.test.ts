import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0061_purge_expired_records.sql` contra un Postgres desechable (#522, RF-1 a
 * RF-3 de `docs/prd/e16b-scheduler-y-carga.md`). Los registros de cupos se
 * borran a los 90 días, la bitácora a los 12 meses y las notificaciones se
 * podan para todos con la regla de `prune_member_notifications` (`0023`).
 */

const QUOTA_RECORD_RETENTION_DAYS = 90;
/** El tamaño del lote de la migración: sembrar más obliga a varias vueltas. */
const DELETE_BATCH_SIZE = 5000;
const MAX_NOTIFICATIONS_PER_MEMBER = 200;

/** Cómo sembrar una fila de cada tabla con una edad dada. */
const ROW_SEEDS = {
  password_recovery_requests: {
    ageColumn: "requested_at",
    columns: "club_id, email_hash, requested_at",
    values: "club.id, 'hash', %AGE%",
  },
  confirmation_email_requests: {
    ageColumn: "requested_at",
    columns: "club_id, email_hash, requested_at",
    values: "club.id, 'hash', %AGE%",
  },
  email_send_requests: {
    ageColumn: "requested_at",
    columns: "club_id, requested_at",
    values: "club.id, %AGE%",
  },
  registration_requests: {
    ageColumn: "requested_at",
    columns: "club_id, subject_kind, subject_hash, requested_at",
    values: "club.id, 'ip', 'hash', %AGE%",
  },
  directory_email_sends: {
    ageColumn: "created_at",
    columns: "club_id, sender_id, request_id, reserved_count, created_at",
    values: "club.id, gen_random_uuid(), gen_random_uuid(), 1, %AGE%",
  },
  audit_log: {
    ageColumn: "created_at",
    columns:
      "club_id, actor_id, action, entity_type, entity_id, result, created_at",
    values:
      "club.id, gen_random_uuid(), 'test', 'member', 'x', 'success', %AGE%",
  },
} as const;

type SeededTable = keyof typeof ROW_SEEDS;

const QUOTA_TABLES: readonly SeededTable[] = [
  "password_recovery_requests",
  "confirmation_email_requests",
  "email_send_requests",
  "registration_requests",
  "directory_email_sends",
];

const PURGED_TABLES = [...Object.keys(ROW_SEEDS), "notifications"].sort();

/** SQL que siembra `count` filas de `table` con el instante `ageSql`. */
function seedRowsSql(table: SeededTable, ageSql: string, count = 1): string {
  const seed = ROW_SEEDS[table];
  return `insert into public.${table} (${seed.columns})
          select ${seed.values.replace("%AGE%", ageSql)}
            from public.clubs club, generate_series(1, ${count})
           where club.slug = 'victoria-seadragons';`;
}

async function seedRows(
  database: TemporaryDatabase,
  table: SeededTable,
  ageSql: string,
  count = 1,
): Promise<void> {
  await database.query(seedRowsSql(table, ageSql, count));
}

const PURGE_SQL = `select table_name || ' ' || deleted_count
                     from public.purge_expired_records()
                    order by table_name`;

/** Corre la limpieza y devuelve cuántas filas borró de cada tabla. */
async function purge(
  database: TemporaryDatabase,
): Promise<Record<string, number>> {
  return parseDeletedCounts(await database.query(PURGE_SQL));
}

function parseDeletedCounts(output: string): Record<string, number> {
  return Object.fromEntries(
    output.split("\n").map((line) => {
      const [table, count] = line.split(" ");
      return [table, Number(count)];
    }),
  );
}

/** Cuántas filas de `table` tienen menos de `days` días. */
async function countRowsYoungerThan(
  database: TemporaryDatabase,
  table: SeededTable,
  days: number,
): Promise<number> {
  return Number(
    await database.query(
      `select count(*) from public.${table}
        where ${ROW_SEEDS[table].ageColumn} > ${daysAgo(days)}`,
    ),
  );
}

async function countRows(
  database: TemporaryDatabase,
  table: string,
): Promise<number> {
  return Number(await database.query(`select count(*) from public.${table}`));
}

function daysAgo(days: number): string {
  return `now() - interval '${days} days'`;
}

describeConPostgres("limpieza de los registros de cupos", () => {
  it.each(QUOTA_TABLES)(
    "borra de %s lo de 91 días y deja lo de 89",
    async (table) => {
      const database = await migratedDatabase();
      await seedRows(database, table, daysAgo(QUOTA_RECORD_RETENTION_DAYS + 1));
      await seedRows(database, table, daysAgo(QUOTA_RECORD_RETENTION_DAYS - 1));

      const deleted = await purge(database);

      expect(deleted[table]).toBe(1);
      expect(await countRows(database, table)).toBe(1);
      expect(
        await countRowsYoungerThan(
          database,
          table,
          QUOTA_RECORD_RETENTION_DAYS,
        ),
      ).toBe(1);
    },
  );

  it.each(QUOTA_TABLES)(
    "deja en %s una fila de exactamente 90 días",
    async (table) => {
      const database = await migratedDatabase();

      // En la misma transacción, `now()` es el mismo instante al sembrar y
      // al limpiar: la fila tiene 90 días justos, ni un microsegundo más.
      const output = await database.query(
        `${seedRowsSql(table, daysAgo(QUOTA_RECORD_RETENTION_DAYS))}
         ${PURGE_SQL}`,
      );

      expect(parseDeletedCounts(output)[table]).toBe(0);
      expect(await countRows(database, table)).toBe(1);
    },
  );

  it("borra en varias vueltas más filas que el tamaño del lote", async () => {
    const database = await migratedDatabase();
    const expiredCount = DELETE_BATCH_SIZE * 2 + 1;
    await seedRows(
      database,
      "email_send_requests",
      daysAgo(QUOTA_RECORD_RETENTION_DAYS + 1),
      expiredCount,
    );
    await seedRows(database, "email_send_requests", daysAgo(1));

    const deleted = await purge(database);

    expect(deleted.email_send_requests).toBe(expiredCount);
    expect(await countRows(database, "email_send_requests")).toBe(1);
  });
});

describeConPostgres("limpieza de la bitácora", () => {
  it("borra lo de hace 12 meses y un día y deja lo de 11 meses y 29 días", async () => {
    const database = await migratedDatabase();
    await seedRows(database, "audit_log", "now() - interval '12 months 1 day'");
    await seedRows(
      database,
      "audit_log",
      "now() - interval '11 months 29 days'",
    );

    const deleted = await purge(database);

    expect(deleted.audit_log).toBe(1);
    expect(
      await database.query(
        `select count(*) from public.audit_log
          where created_at > now() - interval '12 months'`,
      ),
    ).toBe("1");
    expect(await countRows(database, "audit_log")).toBe(1);
  });
});

describeConPostgres("lo que devuelve la limpieza", () => {
  it("con las tablas vacías termina sin error y devuelve ceros", async () => {
    const database = await migratedDatabase();

    const deleted = await purge(database);

    expect(Object.keys(deleted).sort()).toEqual(PURGED_TABLES);
    expect(Object.values(deleted).every((count) => count === 0)).toBe(true);
  });

  it("devuelve cuántas filas borró de cada tabla", async () => {
    const database = await migratedDatabase();
    await seedRows(
      database,
      "password_recovery_requests",
      daysAgo(QUOTA_RECORD_RETENTION_DAYS + 1),
      3,
    );
    await seedRows(database, "audit_log", "now() - interval '13 months'", 2);

    const deleted = await purge(database);

    expect(deleted).toEqual({
      audit_log: 2,
      confirmation_email_requests: 0,
      directory_email_sends: 0,
      email_send_requests: 0,
      notifications: 0,
      password_recovery_requests: 3,
      registration_requests: 0,
    });
  });
});

async function seedMember(database: TemporaryDatabase): Promise<string> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members (club_id, user_id, full_name, email)
     select id, '${userId}', 'Socio de prueba', '${userId}@example.test'
       from public.clubs where slug = 'victoria-seadragons'`,
  );
  return userId;
}

interface SeededNotifications {
  readonly userId: string;
  readonly count: number;
  readonly ageDays: number;
  readonly isRead: boolean;
}

async function seedNotifications(
  database: TemporaryDatabase,
  seeded: SeededNotifications,
): Promise<void> {
  const readAt = seeded.isRead ? "now()" : "null";
  await database.query(
    `insert into public.notifications
       (club_id, user_id, type, data, created_at, read_at)
     select m.club_id, m.user_id, 'role_changed', '{}'::jsonb,
            now() - interval '${seeded.ageDays} days'
                  + n * interval '1 minute',
            ${readAt}
       from public.members m, generate_series(1, ${seeded.count}) as n
      where m.user_id = '${seeded.userId}'`,
  );
}

async function countNotificationsOf(
  database: TemporaryDatabase,
  userId: string,
): Promise<number> {
  return Number(
    await database.query(
      `select count(*) from public.notifications where user_id = '${userId}'`,
    ),
  );
}

describeConPostgres("poda de notificaciones para todos", () => {
  it("poda los leídos de 100 días a quien no recibe nada nuevo", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);
    await seedNotifications(database, {
      userId,
      count: 2,
      ageDays: 100,
      isRead: true,
    });
    await seedNotifications(database, {
      userId,
      count: 1,
      ageDays: 100,
      isRead: false,
    });

    const deleted = await purge(database);

    expect(deleted.notifications).toBe(2);
    expect(await countNotificationsOf(database, userId)).toBe(1);
  });

  it("recorta a 200 a cada socio, con la misma regla que la poda inmediata", async () => {
    const database = await migratedDatabase();
    const crowded = await seedMember(database);
    const quiet = await seedMember(database);
    await seedNotifications(database, {
      userId: crowded,
      count: MAX_NOTIFICATIONS_PER_MEMBER + 5,
      ageDays: 1,
      isRead: true,
    });
    await seedNotifications(database, {
      userId: quiet,
      count: 3,
      ageDays: 1,
      isRead: true,
    });

    const deleted = await purge(database);

    expect(deleted.notifications).toBe(5);
    expect(await countNotificationsOf(database, crowded)).toBe(
      MAX_NOTIFICATIONS_PER_MEMBER,
    );
    expect(await countNotificationsOf(database, quiet)).toBe(3);
  });

  it("la poda para todos llama a prune_member_notifications, no a una copia", async () => {
    const database = await migratedDatabase();

    const dependsOnSharedRule = await database.query(
      `select position('public.prune_member_notifications(' in
                       pg_get_functiondef(
                         'public.prune_all_member_notifications()'::regprocedure))
              > 0`,
    );

    expect(dependsOnSharedRule).toBe("t");
  });
});

const CLEANUP_CALLS = [
  "select * from public.purge_expired_records()",
  "select public.prune_all_member_notifications()",
  `select public.delete_rows_older_than(
     'public.audit_log'::regclass, 'created_at', now())`,
];

describeConPostgres("quién puede limpiar", () => {
  it.each(
    ["anon", "authenticated", "service_role"].flatMap((role) =>
      CLEANUP_CALLS.map((call) => [role, call] as const),
    ),
  )("no deja a %s correr `%s`", async (role, call) => {
    const database = await migratedDatabase();

    const attempt = await database.attempt(`set role ${role}; ${call}`);

    expect(attempt.code).toBeGreaterThan(0);
    expect(attempt.stderr).toMatch(/permission denied for function/);
  });

  it("deja a postgres, que es quien correrá pg_cron", async () => {
    const database = await migratedDatabase();

    // El privilegio y no sólo la llamada: si el arnés conecta como
    // superusuario, la llamada pasaría dijeran lo que dijeran los grants.
    const canExecute = await database.query(
      `select has_function_privilege(
                'postgres', 'public.purge_expired_records()', 'execute')`,
    );
    const attempt = await database.attempt(
      `set role postgres; ${CLEANUP_CALLS[0]}`,
    );

    expect(canExecute).toBe("t");
    expect(attempt.code, attempt.stderr).toBe(0);
  });

  it("es idempotente: aplicada dos veces no falla", async () => {
    const database = await migratedDatabase();

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
  });
});
