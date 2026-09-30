import { expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0048_news_seen_at.sql` contra un Postgres desechable.
 *
 * La marca de la última visita a Noticias (#424, D2 del PRD de E14): de ella
 * sale la cuenta de noticias sin leer del dashboard. Sin marca, la cuenta
 * mira los últimos 30 días, así que la columna nace nula. La escribe sólo el
 * servidor con la llave de servicio: el socio no la mueve con su sesión.
 */

async function insertActiveMember(
  database: TemporaryDatabase,
): Promise<string> {
  const clubId = await database.query(
    "select id from public.clubs where slug = 'victoria-seadragons'",
  );
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status)
     values ('${clubId}', '${userId}', 'Nerea Silva',
             'nerea.silva@example.test', 'active')`,
  );
  return userId;
}

/** Corre `sql` como lo haría PostgREST con la sesión de `userId`. */
function asMember(
  database: TemporaryDatabase,
  userId: string,
  sql: string,
): Promise<RunResult> {
  return database.attempt(
    `set role authenticated;
     set request.jwt.claims = '{"sub":"${userId}"}';
     ${sql}`,
  );
}

describeConPostgres("la marca de visita a Noticias", () => {
  it("la columna existe, admite nulo y no tiene valor por defecto", async () => {
    const database = await migratedDatabase();

    const column = await database.query(
      `select data_type || ' null=' || is_nullable || ' default='
              || coalesce(column_default, '-')
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'members'
          and column_name = 'news_seen_at'`,
    );

    expect(column).toBe("timestamp with time zone null=YES default=-");
  });

  it("un socio nuevo nace sin marca", async () => {
    const database = await migratedDatabase();
    const userId = await insertActiveMember(database);

    const seenAt = await database.query(
      `select coalesce(news_seen_at::text, 'nula')
         from public.members where user_id = '${userId}'`,
    );

    expect(seenAt).toBe("nula");
  });

  it("el servidor la escribe con la llave de servicio", async () => {
    const database = await migratedDatabase();
    const userId = await insertActiveMember(database);

    const write = await database.attempt(
      `set role service_role;
       update public.members set news_seen_at = now()
        where user_id = '${userId}'`,
    );

    expect(write.code, write.stderr).toBe(0);
  });

  it("el socio no la escribe con su sesión", async () => {
    const database = await migratedDatabase();
    const userId = await insertActiveMember(database);

    const write = await asMember(
      database,
      userId,
      `update public.members set news_seen_at = now()
        where user_id = '${userId}'`,
    );

    expect(write.code).toBeGreaterThan(0);
    expect(write.stderr).toContain("permission denied");
  });

  it("aplicada dos veces deja la misma columna", async () => {
    const database = await migratedDatabase();

    const again = await applyRepositoryMigrations(database);

    expect(again.code, again.stderr).toBe(0);
  });
});
