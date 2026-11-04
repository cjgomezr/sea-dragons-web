import { expect, it } from "vitest";
import {
  applyRepositoryMigrations,
  databaseBeforeMigration,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0094_club_registration_name.sql` contra un Postgres desechable (#967, RF-7
 * y D11 del PRD de E37). El nombre del registro del club es texto opcional de
 * 1 a 16 caracteres recortado; el club que ya existía queda en "AUF" y uno
 * nuevo nace nulo.
 */

const THIS_TICKETS_MIGRATION = "0094";

const READ_DEFAULT_CLUB_NAME = `select coalesce(registration_name, 'nulo')
   from public.clubs where slug = 'victoria-seadragons'`;

describeConPostgres("el nombre del registro del club", () => {
  it("es una columna text de clubs, nullable y sin valor por defecto", async () => {
    const database = await migratedDatabase();

    const column = await database.query(
      `select data_type || ' null=' || is_nullable
              || ' default=' || coalesce(column_default, '-')
         from information_schema.columns
        where table_schema = 'public' and table_name = 'clubs'
          and column_name = 'registration_name'`,
    );

    expect(column).toBe("text null=YES default=-");
  });

  it("deja en AUF el club que ya existía", async () => {
    const database = await databaseBeforeMigration(THIS_TICKETS_MIGRATION);

    const applied = await applyRepositoryMigrations(database);

    expect(applied.code, applied.stderr).toBe(0);
    expect(await database.query(READ_DEFAULT_CLUB_NAME)).toBe("AUF");
  });

  it("deja nulo un club que nace después", async () => {
    const database = await migratedDatabase();

    const created = await database.attempt(
      `insert into public.clubs (slug, name) values ('otro-club', 'Otro club')`,
    );

    expect(created.code, created.stderr).toBe(0);
    expect(
      await database.query(
        `select coalesce(registration_name, 'nulo') from public.clubs
          where slug = 'otro-club'`,
      ),
    ).toBe("nulo");
  });

  it("no pisa el nombre que guardó un Admin, ni su nulo, al repetirse", async () => {
    const database = await migratedDatabase();
    const change = await database.attempt(
      `update public.clubs set registration_name = null
        where slug = 'victoria-seadragons'`,
    );
    expect(change.code, change.stderr).toBe(0);

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(await database.query(READ_DEFAULT_CLUB_NAME)).toBe("nulo");
  });

  it("acepta 16 caracteres recortados y rechaza 17", async () => {
    const database = await migratedDatabase();

    const sixteen = await database.attempt(
      `update public.clubs set registration_name = '  WWWWWWWWWWWWWWWW  '
        where slug = 'victoria-seadragons'`,
    );
    const seventeen = await database.attempt(
      `update public.clubs set registration_name = 'WWWWWWWWWWWWWWWWW'
        where slug = 'victoria-seadragons'`,
    );

    expect(sixteen.code, sixteen.stderr).toBe(0);
    expect(seventeen.code).toBeGreaterThan(0);
    expect(seventeen.stderr).toMatch(/clubs_registration_name_length/);
  });

  it("rechaza un nombre que sólo tiene espacios", async () => {
    const database = await migratedDatabase();

    const blank = await database.attempt(
      `update public.clubs set registration_name = '   '
        where slug = 'victoria-seadragons'`,
    );

    expect(blank.code).toBeGreaterThan(0);
    expect(blank.stderr).toMatch(/clubs_registration_name_length/);
  });
});
