import { expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0058_member_contact.sql` contra un Postgres desechable (#496, RF-1 del PRD
 * de E19). El teléfono propio y el contacto de emergencia son opcionales, y
 * el contacto va entero o no va: la base lo cierra aunque alguien escriba la
 * fila sin pasar por la API.
 */

const CONTACT_COLUMNS = [
  "emergency_contact_name",
  "emergency_contact_phone",
  "emergency_contact_relationship",
  "phone",
] as const;

const COMPLETE_CONTACT = {
  emergency_contact_name: "'Lucia Ruiz'",
  emergency_contact_phone: "'0412 345 678'",
  emergency_contact_relationship: "'Hermana'",
} as const;

/** Inserta un miembro con los valores SQL literales de `overrides`, igual
 * que el ayudante de `members-email-locale-migration.test.ts`. */
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
  return database.attempt(
    `insert into public.members (${Object.keys(values).join(", ")}) values (${Object.values(values).join(", ")})`,
  );
}

describeConPostgres("teléfono y contacto de emergencia del socio", () => {
  it("las cuatro columnas existen, son de texto y admiten nulo", async () => {
    const database = await migratedDatabase();

    const columns = await database.query(
      `select string_agg(column_name || ' ' || data_type || ' null=' || is_nullable, ', '
                         order by column_name)
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'members'
          and column_name in (${CONTACT_COLUMNS.map((column) => `'${column}'`).join(", ")})`,
    );

    expect(columns).toBe(
      CONTACT_COLUMNS.map((column) => `${column} text null=YES`).join(", "),
    );
  });

  it("un socio sin teléfono ni contacto se guarda", async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database);

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it("guarda un socio con su teléfono y el contacto entero", async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      phone: "'+61 (3) 9876-5432'",
      ...COMPLETE_CONTACT,
    });

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it.each(Object.keys(COMPLETE_CONTACT))(
    "rechaza un contacto sin %s",
    async (missing) => {
      const database = await migratedDatabase();

      const insercion = await insertMember(database, {
        ...COMPLETE_CONTACT,
        [missing]: "null",
      });

      expect(insercion.code).toBeGreaterThan(0);
      expect(insercion.stderr).toContain("members_emergency_contact_complete");
    },
  );

  it.each(["emergency_contact_name", "emergency_contact_relationship"])(
    "rechaza un %s en blanco o de más de 100 caracteres",
    async (column) => {
      const database = await migratedDatabase();

      const blank = await insertMember(database, {
        ...COMPLETE_CONTACT,
        [column]: "'   '",
      });
      const tooLong = await insertMember(database, {
        ...COMPLETE_CONTACT,
        [column]: `'${"a".repeat(101)}'`,
      });

      expect(blank.stderr).toContain(`members_${column}_check`);
      expect(tooLong.stderr).toContain(`members_${column}_check`);
    },
  );

  it.each([
    ["con letras", "0412 ABC 678"],
    ["con 7 dígitos", "4123456"],
    ["con 16 dígitos", "1234567890123456"],
    ["con un + en medio", "61+412345678"],
  ])("rechaza un teléfono propio %s", async (_case, phone) => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, { phone: `'${phone}'` });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toContain("members_phone_check");
  });

  it("rechaza un teléfono de contacto que no se puede marcar", async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      ...COMPLETE_CONTACT,
      emergency_contact_phone: "'llamame'",
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toContain("members_emergency_contact_phone_check");
  });
});
