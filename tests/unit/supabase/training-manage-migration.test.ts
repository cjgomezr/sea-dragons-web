import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0084_training_manage.sql` contra un Postgres desechable (#903, RF-10,
 * RF-11, D11 y D13 del PRD de E35): el nombre de una marca sin repetir sin
 * contar mayúsculas ni acentos, las cuentas de cada marca sin valores y el
 * nombre repetido entre la biblioteca y el club. La búsqueda de ejercicios
 * pasó a `0087` y la prueba `training-exercises-list-migration.test.ts`.
 *
 * Los acentos van con `chr()`: los argumentos de psql en ASCII pasan también
 * en Windows.
 */

const SEEDED_CLUB = "victoria-seadragons";
/** "í", escrita sin salir del ASCII. */
const I_ACUTE = "chr(237)";

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

function seedMark(
  database: TemporaryDatabase,
  clubId: string,
  nameSql: string,
): Promise<string> {
  return database.query(
    `insert into public.training_marks (club_id, name)
     values ('${clubId}', ${nameSql})
     returning id`,
  );
}

function seedExercise(
  database: TemporaryDatabase,
  clubId: string | null,
  name: string,
): Promise<string> {
  return database.query(
    `insert into public.training_exercises (club_id, name, source)
     values (${clubId === null ? "null" : `'${clubId}'`}, '${name}',
             '${clubId === null ? "library" : "club"}')
     returning id`,
  );
}

async function seedPlayer(
  database: TemporaryDatabase,
  clubId: string,
): Promise<string> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status, role)
     values ('${clubId}', '${userId}', 'Tere Training',
             '${userId}@example.test', 'active', 'Player')`,
  );
  return userId;
}

/** Una rutina con una fila de "% de" la marca. */
async function seedRowUsingMark(
  database: TemporaryDatabase,
  clubId: string,
  markId: string,
): Promise<void> {
  const routineId = await database.query(
    `insert into public.training_routines (club_id, name, color_index)
     values ('${clubId}', 'Strength A', 0)
     returning id`,
  );
  const exerciseId = await seedExercise(database, clubId, "Back squat");
  await database.query(
    `insert into public.training_routine_items
       (club_id, routine_id, position, kind, exercise_id, load_kind,
        load_mark_id, load_pct)
     values ('${clubId}', '${routineId}', 0, 'exercise', '${exerciseId}',
             'pct', '${markId}', 75)`,
  );
}

describeConPostgres("las marcas del club sin repetir", () => {
  it("rechaza un nombre que sólo cambia en mayúsculas o acentos", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    await seedMark(database, clubId, "'Sentadilla'");

    const repeated = await database.attempt(
      `insert into public.training_marks (club_id, name)
       values ('${clubId}', ' sentad' || ${I_ACUTE} || 'lla ')`,
    );

    expect(repeated.code).not.toBe(0);
    expect(repeated.stderr).toContain(
      "training_marks_club_id_name_normalized_key",
    );
  });

  it("deja el mismo nombre en otro club", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const otherClubId = await createOtherClub(database);
    await seedMark(database, clubId, "'Sentadilla'");

    const elsewhere = await database.attempt(
      `insert into public.training_marks (club_id, name)
       values ('${otherClubId}', 'Sentadilla')`,
    );

    expect(elsewhere.code, elsewhere.stderr).toBe(0);
  });
});

describeConPostgres("las cuentas de cada marca", () => {
  it("cuenta las filas que la usan y los socios que la registraron", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const squatId = await seedMark(database, clubId, "'Back squat'");
    const benchId = await seedMark(database, clubId, "'Bench press'");
    await seedRowUsingMark(database, clubId, squatId);
    for (const value of [80, 95]) {
      const userId = await seedPlayer(database, clubId);
      await database.query(
        `insert into public.training_member_marks
           (user_id, club_id, mark_id, value)
         values ('${userId}', '${clubId}', '${benchId}', ${value})`,
      );
    }

    const usage = await database.query(
      `select mark_id || '|' || routine_rows || '|' || members
         from public.training_mark_usage('${clubId}')
        order by routine_rows desc`,
    );

    expect(rowsOf(usage)).toEqual([`${squatId}|1|0`, `${benchId}|0|2`]);
  });

  it("no devuelve las marcas de otro club", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const otherClubId = await createOtherClub(database);
    await seedMark(database, otherClubId, "'Deadlift'");

    const usage = await database.query(
      `select count(*) from public.training_mark_usage('${clubId}')`,
    );

    expect(usage).toBe("0");
  });

  it("no la puede llamar una sesión", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);

    const fromSession = await database.attempt(
      `set role authenticated;
       select * from public.training_mark_usage('${clubId}')`,
    );

    expect(fromSession.code).not.toBe(0);
    expect(fromSession.stderr).toContain("permission denied");
  });
});

describeConPostgres(
  "el nombre de un ejercicio entre la biblioteca y el club",
  () => {
    async function isTaken(
      database: TemporaryDatabase,
      clubId: string,
      options: { readonly name: string; readonly exceptId: string | null },
    ): Promise<string> {
      const exceptSql =
        options.exceptId === null ? "null" : `'${options.exceptId}'`;
      return database.query(
        `select public.training_exercise_name_taken(
         '${clubId}', '${options.name}', ${exceptSql})`,
      );
    }

    it("lo da por usado si está en la biblioteca o en el club", async () => {
      const database = await migratedDatabase();
      const clubId = await seededClubId(database);
      await seedExercise(database, null, "Barbell Squat");
      await seedExercise(database, clubId, "Front crawl");

      const library = await isTaken(database, clubId, {
        name: " barbell SQUAT ",
        exceptId: null,
      });
      const club = await isTaken(database, clubId, {
        name: "front crawl",
        exceptId: null,
      });

      expect([library, club]).toEqual(["t", "t"]);
    });

    it("no cuenta el de otro club ni el propio al renombrarlo", async () => {
      const database = await migratedDatabase();
      const clubId = await seededClubId(database);
      const otherClubId = await createOtherClub(database);
      await seedExercise(database, otherClubId, "Fin kick");
      const ownId = await seedExercise(database, clubId, "Front crawl");

      const otherClub = await isTaken(database, clubId, {
        name: "Fin kick",
        exceptId: null,
      });
      const itself = await isTaken(database, clubId, {
        name: "Front crawl",
        exceptId: ownId,
      });

      expect([otherClub, itself]).toEqual(["f", "f"]);
    });
  },
);

describeConPostgres("0084 aplicada dos veces", () => {
  it("no falla ni pierde las marcas", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    await seedMark(database, clubId, "'Back squat'");

    const again = await applyRepositoryMigrations(database);

    expect(again.code, again.stderr).toBe(0);
    const marks = await database.query(
      `select name_normalized from public.training_marks
        where club_id = '${clubId}'`,
    );
    expect(marks).toBe("back squat");
  });
});
