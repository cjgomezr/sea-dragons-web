import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0089_training_cycle_clear_week.sql` contra un Postgres desechable (#943):
 * vaciar una semana borra sus días y su fila de nota y dosis, y deja las
 * demás semanas, el ciclo, sus rutinas y sus filas, y los otros ciclos.
 */

const SEEDED_CLUB = "victoria-seadragons";
const CLEARED_WEEK = 2;
const KEPT_WEEK = 3;
const WEEKS = 4;

type SeededCycle = {
  readonly clubId: string;
  readonly cycleId: string;
  readonly routineId: string;
};

function seededClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
}

/** Un ciclo de cuatro semanas con nota y dos días con rutina en la 2 y en
 * la 3, y una fila en su rutina. */
async function seedCycle(
  database: TemporaryDatabase,
  clubId: string,
): Promise<SeededCycle> {
  const cycleId = await database.query(
    `insert into public.training_cycles (club_id, name, start_date, weeks, status)
     values ('${clubId}', 'Winter', '2026-11-16', ${WEEKS}, 'draft')
     returning id`,
  );
  const routineId = await database.query(
    `insert into public.training_routines (club_id, cycle_id, name, color_index)
     values ('${clubId}', '${cycleId}', 'Strength', 0)
     returning id`,
  );
  await database.query(
    `insert into public.training_routine_items
       (club_id, routine_id, position, kind, section_title)
     values ('${clubId}', '${routineId}', 0, 'section', 'Warm-up')`,
  );
  await database.query(
    `insert into public.training_cycle_weeks
       (club_id, cycle_id, week_no, note, dose_sets, dose_reps)
     values ('${clubId}', '${cycleId}', ${CLEARED_WEEK}, 'Load', 4, '6'),
            ('${clubId}', '${cycleId}', ${KEPT_WEEK}, 'Peak', 3, '3')`,
  );
  await database.query(
    `insert into public.training_cycle_days
       (club_id, cycle_id, week_no, weekday, slot, routine_id)
     values ('${clubId}', '${cycleId}', ${CLEARED_WEEK}, 0, 1, '${routineId}'),
            ('${clubId}', '${cycleId}', ${CLEARED_WEEK}, 2, 2, '${routineId}'),
            ('${clubId}', '${cycleId}', ${KEPT_WEEK}, 0, 1, '${routineId}'),
            ('${clubId}', '${cycleId}', ${KEPT_WEEK}, 4, 1, '${routineId}')`,
  );
  return { clubId, cycleId, routineId };
}

function clearWeek(
  database: TemporaryDatabase,
  target: { readonly clubId: string; readonly cycleId: string },
  weekNo: number,
): Promise<string> {
  return database.query(
    `select public.clear_training_cycle_week(
       '${target.clubId}', '${target.cycleId}', ${weekNo})`,
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

function weekRows(cycleId: string, weekNo: number): string {
  return `cycle_id = '${cycleId}' and week_no = ${weekNo}`;
}

describeConPostgres("vaciar una semana de un ciclo", () => {
  it("borra los días y la nota y la dosis de esa semana", async () => {
    const database = await migratedDatabase();
    const seeded = await seedCycle(database, await seededClubId(database));

    await clearWeek(database, seeded, CLEARED_WEEK);

    const cleared = weekRows(seeded.cycleId, CLEARED_WEEK);
    expect(await countWhere(database, "training_cycle_days", cleared)).toBe(
      "0",
    );
    expect(await countWhere(database, "training_cycle_weeks", cleared)).toBe(
      "0",
    );
  });

  it("deja las demás semanas, el ciclo, su rutina y sus filas", async () => {
    const database = await migratedDatabase();
    const seeded = await seedCycle(database, await seededClubId(database));

    await clearWeek(database, seeded, CLEARED_WEEK);

    const kept = weekRows(seeded.cycleId, KEPT_WEEK);
    expect(await countWhere(database, "training_cycle_days", kept)).toBe("2");
    expect(await countWhere(database, "training_cycle_weeks", kept)).toBe("1");
    expect(
      await countWhere(
        database,
        "training_cycles",
        `id = '${seeded.cycleId}' and weeks = ${WEEKS}
           and start_date = '2026-11-16'`,
      ),
    ).toBe("1");
    expect(
      await countWhere(
        database,
        "training_routine_items",
        `routine_id = '${seeded.routineId}'`,
      ),
    ).toBe("1");
  });

  it("no toca la misma semana de otro ciclo", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const seeded = await seedCycle(database, clubId);
    const other = await seedCycle(database, clubId);

    await clearWeek(database, seeded, CLEARED_WEEK);

    const otherWeek = weekRows(other.cycleId, CLEARED_WEEK);
    expect(await countWhere(database, "training_cycle_days", otherWeek)).toBe(
      "2",
    );
    expect(await countWhere(database, "training_cycle_weeks", otherWeek)).toBe(
      "1",
    );
  });

  it("no borra nada si el ciclo es de otro club", async () => {
    const database = await migratedDatabase();
    const seeded = await seedCycle(database, await seededClubId(database));
    const otherClubId = await database.query(
      `insert into public.clubs (name, slug)
       values ('Otro club', 'otro-club-' || gen_random_uuid())
       returning id`,
    );

    await clearWeek(
      database,
      { clubId: otherClubId, cycleId: seeded.cycleId },
      CLEARED_WEEK,
    );

    const cleared = weekRows(seeded.cycleId, CLEARED_WEEK);
    expect(await countWhere(database, "training_cycle_days", cleared)).toBe(
      "2",
    );
    expect(await countWhere(database, "training_cycle_weeks", cleared)).toBe(
      "1",
    );
  });
});

describeConPostgres("la función de vaciar una semana", () => {
  it("sólo la ejecuta la llave de servicio", async () => {
    const database = await migratedDatabase();
    const signature = "clear_training_cycle_week(uuid, uuid, integer)";

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

describeConPostgres("0089 aplicada dos veces", () => {
  it("no falla ni pierde semanas", async () => {
    const database = await migratedDatabase();
    const seeded = await seedCycle(database, await seededClubId(database));

    const again = await applyRepositoryMigrations(database);

    expect(again.code, again.stderr).toBe(0);
    expect(
      await countWhere(
        database,
        "training_cycle_weeks",
        `cycle_id = '${seeded.cycleId}'`,
      ),
    ).toBe("2");
  });
});
