import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  databaseBeforeMigration,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0082_drop_position_coverage.sql` contra un Postgres desechable (#889, RF-6
 * y D11 del PRD de E34). El rol de juego de `0046` ya no lo lee nadie: la
 * columna y su `check` se van, y reaplicar el histórico entero, como hace
 * producción en cada merge, no los devuelve ni toca los mínimos ni las
 * abreviaturas.
 */

const THIS_TICKETS_MIGRATION = "0082";

const SEEDED_CLUB = "victoria-seadragons";

function clubIdOf(database: TemporaryDatabase, slug: string): Promise<string> {
  return database.query(`select id from public.clubs where slug = '${slug}'`);
}

function coverageColumnCount(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `select count(*) from information_schema.columns
      where table_schema = 'public'
        and table_name = 'club_positions'
        and column_name = 'coverage'`,
  );
}

function coverageCheckCount(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `select count(*) from pg_constraint
      where conname = 'club_positions_coverage_check'`,
  );
}

/** `nombre|mínimo|abreviatura en|abreviatura es` de cada posición del club,
 * en su orden. */
function describePositions(
  database: TemporaryDatabase,
  clubId: string,
): Promise<string> {
  return database.query(
    `select en.name || '|' || p.min_per_team || '|'
            || coalesce(en.short_name, '-') || '|'
            || coalesce(es.short_name, '-')
       from public.club_positions p
       join public.club_position_names en
         on en.position_id = p.id and en.locale = 'en'
       join public.club_position_names es
         on es.position_id = p.id and es.locale = 'es'
      where p.club_id = '${clubId}'
      order by p.sort_order, en.name`,
  );
}

/** Lo que un Admin de E34 pudo dejar: un mínimo en 0, uno en 2 y una
 * abreviatura quitada. */
function changeMinimumsAndShortNames(
  database: TemporaryDatabase,
  clubId: string,
): Promise<string> {
  return database.query(
    `update public.club_positions set min_per_team = 0
      where id = (select position_id from public.club_position_names
                   where club_id = '${clubId}' and locale = 'en'
                     and name = 'Forward');
     update public.club_positions set min_per_team = 2
      where id = (select position_id from public.club_position_names
                   where club_id = '${clubId}' and locale = 'en'
                     and name = 'Defender');
     update public.club_position_names set short_name = null
      where club_id = '${clubId}' and locale = 'en' and name = 'Forward'`,
  );
}

const CHANGED_POSITIONS = [
  "Goalkeeper|1|GK|POR",
  "Defender|2|DEF|DEF",
  "Forward|0|-|ATA",
];

describeConPostgres("el rol de juego de las posiciones, retirado", () => {
  it("quita la columna y su check", async () => {
    const database = await migratedDatabase();

    expect(await coverageColumnCount(database)).toBe("0");
    expect(await coverageCheckCount(database)).toBe("0");
  });

  it("aplicar el histórico dos veces sobre una base vacía no la devuelve", async () => {
    const database = await migratedDatabase();
    const afterFirst = await database.snapshot();

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(afterFirst).toMatch(/columna club_positions\.min_per_team/);
    expect(await database.snapshot()).toBe(afterFirst);
    expect(await coverageColumnCount(database)).toBe("0");
    expect(await coverageCheckCount(database)).toBe("0");
  });

  it("sobre una base con datos de E34 sólo quita el rol", async () => {
    const database = await databaseBeforeMigration(THIS_TICKETS_MIGRATION);
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    await changeMinimumsAndShortNames(database, clubId);

    const applied = await applyRepositoryMigrations(database);

    expect(applied.code, applied.stderr).toBe(0);
    expect(await coverageColumnCount(database)).toBe("0");
    expect((await describePositions(database, clubId)).split("\n")).toEqual(
      CHANGED_POSITIONS,
    );
  });

  it("reaplicada sobre datos de E34 no devuelve el rol ni toca los mínimos", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    await changeMinimumsAndShortNames(database, clubId);

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(await coverageColumnCount(database)).toBe("0");
    expect((await describePositions(database, clubId)).split("\n")).toEqual(
      CHANGED_POSITIONS,
    );
  });

  it("un club creado tras reaplicar nace con sus mínimos y abreviaturas", async () => {
    const database = await migratedDatabase();
    const second = await applyRepositoryMigrations(database);
    expect(second.code, second.stderr).toBe(0);

    const otherClub = await database.query(
      `insert into public.clubs (slug, name) values ('otro-club', 'Otro Club')
       returning id`,
    );

    expect((await describePositions(database, otherClub)).split("\n")).toEqual([
      "Goalkeeper|1|GK|POR",
      "Defender|1|DEF|DEF",
      "Forward|1|ATT|ATA",
    ]);
  });
});
