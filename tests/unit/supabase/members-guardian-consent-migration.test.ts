import { expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0007_members_guardian_consent.sql` contra un Postgres desechable.
 *
 * NFR-012 dice que no existe ninguna cuenta activa de un menor sin
 * consentimiento registrado. La aplicación ya no activa esa cuenta; esta
 * restricción es lo que lo garantiza también ante una escritura que no pase
 * por ella (una llave de servicio, una consulta a mano).
 *
 * La edad se mide el día del registro en Melbourne, igual que en
 * `requiresGuardianConsent`: cumplir 18 esperando al tutor no levanta el
 * requisito.
 */

const ACTIVE_MINOR_CONSTRAINT =
  "members_active_minor_requires_guardian_consent";
const CONSENT_COMPLETE_CONSTRAINT = "members_guardian_consent_complete";

/** Registro a las 10:00 del 12 de septiembre de 2026 en Melbourne. */
const REGISTERED_AT = "'2026-09-12T00:00:00Z'";

const GUARDIAN_COLUMNS = {
  guardian_name: "'Marta Silva'",
  guardian_email: "'marta.silva@example.test'",
  guardian_consent_at: "'2026-09-13T00:00:00Z'",
} as const;

/** Inserta un miembro con los valores SQL literales de `overrides`, igual
 * que el ayudante de `members-migration.test.ts`. */
async function insertMember(
  database: TemporaryDatabase,
  overrides: Readonly<Record<string, string>>,
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
    created_at: REGISTERED_AT,
    ...overrides,
  };
  return database.attempt(
    `insert into public.members (${Object.keys(values).join(", ")}) values (${Object.values(values).join(", ")})`,
  );
}

describeConPostgres("restricciones del consentimiento de tutor", () => {
  it("rechaza una cuenta activa de un menor sin consentimiento", async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      account_status: "'active'",
      date_of_birth: "'2010-05-20'",
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toContain(ACTIVE_MINOR_CONSTRAINT);
  });

  it("rechaza pasar a activa la cuenta de un menor que sigue sin consentimiento", async () => {
    const database = await migratedDatabase();
    const insercion = await insertMember(database, {
      date_of_birth: "'2010-05-20'",
    });
    expect(insercion.code, insercion.stderr).toBe(0);

    const activacion = await database.attempt(
      "update public.members set account_status = 'active'",
    );

    expect(activacion.code).toBeGreaterThan(0);
    expect(activacion.stderr).toContain(ACTIVE_MINOR_CONSTRAINT);
  });

  it("acepta la cuenta activa de un menor con su consentimiento registrado", async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      account_status: "'active'",
      date_of_birth: "'2010-05-20'",
      ...GUARDIAN_COLUMNS,
    });

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it("acepta activa a quien cumple 18 justo el día del registro", async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      account_status: "'active'",
      date_of_birth: "'2008-09-12'",
    });

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it("rechaza activa a quien cumple 18 al día siguiente del registro", async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      account_status: "'active'",
      date_of_birth: "'2008-09-13'",
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toContain(ACTIVE_MINOR_CONSTRAINT);
  });

  it("cuenta el día del registro en Melbourne y no en UTC", async () => {
    // 15:00 UTC del 11 es la 01:00 del 12 en Melbourne: ese día ya tiene 18.
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      account_status: "'active'",
      date_of_birth: "'2008-09-12'",
      created_at: "'2026-09-11T15:00:00Z'",
    });

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it("deja incompleta la cuenta de un menor sin consentimiento, que es su estado natural", async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      date_of_birth: "'2010-05-20'",
    });

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it.each([
    ["sin el nombre del tutor", { guardian_name: "null" }],
    ["con el nombre del tutor en blanco", { guardian_name: "'  '" }],
    ["sin el correo del tutor", { guardian_email: "null" }],
    ["sin la marca de tiempo", { guardian_consent_at: "null" }],
  ])("rechaza un consentimiento a medias: %s", async (_case, missing) => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      date_of_birth: "'2010-05-20'",
      ...GUARDIAN_COLUMNS,
      ...missing,
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toContain(CONSENT_COMPLETE_CONSTRAINT);
  });
});
