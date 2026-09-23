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
 * `0022_club_brand.sql` contra un Postgres desechable (#291, RF-1 del PRD de
 * E18a). La marca del club deja de vivir en el código: nombre, iniciales,
 * color de acento y ruta del logo pasan a `public.clubs`, sembrados con lo que
 * el código tiene escrito hoy. La pantalla de entrar la enseña sin sesión, así
 * que `anon` la lee; escribirla sólo puede la llave de servicio.
 */

const THIS_TICKETS_MIGRATION = "0022";

/** El valor de `--color-accent` del tema claro en `src/app/globals.css`. */
const TODAYS_ACCENT_COLOR = "#1c6ea4";

const BRAND_COLUMNS = "name, initials, accent_color, logo_path";

/** Envuelve `sql` en el `set role` que PostgREST hace antes de cada consulta. */
function asRole(
  role: "anon" | "authenticated" | "service_role",
  sql: string,
): string {
  return `set role ${role}; ${sql}`;
}

/** Intenta cambiar una columna del club sembrado con la llave de servicio,
 * que es el único rol al que la marca le deja escribir. */
function updateSeededClub(
  database: TemporaryDatabase,
  assignment: string,
): Promise<RunResult> {
  return database.attempt(
    asRole(
      "service_role",
      `update public.clubs set ${assignment}
        where slug = 'victoria-seadragons'`,
    ),
  );
}

async function expectRejected(
  database: TemporaryDatabase,
  assignment: string,
  constraint: string,
): Promise<void> {
  const update = await updateSeededClub(database, assignment);

  expect(update.code).toBeGreaterThan(0);
  expect(update.stderr).toContain(constraint);
}

describeConPostgres("las columnas de la marca", () => {
  it("existen en clubs con sus tipos y su nulabilidad", async () => {
    const database = await migratedDatabase();

    const columns = await database.query(
      `select column_name || ' ' || data_type || ' null=' || is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'clubs'
          and column_name in ('name', 'initials', 'accent_color', 'logo_path')
        order by column_name`,
    );

    expect(columns).toBe(
      [
        "accent_color text null=NO",
        "initials text null=YES",
        "logo_path text null=YES",
        "name text null=NO",
      ].join("\n"),
    );
  });

  it("dejan nulos las iniciales y el logo de un club que no los trae", async () => {
    const database = await migratedDatabase();

    const insertion = await database.attempt(
      asRole(
        "service_role",
        "insert into public.clubs (slug, name) values ('otro-club', 'Otro Club')",
      ),
    );

    expect(insertion.code, insertion.stderr).toBe(0);
    expect(
      await database.query(
        `select concat_ws('|', name, coalesce(initials, 'nulo'), accent_color,
                          coalesce(logo_path, 'nulo'))
           from public.clubs where slug = 'otro-club'`,
      ),
    ).toBe(`Otro Club|nulo|${TODAYS_ACCENT_COLOR}|nulo`);
  });
});

describeConPostgres("las restricciones de la marca", () => {
  it("rechaza un nombre vacío", async () => {
    const database = await migratedDatabase();

    await expectRejected(database, "name = ''", "clubs_name_length");
  });

  it("rechaza un nombre hecho sólo de espacios", async () => {
    const database = await migratedDatabase();

    await expectRejected(database, "name = '   '", "clubs_name_length");
  });

  it("rechaza un nombre de más de 60 caracteres", async () => {
    const database = await migratedDatabase();

    await expectRejected(
      database,
      "name = repeat('a', 61)",
      "clubs_name_length",
    );
  });

  it("acepta un nombre de 60 caracteres justos", async () => {
    const database = await migratedDatabase();

    const update = await updateSeededClub(database, "name = repeat('a', 60)");

    expect(update.code, update.stderr).toBe(0);
  });

  it("rechaza unas iniciales de más de 3 caracteres", async () => {
    const database = await migratedDatabase();

    await expectRejected(
      database,
      "initials = 'VSDR'",
      "clubs_initials_length",
    );
  });

  it("rechaza unas iniciales vacías, que para no tenerlas está el nulo", async () => {
    const database = await migratedDatabase();

    await expectRejected(database, "initials = ''", "clubs_initials_length");
  });

  it.each([
    ["sin almohadilla", "1c6ea4"],
    ["de 3 dígitos", "#16a"],
    ["de 8 dígitos", "#1c6ea4ff"],
    ["con un dígito que no es hexadecimal", "#1c6eg4"],
    ["con un nombre de color", "blue"],
  ])("rechaza un color %s", async (_case, color) => {
    const database = await migratedDatabase();

    await expectRejected(
      database,
      `accent_color = '${color}'`,
      "clubs_accent_color_hex",
    );
  });

  it("acepta un hexadecimal de 6 dígitos en mayúsculas", async () => {
    const database = await migratedDatabase();

    const update = await updateSeededClub(database, "accent_color = '#1C6EA4'");

    expect(update.code, update.stderr).toBe(0);
  });
});

describeConPostgres("privilegios de la marca", () => {
  it("deja a anon leer la marca sin sesión", async () => {
    const database = await migratedDatabase();

    const reading = await database.attempt(
      asRole(
        "anon",
        `select concat_ws('|', ${BRAND_COLUMNS}) from public.clubs`,
      ),
    );

    expect(reading.code, reading.stderr).toBe(0);
    expect(reading.stdout).toContain(
      `Victoria Seadragons|VS|${TODAYS_ACCENT_COLOR}`,
    );
  });

  it("no deja a anon leer lo que no es la marca", async () => {
    const database = await migratedDatabase();

    const reading = await database.attempt(
      asRole("anon", "select slug from public.clubs"),
    );

    expect(reading.code).toBeGreaterThan(0);
    expect(reading.stderr).toMatch(/permission denied for table clubs/);
  });

  it("no deja a anon escribir la marca", async () => {
    const database = await migratedDatabase();

    const update = await database.attempt(
      asRole("anon", "update public.clubs set name = 'Otro nombre'"),
    );

    expect(update.code).toBeGreaterThan(0);
    expect(update.stderr).toMatch(/permission denied for table clubs/);
  });

  it("deja a authenticated leer la marca", async () => {
    const database = await migratedDatabase();

    const reading = await database.attempt(
      asRole(
        "authenticated",
        `select concat_ws('|', ${BRAND_COLUMNS}) from public.clubs`,
      ),
    );

    expect(reading.code, reading.stderr).toBe(0);
    expect(reading.stdout).toContain(
      `Victoria Seadragons|VS|${TODAYS_ACCENT_COLOR}`,
    );
  });

  it("no deja a authenticated escribir la marca", async () => {
    const database = await migratedDatabase();

    const update = await database.attempt(
      asRole(
        "authenticated",
        "update public.clubs set accent_color = '#000000'",
      ),
    );

    expect(update.code).toBeGreaterThan(0);
    expect(update.stderr).toMatch(/permission denied for table clubs/);
  });

  it("deja a service_role escribir la marca", async () => {
    const database = await migratedDatabase();

    const update = await updateSeededClub(
      database,
      "initials = 'VSD', logo_path = 'brand/logo.svg'",
    );

    expect(update.code, update.stderr).toBe(0);
    expect(
      await database.query(
        `select initials || '|' || logo_path from public.clubs
          where slug = 'victoria-seadragons'`,
      ),
    ).toBe("VSD|brand/logo.svg");
  });

  it("queda en el contrato congelado la lectura de anon por columnas", async () => {
    const database = await migratedDatabase();

    const snapshot = await database.snapshot();

    expect(snapshot).toMatch(/grant-columna clubs\.initials anon SELECT/);
    expect(snapshot).not.toMatch(/grant-columna clubs\.slug anon/);
  });
});

describeConPostgres("el club que ya existía cuando llegó la marca", () => {
  it("queda con el nombre, las iniciales y el color de hoy", async () => {
    const database = await databaseBeforeMigration(THIS_TICKETS_MIGRATION);

    const applied = await applyRepositoryMigrations(database);

    expect(applied.code, applied.stderr).toBe(0);
    expect(
      await database.query(
        `select concat_ws('|', name, initials, accent_color,
                          coalesce(logo_path, 'sin logo'))
           from public.clubs where slug = 'victoria-seadragons'`,
      ),
    ).toBe(`Victoria Seadragons|VS|${TODAYS_ACCENT_COLOR}|sin logo`);
  });

  it("no pisa la marca que alguien cambió después al repetirse", async () => {
    const database = await migratedDatabase();
    await updateSeededClub(database, "initials = 'XY'");

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(
      await database.query(
        "select initials from public.clubs where slug = 'victoria-seadragons'",
      ),
    ).toBe("XY");
  });

  it("es idempotente: aplicada dos veces no duplica ni cambia el esquema", async () => {
    const database = await migratedDatabase();
    const afterFirst = await database.snapshot();

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    // La comparación sólo vale si la descripción trae la marca: dos cadenas
    // vacías también son iguales.
    expect(afterFirst).toMatch(/columna clubs\.accent_color/);
    expect(await database.snapshot()).toBe(afterFirst);
    expect(await database.query("select count(*) from public.clubs")).toBe("1");
  });
});
