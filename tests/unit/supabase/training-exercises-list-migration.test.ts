import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0087_training_exercises_list.sql` contra un Postgres desechable (#910,
 * RF-10 del PRD de E35): la lista de ejercicios de Planificar por páginas,
 * de la biblioteca, del club o de los dos, y cuántos hay de cada origen. Es
 * también la búsqueda de las rutinas, que antes era
 * `search_training_exercises` de `0084`.
 *
 * Los acentos van con `chr()`: los argumentos de psql en ASCII pasan también
 * en Windows.
 */

const SEEDED_CLUB = "victoria-seadragons";
/** "í", escrita sin salir del ASCII. */
const I_ACUTE = "chr(237)";

type ListOptions = {
  readonly text: string;
  readonly source?: "library" | "club";
  readonly limit?: number;
  readonly offset?: number;
};

function rowsOf(output: string): string[] {
  return output.split("\n").filter((line) => line.trim() !== "");
}

function seededClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
}

function createOtherClub(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `insert into public.clubs (name, slug)
     values ('Otro club', 'otro-club-' || gen_random_uuid())
     returning id`,
  );
}

function seedExercise(
  database: TemporaryDatabase,
  clubId: string | null,
  nameSql: string,
): Promise<string> {
  return database.query(
    `insert into public.training_exercises (club_id, name, source)
     values (${clubId === null ? "null" : `'${clubId}'`}, ${nameSql},
             '${clubId === null ? "library" : "club"}')
     returning id`,
  );
}

function listNames(
  database: TemporaryDatabase,
  clubId: string,
  options: ListOptions,
): Promise<string> {
  const sourceSql =
    options.source === undefined ? "null" : `'${options.source}'`;
  return database.query(
    `select name from public.list_training_exercises(
       '${clubId}', '${options.text}', ${sourceSql},
       ${options.limit ?? 20}, ${options.offset ?? 0})`,
  );
}

function countBySource(
  database: TemporaryDatabase,
  clubId: string,
  text: string,
): Promise<string> {
  return database.query(
    `select library || ',' || club
       from public.count_training_exercises('${clubId}', '${text}')`,
  );
}

describeConPostgres("la lista de ejercicios", () => {
  it("encuentra la biblioteca y el club sin mayúsculas ni acentos, primero los que empiezan así", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    await seedExercise(database, null, "'Barbell Squat'");
    await seedExercise(database, null, "'Bench Press'");
    await seedExercise(database, clubId, "'Squat jump'");

    const names = await listNames(database, clubId, { text: "SQU" });

    expect(rowsOf(names)).toEqual(["Squat jump", "Barbell Squat"]);
  });

  it("encuentra un nombre con acento escribiéndolo sin él", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    await seedExercise(database, clubId, `'Sentad' || ${I_ACUTE} || 'lla'`);

    const names = await listNames(database, clubId, { text: "sentadilla" });

    expect(rowsOf(names)).toHaveLength(1);
  });

  it("no enseña los ejercicios de otro club", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const otherClubId = await createOtherClub(database);
    await seedExercise(database, otherClubId, "'Squat jump'");

    const names = await listNames(database, clubId, { text: "squat" });

    expect(names).toBe("");
  });

  it("deja elegir sólo la biblioteca o sólo los del club", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    await seedExercise(database, null, "'Barbell Squat'");
    await seedExercise(database, clubId, "'Squat jump'");

    const library = await listNames(database, clubId, {
      text: "squat",
      source: "library",
    });
    const club = await listNames(database, clubId, {
      text: "squat",
      source: "club",
    });

    expect([library, club]).toEqual(["Barbell Squat", "Squat jump"]);
  });

  it("pagina con el tope y el desplazamiento pedidos", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    for (const name of ["Squat A", "Squat B", "Squat C"]) {
      await seedExercise(database, null, `'${name}'`);
    }

    const firstPage = await listNames(database, clubId, {
      text: "squat",
      limit: 2,
    });
    const secondPage = await listNames(database, clubId, {
      text: "squat",
      limit: 2,
      offset: 2,
    });

    expect([rowsOf(firstPage), rowsOf(secondPage)]).toEqual([
      ["Squat A", "Squat B"],
      ["Squat C"],
    ]);
  });
});

describeConPostgres("cuántos ejercicios hay de cada origen", () => {
  it("cuenta los de la biblioteca y los del club que casan con el texto", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const otherClubId = await createOtherClub(database);
    await seedExercise(database, null, "'Barbell Squat'");
    await seedExercise(database, null, "'Front Squat'");
    await seedExercise(database, null, "'Bench Press'");
    await seedExercise(database, clubId, "'Squat jump'");
    await seedExercise(database, otherClubId, "'Squat hold'");

    const counts = await countBySource(database, clubId, "SQUAT");

    expect(counts).toBe("2,1");
  });

  it("da cero y cero cuando nada casa", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);

    const counts = await countBySource(database, clubId, "nada");

    expect(counts).toBe("0,0");
  });
});

describeConPostgres("las funciones de la lista", () => {
  it("no las puede llamar una sesión", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);

    const fromSession = await database.attempt(
      `set role authenticated;
       select * from public.count_training_exercises('${clubId}', '')`,
    );

    expect(fromSession.code).not.toBe(0);
    expect(fromSession.stderr).toContain("permission denied");
  });

  it("ya no queda la búsqueda de 0084", async () => {
    const database = await migratedDatabase();

    const remaining = await database.query(
      `select count(*) from pg_proc
        where proname = 'search_training_exercises'`,
    );

    expect(remaining).toBe("0");
  });
});

describeConPostgres("0087 aplicada dos veces", () => {
  it("no falla", async () => {
    const database = await migratedDatabase();

    const again = await applyRepositoryMigrations(database);

    expect(again.code, again.stderr).toBe(0);
  });
});
