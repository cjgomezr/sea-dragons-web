import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0086_training_routines_manage.sql` contra un Postgres desechable (#905,
 * RF-9, D7 a D10 del PRD de E35): las cuentas de cada rutina, sustituir sus
 * filas en orden y borrarla dejando sus días en descanso sin una ranura 2
 * sola.
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
): Promise<string> {
  return database.query(
    `insert into public.training_cycles (club_id, name, start_date, weeks)
     values ('${clubId}', 'Winter', '2026-11-16', 4)
     returning id`,
  );
}

function seedRoutine(
  database: TemporaryDatabase,
  clubId: string,
  name: string,
): Promise<string> {
  return database.query(
    `insert into public.training_routines (club_id, name, color_index)
     values ('${clubId}', '${name}', 0)
     returning id`,
  );
}

function seedExercise(
  database: TemporaryDatabase,
  clubId: string,
): Promise<string> {
  return database.query(
    `insert into public.training_exercises (club_id, name, source)
     values ('${clubId}', 'Fin kick ' || gen_random_uuid(), 'club')
     returning id`,
  );
}

function seedDay(
  database: TemporaryDatabase,
  clubId: string,
  day: {
    readonly cycleId: string;
    readonly weekNo: number;
    readonly weekday: number;
    readonly slot: number;
    readonly routineId: string;
  },
): Promise<string> {
  return database.query(
    `insert into public.training_cycle_days
       (club_id, cycle_id, week_no, weekday, slot, routine_id)
     values ('${clubId}', '${day.cycleId}', ${day.weekNo}, ${day.weekday},
             ${day.slot}, '${day.routineId}')`,
  );
}

function replaceItems(
  database: TemporaryDatabase,
  target: { readonly clubId: string; readonly routineId: string },
  items: readonly Record<string, unknown>[],
): Promise<string> {
  const json = JSON.stringify(items).replaceAll("'", "''");
  return database.query(
    `select public.replace_training_routine_items(
       '${target.clubId}', '${target.routineId}', '${json}'::jsonb)`,
  );
}

function itemsOf(
  database: TemporaryDatabase,
  routineId: string,
): Promise<string> {
  return database.query(
    `select position || ':' || kind || ':'
            || coalesce(section_title, reps)
       from public.training_routine_items
      where routine_id = '${routineId}'
      order by position`,
  );
}

function exerciseItem(exerciseId: string, reps: string) {
  return {
    kind: "exercise",
    exercise_id: exerciseId,
    sets: 3,
    reps,
    load_kind: "none",
  };
}

describeConPostgres("las cuentas de las rutinas", () => {
  it("cuenta las filas y los días distintos en todos los ciclos", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const cycleId = await seedCycle(database, clubId);
    const routineId = await seedRoutine(database, clubId, "Strength A");
    const exerciseId = await seedExercise(database, clubId);
    await replaceItems(database, { clubId, routineId }, [
      { kind: "section", section_title: "Warm up", load_kind: "none" },
      exerciseItem(exerciseId, "5"),
    ]);
    const day = { cycleId, weekNo: 1, weekday: 0, routineId };
    await seedDay(database, clubId, { ...day, slot: 1 });
    // La misma rutina en las dos ranuras de un día cuenta un día.
    await seedDay(database, clubId, { ...day, slot: 2 });
    await seedDay(database, clubId, { ...day, weekday: 2, slot: 1 });

    const overview = await database.query(
      `select name || '|' || item_count || '|' || days_used
         from public.training_routine_overview('${clubId}')`,
    );

    expect(overview).toBe("Strength A|2|2");
  });

  it("no devuelve las rutinas de otro club", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const otherClubId = await createOtherClub(database);
    await seedRoutine(database, otherClubId, "Ajena");

    const overview = await database.query(
      `select count(*) from public.training_routine_overview('${clubId}')`,
    );

    expect(overview).toBe("0");
  });
});

describeConPostgres("sustituir las filas de una rutina", () => {
  it("cambia las filas por las nuevas en su orden y anota cuándo", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const routineId = await seedRoutine(database, clubId, "Strength A");
    const exerciseId = await seedExercise(database, clubId);
    await replaceItems(database, { clubId, routineId }, [
      exerciseItem(exerciseId, "old"),
    ]);

    const replaced = await replaceItems(database, { clubId, routineId }, [
      exerciseItem(exerciseId, "8"),
      { kind: "section", section_title: "Main", load_kind: "none" },
      exerciseItem(exerciseId, "5"),
    ]);

    expect(replaced).toBe("t");
    expect(await itemsOf(database, routineId)).toBe(
      ["0:exercise:8", "1:section:Main", "2:exercise:5"].join("\n"),
    );
    const savedAt = await database.query(
      `select bool_and(saved_at is not null)
         from public.training_routine_items
        where routine_id = '${routineId}'`,
    );
    expect(savedAt).toBe("t");
  });

  it("con una fila que la base rechaza no toca las que había", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const routineId = await seedRoutine(database, clubId, "Strength A");
    const exerciseId = await seedExercise(database, clubId);
    await replaceItems(database, { clubId, routineId }, [
      exerciseItem(exerciseId, "5"),
    ]);

    await expect(
      replaceItems(database, { clubId, routineId }, [
        exerciseItem(exerciseId, "8"),
        { kind: "section", load_kind: "none" },
      ]),
    ).rejects.toThrow();

    expect(await itemsOf(database, routineId)).toBe("0:exercise:5");
  });

  it("devuelve falso y no toca nada si la rutina es de otro club", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const otherClubId = await createOtherClub(database);
    const routineId = await seedRoutine(database, otherClubId, "Ajena");

    const replaced = await replaceItems(database, { clubId, routineId }, [
      { kind: "section", section_title: "Main", load_kind: "none" },
    ]);

    expect(replaced).toBe("f");
    expect(await itemsOf(database, routineId)).toBe("");
  });
});

describeConPostgres("borrar una rutina", () => {
  async function seedUsedRoutine(database: TemporaryDatabase) {
    const clubId = await seededClubId(database);
    const cycleId = await seedCycle(database, clubId);
    const strength = await seedRoutine(database, clubId, "Strength A");
    const swim = await seedRoutine(database, clubId, "Swim");
    await seedDay(database, clubId, {
      cycleId,
      weekNo: 1,
      weekday: 0,
      slot: 1,
      routineId: strength,
    });
    await seedDay(database, clubId, {
      cycleId,
      weekNo: 1,
      weekday: 0,
      slot: 2,
      routineId: swim,
    });
    await seedDay(database, clubId, {
      cycleId,
      weekNo: 2,
      weekday: 3,
      slot: 1,
      routineId: strength,
    });
    return { clubId, cycleId, strength, swim };
  }

  function deleteRoutine(
    database: TemporaryDatabase,
    target: { readonly clubId: string; readonly routineId: string },
    confirm: boolean,
  ): Promise<string> {
    return database.query(
      `select deleted || '|' || days_used
         from public.delete_training_routine(
           '${target.clubId}', '${target.routineId}', ${confirm})`,
    );
  }

  it("sin confirmar no borra una usada y dice en cuántos días", async () => {
    const database = await migratedDatabase();
    const seed = await seedUsedRoutine(database);

    const result = await deleteRoutine(
      database,
      { clubId: seed.clubId, routineId: seed.strength },
      false,
    );

    expect(result).toBe("false|2");
    const still = await database.query(
      `select count(*) from public.training_routines
        where id = '${seed.strength}'`,
    );
    expect(still).toBe("1");
  });

  it("confirmando la borra, deja sus días en descanso y sube la ranura 2", async () => {
    const database = await migratedDatabase();
    const seed = await seedUsedRoutine(database);

    const result = await deleteRoutine(
      database,
      { clubId: seed.clubId, routineId: seed.strength },
      true,
    );

    expect(result).toBe("true|2");
    const days = await database.query(
      `select d.week_no || ':' || d.weekday || ':' || d.slot || ':' || r.name
         from public.training_cycle_days d
         join public.training_routines r on r.id = d.routine_id
        where d.cycle_id = '${seed.cycleId}'
        order by d.week_no, d.weekday, d.slot`,
    );
    expect(days).toBe("1:0:1:Swim");
  });

  it("no toca los días que no usaban la rutina borrada", async () => {
    const database = await migratedDatabase();
    const seed = await seedUsedRoutine(database);
    // Una ranura 2 sola que ya estaba ahí: no es de este borrado.
    await seedDay(database, seed.clubId, {
      cycleId: seed.cycleId,
      weekNo: 3,
      weekday: 5,
      slot: 2,
      routineId: seed.swim,
    });

    await deleteRoutine(
      database,
      { clubId: seed.clubId, routineId: seed.strength },
      true,
    );

    const untouched = await database.query(
      `select slot from public.training_cycle_days
        where cycle_id = '${seed.cycleId}' and week_no = 3 and weekday = 5`,
    );
    expect(untouched).toBe("2");
  });

  it("borra sin confirmar una que no se usa", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const routineId = await seedRoutine(database, clubId, "Spare");

    const result = await deleteRoutine(database, { clubId, routineId }, false);

    expect(result).toBe("true|0");
  });

  it("no devuelve nada si la rutina es de otro club", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const otherClubId = await createOtherClub(database);
    const routineId = await seedRoutine(database, otherClubId, "Ajena");

    const result = await deleteRoutine(database, { clubId, routineId }, true);

    expect(result).toBe("");
  });
});

describeConPostgres("las funciones de las rutinas", () => {
  it.each([
    "training_routine_overview(uuid)",
    "replace_training_routine_items(uuid, uuid, jsonb)",
    "delete_training_routine(uuid, uuid, boolean)",
  ])("sólo las ejecuta la llave de servicio: %s", async (signature) => {
    const database = await migratedDatabase();

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

describeConPostgres("0086 aplicada dos veces", () => {
  it("no falla ni pierde las filas", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const routineId = await seedRoutine(database, clubId, "Strength A");
    await replaceItems(database, { clubId, routineId }, [
      { kind: "section", section_title: "Main", load_kind: "none" },
    ]);

    const again = await applyRepositoryMigrations(database);

    expect(again.code, again.stderr).toBe(0);
    expect(await itemsOf(database, routineId)).toBe("0:section:Main");
  });
});
