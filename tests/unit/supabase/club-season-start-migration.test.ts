import { expect, it } from "vitest";
import {
  applyRepositoryMigrations,
  databaseBeforeMigration,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0075_club_season_start.sql` contra un Postgres desechable (#744, RF-1 y D1
 * del PRD de E27). La configuración del club vive en `public.clubs` desde
 * `0022_club_brand.sql`, y ahí gana el inicio de la temporada: una fecha
 * opcional, sin valor por defecto, porque sin ella la temporada cuenta desde
 * el 1 de enero.
 */

const THIS_TICKETS_MIGRATION = "0075";

describeConPostgres("el inicio de la temporada", () => {
  it("es una columna date de clubs, nullable y sin valor por defecto", async () => {
    const database = await migratedDatabase();

    const column = await database.query(
      `select data_type || ' null=' || is_nullable
              || ' default=' || coalesce(column_default, '-')
         from information_schema.columns
        where table_schema = 'public' and table_name = 'clubs'
          and column_name = 'season_starts_on'`,
    );

    expect(column).toBe("date null=YES default=-");
  });

  it("deja en null el club que ya existía", async () => {
    const database = await databaseBeforeMigration(THIS_TICKETS_MIGRATION);

    const applied = await applyRepositoryMigrations(database);

    expect(applied.code, applied.stderr).toBe(0);
    expect(
      await database.query(
        `select coalesce(season_starts_on::text, 'nulo') from public.clubs
          where slug = 'victoria-seadragons'`,
      ),
    ).toBe("nulo");
  });

  it("no pisa la fecha que un Admin guardó al repetirse", async () => {
    const database = await migratedDatabase();
    const change = await database.attempt(
      `set role service_role;
       update public.clubs set season_starts_on = '2026-03-02'
        where slug = 'victoria-seadragons'`,
    );
    expect(change.code, change.stderr).toBe(0);

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(
      await database.query(
        `select season_starts_on::text from public.clubs
          where slug = 'victoria-seadragons'`,
      ),
    ).toBe("2026-03-02");
  });

  it("no deja leerla a anon, que sólo ve la marca", async () => {
    const database = await migratedDatabase();

    const reading = await database.attempt(
      "set role anon; select season_starts_on from public.clubs",
    );

    expect(reading.code).toBeGreaterThan(0);
    expect(reading.stderr).toMatch(/permission denied for table clubs/);
  });
});
