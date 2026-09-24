import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0023_prune_notifications.sql` contra un Postgres desechable (#339). La
 * limpieza de avisos vive en la base para que un aviso a todo el club no se
 * convierta en una consulta pesada por destinatario: una sola sentencia borra
 * los leídos de más de 90 días y recorta a 200 avisos por socio, empezando por
 * el leído más viejo. Los sin leer no se tocan nunca.
 */

const RETENTION_DAYS = 90;
const MAX_NOTIFICATIONS_PER_MEMBER = 200;

/** Un día dentro del plazo, para que la edad no decida nada. */
const RECENT_AGE_DAYS = 1;

async function seedMember(database: TemporaryDatabase): Promise<string> {
  const clubId = await database.query(
    "select id from public.clubs where slug = 'victoria-seadragons'",
  );
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members (club_id, user_id, full_name, email)
     values ('${clubId}', '${userId}', 'Socio de prueba',
             '${userId}@example.test')`,
  );
  return userId;
}

interface SeededNotifications {
  readonly userId: string;
  readonly count: number;
  readonly ageDays: number;
  readonly isRead: boolean;
}

/** Siembra `count` avisos del socio, separados por un minuto entre sí para
 * que el orden por antigüedad no dependa del desempate. El primero es el más
 * viejo. */
async function seedNotifications(
  database: TemporaryDatabase,
  seeded: SeededNotifications,
): Promise<void> {
  const readAt = seeded.isRead ? "now()" : "null";
  await database.query(
    `insert into public.notifications
       (club_id, user_id, type, data, created_at, read_at)
     select m.club_id, m.user_id, 'role_changed',
            jsonb_build_object('seq', n),
            now() - interval '${seeded.ageDays} days'
                  + n * interval '1 minute',
            ${readAt}
       from public.members m, generate_series(1, ${seeded.count}) as n
      where m.user_id = '${seeded.userId}'`,
  );
}

async function pruneFor(
  database: TemporaryDatabase,
  userIds: readonly string[],
): Promise<string> {
  const ids = userIds.map((id) => `'${id}'`).join(", ");
  return database.query(
    `set role service_role;
     select user_id || ' ' || deleted_count || ' ' || kept_count
       from public.prune_member_notifications(array[${ids}]::uuid[])
      order by user_id`,
  );
}

async function countOf(
  database: TemporaryDatabase,
  userId: string,
  filter = "true",
): Promise<number> {
  return Number(
    await database.query(
      `select count(*) from public.notifications
        where user_id = '${userId}' and ${filter}`,
    ),
  );
}

describeConPostgres("limpieza de avisos", () => {
  it("borra un aviso leído con más de 90 días", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);
    await seedNotifications(database, {
      userId,
      count: 1,
      ageDays: RETENTION_DAYS + 1,
      isRead: true,
    });

    await pruneFor(database, [userId]);

    expect(await countOf(database, userId)).toBe(0);
  });

  it("conserva un aviso leído con menos de 90 días", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);
    await seedNotifications(database, {
      userId,
      count: 1,
      ageDays: RETENTION_DAYS - 1,
      isRead: true,
    });

    await pruneFor(database, [userId]);

    expect(await countOf(database, userId)).toBe(1);
  });

  it("conserva un aviso sin leer por viejo que sea", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);
    await seedNotifications(database, {
      userId,
      count: 1,
      ageDays: RETENTION_DAYS * 10,
      isRead: false,
    });

    await pruneFor(database, [userId]);

    expect(await countOf(database, userId)).toBe(1);
  });

  it("recorta a 200 avisos borrando los leídos más antiguos", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);
    // Primero 10 leídos (los más viejos), luego 195 sin leer: sobran 5.
    await seedNotifications(database, {
      userId,
      count: 10,
      ageDays: RECENT_AGE_DAYS + 1,
      isRead: true,
    });
    await seedNotifications(database, {
      userId,
      count: 195,
      ageDays: RECENT_AGE_DAYS,
      isRead: false,
    });

    const result = await pruneFor(database, [userId]);

    expect(result).toBe(`${userId} 5 ${MAX_NOTIFICATIONS_PER_MEMBER}`);
    expect(await countOf(database, userId)).toBe(MAX_NOTIFICATIONS_PER_MEMBER);
    const survivingReadSeqs = await database.query(
      `select string_agg(data->>'seq', ',' order by created_at)
         from public.notifications
        where user_id = '${userId}' and read_at is not null`,
    );
    expect(survivingReadSeqs).toBe("6,7,8,9,10");
  });

  it("no borra ninguno si pasa de 200 y todos están sin leer, y lo dice", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);
    await seedNotifications(database, {
      userId,
      count: MAX_NOTIFICATIONS_PER_MEMBER + 5,
      ageDays: RETENTION_DAYS * 2,
      isRead: false,
    });

    const result = await pruneFor(database, [userId]);

    expect(result).toBe(`${userId} 0 ${MAX_NOTIFICATIONS_PER_MEMBER + 5}`);
    expect(await countOf(database, userId)).toBe(
      MAX_NOTIFICATIONS_PER_MEMBER + 5,
    );
  });

  it("aplica los dos criterios a la vez: la edad y el tope", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);
    await seedNotifications(database, {
      userId,
      count: 3,
      ageDays: RETENTION_DAYS + 1,
      isRead: true,
    });
    await seedNotifications(database, {
      userId,
      count: 150,
      ageDays: RECENT_AGE_DAYS + 1,
      isRead: true,
    });

    const result = await pruneFor(database, [userId]);

    expect(result).toBe(`${userId} 3 150`);
  });

  it("no toca los avisos de otro socio", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);
    const otherUserId = await seedMember(database);
    await seedNotifications(database, {
      userId: otherUserId,
      count: 2,
      ageDays: RETENTION_DAYS + 1,
      isRead: true,
    });

    await pruneFor(database, [userId]);

    expect(await countOf(database, otherUserId)).toBe(2);
  });

  it("limpia a varios destinatarios en una sola llamada", async () => {
    const database = await migratedDatabase();
    const first = await seedMember(database);
    const second = await seedMember(database);
    for (const userId of [first, second]) {
      await seedNotifications(database, {
        userId,
        count: 1,
        ageDays: RETENTION_DAYS + 1,
        isRead: true,
      });
    }

    await pruneFor(database, [first, second]);

    expect(await countOf(database, first)).toBe(0);
    expect(await countOf(database, second)).toBe(0);
  });

  it("no escribe nada si no hay nada que borrar", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);
    await seedNotifications(database, {
      userId,
      count: 3,
      ageDays: RECENT_AGE_DAYS,
      isRead: true,
    });
    // `xmin` cambia con cualquier escritura sobre la fila.
    const versionsBefore = await database.query(
      "select string_agg(xmin::text, ',' order by id) from public.notifications",
    );

    const result = await pruneFor(database, [userId]);

    expect(result).toBe(`${userId} 0 3`);
    expect(
      await database.query(
        "select string_agg(xmin::text, ',' order by id) from public.notifications",
      ),
    ).toBe(versionsBefore);
  });
});

describeConPostgres("quién puede limpiar avisos", () => {
  it.each(["anon", "authenticated"])(
    "no deja a %s ejecutar la limpieza",
    async (role) => {
      const database = await migratedDatabase();

      const attempt = await database.attempt(
        `set role ${role};
         select * from public.prune_member_notifications(array[]::uuid[])`,
      );

      expect(attempt.code).toBeGreaterThan(0);
      expect(attempt.stderr).toMatch(
        /permission denied for function prune_member_notifications/,
      );
    },
  );

  it("es idempotente: aplicada dos veces no falla", async () => {
    const database = await migratedDatabase();

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
  });
});
