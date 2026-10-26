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
 * `0081_position_minimums.sql` contra un Postgres desechable (#885, RF-1 y
 * D1, D4, D6, D9 y D10 del PRD de E34). Cada posición guarda un mínimo por
 * equipo (0 a 20) y una abreviatura por idioma, sembrados desde el rol de
 * `0046`: las tres con rol nacen con mínimo 1 y GK/POR, DEF/DEF y ATT/ATA.
 */

const THIS_TICKETS_MIGRATION = "0081";

const SEEDED_CLUB = "victoria-seadragons";

function clubIdOf(database: TemporaryDatabase, slug: string): Promise<string> {
  return database.query(`select id from public.clubs where slug = '${slug}'`);
}

/** Una posición sin rol, con su nombre en los dos idiomas. */
async function createPosition(
  database: TemporaryDatabase,
  clubId: string,
  englishName: string,
): Promise<string> {
  const positionId = await database.query(
    `insert into public.club_positions (club_id, sort_order)
     values ('${clubId}', 99) returning id`,
  );
  await database.query(
    `insert into public.club_position_names (position_id, club_id, locale, name)
     values ('${positionId}', '${clubId}', 'en', '${englishName}'),
            ('${positionId}', '${clubId}', 'es', '${englishName}')`,
  );
  return positionId;
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

function expectRejectedBy(result: RunResult, constraint: string): void {
  expect(result.code).toBeGreaterThan(0);
  expect(result.stderr).toContain(constraint);
}

describeConPostgres("el mínimo y la abreviatura de cada posición", () => {
  it("siembra desde el rol a las posiciones que ya existían", async () => {
    const database = await databaseBeforeMigration(THIS_TICKETS_MIGRATION);
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    await createPosition(database, clubId, "Utility");

    const applied = await applyRepositoryMigrations(database);

    expect(applied.code, applied.stderr).toBe(0);
    expect((await describePositions(database, clubId)).split("\n")).toEqual([
      "Goalkeeper|1|GK|POR",
      "Defender|1|DEF|DEF",
      "Forward|1|ATT|ATA",
      "Utility|0|-|-",
    ]);
  });

  it("siembra por el rol, no por el nombre", async () => {
    const database = await databaseBeforeMigration(THIS_TICKETS_MIGRATION);
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    const keeper = await createPosition(database, clubId, "Keeper");
    await database.query(
      `update public.club_positions set coverage = 'goalkeeper'
        where id = '${keeper}'`,
    );

    const applied = await applyRepositoryMigrations(database);

    expect(applied.code, applied.stderr).toBe(0);
    expect((await describePositions(database, clubId)).split("\n")).toContain(
      "Keeper|1|GK|POR",
    );
  });

  it("un club creado después nace con mínimo 1 y sus abreviaturas", async () => {
    const database = await migratedDatabase();

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

  it("una posición creada después nace con mínimo 0 y sin abreviatura", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);

    await createPosition(database, clubId, "Utility");

    expect((await describePositions(database, clubId)).split("\n")).toContain(
      "Utility|0|-|-",
    );
  });

  it("al repetirse no pisa el mínimo ni la abreviatura que cambió el Admin", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    await database.query(
      `update public.club_positions set min_per_team = 0
        where id = (select position_id from public.club_position_names
                     where club_id = '${clubId}' and locale = 'en'
                       and name = 'Forward');
       update public.club_position_names set short_name = null
        where club_id = '${clubId}' and locale = 'en' and name = 'Forward';
       update public.club_position_names set short_name = 'POS'
        where locale = 'es'
          and position_id = (select position_id
                               from public.club_position_names
                              where club_id = '${clubId}' and locale = 'en'
                                and name = 'Goalkeeper')`,
    );
    const afterFirst = await database.snapshot();

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(afterFirst).toMatch(/columna club_positions\.min_per_team/);
    expect(await database.snapshot()).toBe(afterFirst);
    expect((await describePositions(database, clubId)).split("\n")).toEqual([
      "Goalkeeper|1|GK|POS",
      "Defender|1|DEF|DEF",
      "Forward|0|-|ATA",
    ]);
  });

  it("renombrar una posición conserva sus abreviaturas", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    const goalkeeper = await database.query(
      `select position_id from public.club_position_names
        where club_id = '${clubId}' and locale = 'en' and name = 'Goalkeeper'`,
    );

    await database.query(
      `select public.rename_club_position(
         '${clubId}', '${goalkeeper}', 'Keeper', 'Portero')`,
    );

    expect((await describePositions(database, clubId)).split("\n")).toContain(
      "Keeper|1|GK|POR",
    );
  });

  it.each([
    ["un mínimo negativo", "min_per_team = -1"],
    ["un mínimo de 21", "min_per_team = 21"],
  ])("rechaza %s", async (_, assignment) => {
    const database = await migratedDatabase();

    const result = await database.attempt(
      `update public.club_positions set ${assignment}`,
    );

    expectRejectedBy(result, "club_positions_min_per_team_check");
  });

  it.each([
    ["una abreviatura de 5 caracteres", "'ABCDE'"],
    ["una abreviatura vacía", "''"],
    ["una abreviatura de sólo espacios", "'  '"],
  ])("rechaza %s", async (_, shortName) => {
    const database = await migratedDatabase();

    const result = await database.attempt(
      `update public.club_position_names set short_name = ${shortName}`,
    );

    expectRejectedBy(result, "club_position_names_short_name_length");
  });

  it("admite un mínimo de 20 y una abreviatura de 4 caracteres", async () => {
    const database = await migratedDatabase();

    const result = await database.attempt(
      `update public.club_positions set min_per_team = 20;
       update public.club_position_names set short_name = 'ABCD'`,
    );

    expect(result.code, result.stderr).toBe(0);
  });
});

/** La posición sembrada de `clubId` por su nombre en inglés. */
function seededPositionId(
  database: TemporaryDatabase,
  clubId: string,
  englishName: string,
): Promise<string> {
  return database.query(
    `select position_id from public.club_position_names
      where club_id = '${clubId}' and locale = 'en' and name = '${englishName}'`,
  );
}

describeConPostgres("cambiar el mínimo de una posición", () => {
  it("lo guarda y devuelve el anterior", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    const forward = await seededPositionId(database, clubId, "Forward");

    const result = await database.query(
      `
       select public.set_club_position_min_per_team(
         '${clubId}', '${forward}', 2)::text`,
    );

    expect(JSON.parse(result)).toEqual({ outcome: "changed", previous: 1 });
    expect((await describePositions(database, clubId)).split("\n")).toContain(
      "Forward|2|ATT|ATA",
    );
  });

  it("dice que no cambia si ya lo tenía", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    const forward = await seededPositionId(database, clubId, "Forward");

    const result = await database.query(
      `select public.set_club_position_min_per_team(
         '${clubId}', '${forward}', 1)::text`,
    );

    expect(JSON.parse(result)).toEqual({ outcome: "unchanged" });
  });

  it("no encuentra la posición de otro club", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    const forward = await seededPositionId(database, clubId, "Forward");
    const otherClub = await database.query(
      `insert into public.clubs (slug, name) values ('otro-club', 'Otro Club')
       returning id`,
    );

    const result = await database.query(
      `select public.set_club_position_min_per_team(
         '${otherClub}', '${forward}', 2)::text`,
    );

    expect(JSON.parse(result)).toEqual({ outcome: "not_found" });
  });

  it("no la puede llamar un usuario de la API", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    const forward = await seededPositionId(database, clubId, "Forward");

    const result = await database.attempt(
      `set role authenticated;
       select public.set_club_position_min_per_team(
         '${clubId}', '${forward}', 2)`,
    );

    expect(result.code).toBeGreaterThan(0);
    expect(result.stderr).toContain("permission denied");
  });
});

describeConPostgres("cambiar las abreviaturas de una posición", () => {
  it("las guarda y devuelve las anteriores", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    const defender = await seededPositionId(database, clubId, "Defender");

    const result = await database.query(
      `
       select public.set_club_position_short_names(
         '${clubId}', '${defender}', 'LIB', null)::text`,
    );

    expect(JSON.parse(result)).toEqual({
      outcome: "changed",
      previous: { en: "DEF", es: "DEF" },
    });
    expect((await describePositions(database, clubId)).split("\n")).toContain(
      "Defender|1|LIB|-",
    );
  });

  it("dice que no cambian si ya las tenía", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    const defender = await seededPositionId(database, clubId, "Defender");

    const result = await database.query(
      `select public.set_club_position_short_names(
         '${clubId}', '${defender}', 'DEF', 'DEF')::text`,
    );

    expect(JSON.parse(result)).toEqual({ outcome: "unchanged" });
  });

  it("rechaza una abreviatura en un idioma sin nombre", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    const defender = await seededPositionId(database, clubId, "Defender");
    await database.query(
      `delete from public.club_position_names
        where position_id = '${defender}' and locale = 'es'`,
    );

    const result = await database.query(
      `select public.set_club_position_short_names(
         '${clubId}', '${defender}', 'DEF', 'DEF')::text`,
    );

    expect(JSON.parse(result)).toEqual({
      outcome: "name_missing",
      locale: "es",
    });
  });

  it("no encuentra la posición de otro club", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    const defender = await seededPositionId(database, clubId, "Defender");
    const otherClub = await database.query(
      `insert into public.clubs (slug, name) values ('otro-club', 'Otro Club')
       returning id`,
    );

    const result = await database.query(
      `select public.set_club_position_short_names(
         '${otherClub}', '${defender}', 'LIB', null)::text`,
    );

    expect(JSON.parse(result)).toEqual({ outcome: "not_found" });
  });

  it("no la puede llamar un usuario de la API", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    const defender = await seededPositionId(database, clubId, "Defender");

    const result = await database.attempt(
      `set role authenticated;
       select public.set_club_position_short_names(
         '${clubId}', '${defender}', 'LIB', null)`,
    );

    expect(result.code).toBeGreaterThan(0);
    expect(result.stderr).toContain("permission denied");
  });
});
