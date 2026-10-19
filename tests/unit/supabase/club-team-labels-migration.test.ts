import { expect, it } from "vitest";
import {
  applyRepositoryMigrations,
  databaseBeforeMigration,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0076_club_team_labels.sql` contra un Postgres desechable (#755, RF-1 y D1
 * del PRD de E28). El nombre y el color de los dos equipos pasan a ser del
 * club. Viven en `public.clubs`, como el resto de su configuración desde
 * `0022_club_brand.sql`, con Team Kelp y Team Tide por defecto.
 */

const THIS_TICKETS_MIGRATION = "0076";

const CLUB = "slug = 'victoria-seadragons'";

describeConPostgres("los equipos del club", () => {
  it("son cuatro columnas text de clubs, no nulas, con Kelp y Tide por defecto", async () => {
    const database = await migratedDatabase();

    const columns = await database.query(
      `select string_agg(column_name || ' null=' || is_nullable
                         || ' default=' || column_default, ' | '
                         order by column_name)
         from information_schema.columns
        where table_schema = 'public' and table_name = 'clubs'
          and column_name like 'team\\_%'`,
    );

    expect(columns).toBe(
      [
        "team_a_color null=NO default='#1C6EA4'::text",
        "team_a_name null=NO default='Team Kelp'::text",
        "team_b_color null=NO default='#C99A3E'::text",
        "team_b_name null=NO default='Team Tide'::text",
      ].join(" | "),
    );
  });

  it("da los de por defecto al club que ya existía", async () => {
    const database = await databaseBeforeMigration(THIS_TICKETS_MIGRATION);

    const applied = await applyRepositoryMigrations(database);

    expect(applied.code, applied.stderr).toBe(0);
    expect(
      await database.query(
        `select team_a_name || ' ' || team_a_color || ' '
                || team_b_name || ' ' || team_b_color
           from public.clubs where ${CLUB}`,
      ),
    ).toBe("Team Kelp #1C6EA4 Team Tide #C99A3E");
  });

  it("no pisa los equipos que un Coach guardó al repetirse", async () => {
    const database = await migratedDatabase();
    const change = await database.attempt(
      `set role service_role;
       update public.clubs set team_a_name = 'Orcas', team_a_color = '#D64545'
        where ${CLUB}`,
    );
    expect(change.code, change.stderr).toBe(0);

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(
      await database.query(
        `select team_a_name || ' ' || team_a_color from public.clubs
          where ${CLUB}`,
      ),
    ).toBe("Orcas #D64545");
  });

  it.each([
    ["un nombre vacío tras recortar", "team_a_name = '   '"],
    ["un nombre de 25 caracteres", `team_b_name = '${"x".repeat(25)}'`],
    ["un color que no es #RRGGBB", "team_a_color = 'blue'"],
    ["los dos colores iguales", "team_b_color = '#1C6EA4'"],
    ["los dos colores iguales con otra caja", "team_b_color = '#1c6ea4'"],
  ])("rechaza %s", async (_, assignment) => {
    const database = await migratedDatabase();

    const change = await database.attempt(
      `set role service_role;
       update public.clubs set ${assignment} where ${CLUB}`,
    );

    expect(change.code).toBeGreaterThan(0);
    expect(change.stderr).toMatch(/violates check constraint "clubs_team_/);
  });

  it("acepta un nombre de 24 caracteres con espacios alrededor", async () => {
    const database = await migratedDatabase();

    const change = await database.attempt(
      `set role service_role;
       update public.clubs set team_a_name = '  ${"x".repeat(24)}  '
        where ${CLUB}`,
    );

    expect(change.code, change.stderr).toBe(0);
  });

  it("no deja leerlos a anon, que sólo ve la marca", async () => {
    const database = await migratedDatabase();

    const reading = await database.attempt(
      "set role anon; select team_a_name from public.clubs",
    );

    expect(reading.code).toBeGreaterThan(0);
    expect(reading.stderr).toMatch(/permission denied for table clubs/);
  });
});
