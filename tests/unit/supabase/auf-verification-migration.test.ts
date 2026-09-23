import { expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  applyRepositoryMigrations,
  databaseBeforeMigration,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0021_auf_verification.sql` contra un Postgres desechable (#274, RF-12 del
 * PRD de E5). Desde este ticket el miembro escribe su propio AUF, y lo que
 * escribe queda sin verificar hasta que un Admin lo confirme (BR-008). Hasta
 * hoy sólo lo escribía un Admin, así que los que ya había nacen verificados.
 */

const THIS_TICKETS_MIGRATION = "0021";

/** Inserta un miembro con los valores SQL literales de `overrides`, como el
 * ayudante de `member-profile-fields-migration.test.ts`. */
async function insertMember(
  database: TemporaryDatabase,
  overrides: Readonly<Record<string, string>> = {},
): Promise<RunResult> {
  const clubId = await database.query(
    "select id from public.clubs where slug = 'victoria-seadragons'",
  );
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  const values: Record<string, string> = {
    club_id: `'${clubId}'`,
    user_id: `'${userId}'`,
    full_name: "'Nerea Silva'",
    email: `'${userId}@example.test'`,
    ...overrides,
  };
  const columns = Object.keys(values).join(", ");
  return database.attempt(
    `insert into public.members (${columns}) values (${Object.values(values).join(", ")})`,
  );
}

async function expectInserted(
  database: TemporaryDatabase,
  overrides: Readonly<Record<string, string>>,
): Promise<void> {
  const insertion = await insertMember(database, overrides);
  expect(insertion.code, insertion.stderr).toBe(0);
}

describeConPostgres("la marca de verificación del AUF", () => {
  it("existe como un instante opcional", async () => {
    const database = await migratedDatabase();

    const column = await database.query(
      `select data_type || ' null=' || is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'members'
          and column_name = 'auf_verified_at'`,
    );

    expect(column).toBe("timestamp with time zone null=YES");
  });

  it("deja sin verificar un AUF que se escribe sin marcarlo", async () => {
    const database = await migratedDatabase();

    await expectInserted(database, { auf_number: "'AUF-77'" });

    expect(
      await database.query(
        "select count(*) from public.members where auf_verified_at is null",
      ),
    ).toBe("1");
  });

  it("rechaza marcar como verificado un AUF que no existe", async () => {
    const database = await migratedDatabase();

    const insertion = await insertMember(database, {
      auf_verified_at: "now()",
    });

    expect(insertion.code).toBeGreaterThan(0);
    expect(insertion.stderr).toContain("members_auf_verified_requires_number");
  });
});

describeConPostgres(
  "el AUF que ya existía cuando llegó la verificación",
  () => {
    it("queda verificado, porque hasta hoy sólo lo escribía un Admin", async () => {
      const database = await databaseBeforeMigration(THIS_TICKETS_MIGRATION);
      await expectInserted(database, { auf_number: "'AUF-00421'" });
      await expectInserted(database, {});

      const applied = await applyRepositoryMigrations(database);

      expect(applied.code, applied.stderr).toBe(0);
      expect(
        await database.query(
          `select coalesce(auf_number, 'sin AUF') || '|'
                || (auf_verified_at is not null)::text
           from public.members order by auf_number nulls last`,
        ),
      ).toBe("AUF-00421|true\nsin AUF|false");
    });

    it("no verifica al repetirse un AUF que un miembro escribió después", async () => {
      const database = await migratedDatabase();
      await expectInserted(database, { auf_number: "'AUF-PROPUESTO'" });

      const second = await applyRepositoryMigrations(database);

      expect(second.code, second.stderr).toBe(0);
      expect(
        await database.query(
          "select count(*) from public.members where auf_verified_at is null",
        ),
      ).toBe("1");
    });

    it("es idempotente: aplicada dos veces no cambia el esquema", async () => {
      const database = await migratedDatabase();
      const afterFirst = await database.snapshot();

      const second = await applyRepositoryMigrations(database);

      expect(second.code, second.stderr).toBe(0);
      // La comparación sólo vale si la descripción trae la columna nueva: dos
      // cadenas vacías también son iguales.
      expect(afterFirst).toMatch(/columna members\.auf_verified_at/);
      expect(await database.snapshot()).toBe(afterFirst);
    });
  },
);
