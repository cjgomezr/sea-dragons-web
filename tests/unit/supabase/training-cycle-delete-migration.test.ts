import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0088_training_cycle_delete.sql` contra un Postgres desechable (#935):
 * borrar un borrador o un archivado se lleva sus semanas, sus días y sus
 * rutinas propias con sus filas, y deja las compartidas, los ejercicios y
 * las marcas. El activo no se borra.
 */

const SEEDED_CLUB = "victoria-seadragons";

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

function seedCycle(
  database: TemporaryDatabase,
  clubId: string,
  status: string,
): Promise<string> {
  return database.query(
    `insert into public.training_cycles (club_id, name, start_date, weeks, status)
     values ('${clubId}', 'Winter', '2026-11-16', 4, '${status}')
     returning id`,
  );
}

function seedRoutine(
  database: TemporaryDatabase,
  clubId: string,
  cycleId: string | null,
): Promise<string> {
  return database.query(
    `insert into public.training_routines (club_id, cycle_id, name, color_index)
     values ('${clubId}', ${cycleId === null ? "null" : `'${cycleId}'`},
             'Strength', 0)
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

type SeededPlan = {
  readonly clubId: string;
  readonly cycleId: string;
  readonly ownRoutineId: string;
  readonly sharedRoutineId: string;
  readonly exerciseId: string;
  readonly markId: string;
};

/** Un ciclo con una semana, dos días (una rutina propia y una compartida),
 * filas en las dos rutinas que usan un ejercicio y una marca del club, y el
 * valor de un socio en esa marca. */
async function seedPlan(
  database: TemporaryDatabase,
  status: string,
): Promise<SeededPlan> {
  const clubId = await seededClubId(database);
  const cycleId = await seedCycle(database, clubId, status);
  const ownRoutineId = await seedRoutine(database, clubId, cycleId);
  const sharedRoutineId = await seedRoutine(database, clubId, null);
  const exerciseId = await database.query(
    `insert into public.training_exercises (club_id, name, source)
     values ('${clubId}', 'Back squat', 'club')
     returning id`,
  );
  const markId = await database.query(
    `insert into public.training_marks (club_id, name)
     values ('${clubId}', 'Back squat 1RM')
     returning id`,
  );
  const playerId = await seedPlayer(database, clubId);
  await database.query(
    `insert into public.training_member_marks (user_id, club_id, mark_id, value)
     values ('${playerId}', '${clubId}', '${markId}', 100)`,
  );
  await database.query(
    `insert into public.training_routine_items
       (club_id, routine_id, position, kind, exercise_id, load_kind,
        load_mark_id, load_pct)
     values ('${clubId}', '${ownRoutineId}', 0, 'exercise', '${exerciseId}',
             'pct', '${markId}', 75),
            ('${clubId}', '${sharedRoutineId}', 0, 'exercise', '${exerciseId}',
             'pct', '${markId}', 80)`,
  );
  await database.query(
    `insert into public.training_cycle_weeks (club_id, cycle_id, week_no, note)
     values ('${clubId}', '${cycleId}', 1, 'Base')`,
  );
  await database.query(
    `insert into public.training_cycle_days
       (club_id, cycle_id, week_no, weekday, slot, routine_id)
     values ('${clubId}', '${cycleId}', 1, 0, 1, '${ownRoutineId}'),
            ('${clubId}', '${cycleId}', 1, 2, 1, '${sharedRoutineId}')`,
  );
  return {
    clubId,
    cycleId,
    ownRoutineId,
    sharedRoutineId,
    exerciseId,
    markId,
  };
}

function deleteCycle(
  database: TemporaryDatabase,
  target: { readonly clubId: string; readonly cycleId: string },
): Promise<string> {
  return database.query(
    `select deleted || '|' || coalesce(previous_status, '-') || '|'
            || routines_deleted
       from public.delete_training_cycle(
         '${target.clubId}', '${target.cycleId}')`,
  );
}

function countWhere(
  database: TemporaryDatabase,
  table: string,
  condition: string,
): Promise<string> {
  return database.query(
    `select count(*) from public.${table} where ${condition}`,
  );
}

describeConPostgres("borrar un ciclo", () => {
  it.each(["draft", "archived"])(
    "borra uno en %s y dice cuántas rutinas propias se fueron",
    async (status) => {
      const database = await migratedDatabase();
      const plan = await seedPlan(database, status);

      const result = await deleteCycle(database, plan);

      expect(result).toBe(`true|${status}|1`);
      expect(
        await countWhere(database, "training_cycles", `id = '${plan.cycleId}'`),
      ).toBe("0");
    },
  );

  it("se lleva las semanas, los días y las rutinas propias con sus filas", async () => {
    const database = await migratedDatabase();
    const plan = await seedPlan(database, "draft");

    await deleteCycle(database, plan);

    const cycleRows = `cycle_id = '${plan.cycleId}'`;
    expect(await countWhere(database, "training_cycle_weeks", cycleRows)).toBe(
      "0",
    );
    expect(await countWhere(database, "training_cycle_days", cycleRows)).toBe(
      "0",
    );
    expect(
      await countWhere(
        database,
        "training_routines",
        `id = '${plan.ownRoutineId}'`,
      ),
    ).toBe("0");
    expect(
      await countWhere(
        database,
        "training_routine_items",
        `routine_id = '${plan.ownRoutineId}'`,
      ),
    ).toBe("0");
  });

  it("deja la compartida con sus filas, el ejercicio, la marca y el valor del socio", async () => {
    const database = await migratedDatabase();
    const plan = await seedPlan(database, "archived");

    await deleteCycle(database, plan);

    expect(
      await countWhere(
        database,
        "training_routine_items",
        `routine_id = '${plan.sharedRoutineId}'`,
      ),
    ).toBe("1");
    expect(
      await countWhere(
        database,
        "training_exercises",
        `id = '${plan.exerciseId}'`,
      ),
    ).toBe("1");
    expect(
      await countWhere(database, "training_marks", `id = '${plan.markId}'`),
    ).toBe("1");
    expect(
      await countWhere(
        database,
        "training_member_marks",
        `mark_id = '${plan.markId}'`,
      ),
    ).toBe("1");
  });

  it("no borra el activo y lo dice", async () => {
    const database = await migratedDatabase();
    const plan = await seedPlan(database, "active");

    const result = await deleteCycle(database, plan);

    expect(result).toBe("false|active|0");
    expect(
      await countWhere(
        database,
        "training_routines",
        `id = '${plan.ownRoutineId}'`,
      ),
    ).toBe("1");
  });

  it("no devuelve nada si el ciclo es de otro club", async () => {
    const database = await migratedDatabase();
    const plan = await seedPlan(database, "draft");
    const otherClubId = await createOtherClub(database);

    const result = await deleteCycle(database, {
      clubId: otherClubId,
      cycleId: plan.cycleId,
    });

    expect(result).toBe("");
    expect(
      await countWhere(database, "training_cycles", `id = '${plan.cycleId}'`),
    ).toBe("1");
  });
});

describeConPostgres("la función de borrar un ciclo", () => {
  it("sólo la ejecuta la llave de servicio", async () => {
    const database = await migratedDatabase();
    const signature = "delete_training_cycle(uuid, uuid)";

    const grants = await database.query(
      `select has_function_privilege('authenticated',
                'public.${signature}', 'execute')
           || '|' || has_function_privilege('anon',
                'public.${signature}', 'execute')
           || '|' || has_function_privilege('service_role',
                'public.${signature}', 'execute')`,
    );

    expect(grants).toBe("false|false|true");
  });
});

describeConPostgres("0088 aplicada dos veces", () => {
  it("no falla ni pierde ciclos", async () => {
    const database = await migratedDatabase();
    const plan = await seedPlan(database, "draft");

    const again = await applyRepositoryMigrations(database);

    expect(again.code, again.stderr).toBe(0);
    expect(
      await countWhere(database, "training_cycles", `id = '${plan.cycleId}'`),
    ).toBe("1");
  });
});
