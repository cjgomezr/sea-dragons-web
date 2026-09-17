import { expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0011_members_email_locale.sql` contra un Postgres desechable.
 *
 * Los correos del club salen después de responder, así que leen el idioma de
 * la fila del socio (E17, RF-6). La base sólo admite los idiomas que la
 * aplicación habla, y quien ya era socio antes de la columna se queda con el
 * español, que es el idioma en que se registró.
 */

const EMAIL_LOCALE_CONSTRAINT = "members_email_locale_check";

/** Inserta un miembro con los valores SQL literales de `overrides`, igual
 * que el ayudante de `members-guardian-consent-migration.test.ts`. */
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
    email: "'nerea.silva@example.test'",
    ...overrides,
  };
  return database.attempt(
    `insert into public.members (${Object.keys(values).join(", ")}) values (${Object.values(values).join(", ")})`,
  );
}

describeConPostgres("idioma de los correos del socio", () => {
  it("la columna existe, es obligatoria y vale español por defecto", async () => {
    const database = await migratedDatabase();

    const column = await database.query(
      `select data_type || ' null=' || is_nullable || ' default=' || column_default
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'members'
          and column_name = 'email_locale'`,
    );

    expect(column).toBe("text null=NO default='es'::text");
  });

  it("un socio escrito sin idioma queda en español", async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database);

    expect(insercion.code, insercion.stderr).toBe(0);
    expect(
      await database.query("select email_locale from public.members"),
    ).toBe("es");
  });

  it.each(["en", "es"])("acepta el idioma %s", async (locale) => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      email_locale: `'${locale}'`,
    });

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it.each(["fr", "EN", "es-AR", ""])(
    "rechaza un idioma que la aplicación no habla: '%s'",
    async (locale) => {
      const database = await migratedDatabase();

      const insercion = await insertMember(database, {
        email_locale: `'${locale}'`,
      });

      expect(insercion.code).toBeGreaterThan(0);
      expect(insercion.stderr).toContain(EMAIL_LOCALE_CONSTRAINT);
    },
  );

  it("rechaza un idioma nulo", async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, { email_locale: "null" });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toContain("email_locale");
  });

  it("rechaza cambiar el idioma de un socio a uno que no se habla", async () => {
    const database = await migratedDatabase();
    const insercion = await insertMember(database);
    expect(insercion.code, insercion.stderr).toBe(0);

    const cambio = await database.attempt(
      "update public.members set email_locale = 'pt'",
    );

    expect(cambio.code).toBeGreaterThan(0);
    expect(cambio.stderr).toContain(EMAIL_LOCALE_CONSTRAINT);
  });
});
