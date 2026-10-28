import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0085_training_cycles_manage.sql` contra un Postgres desechable (#904,
 * RF-7, RF-8, D5 y D7 del PRD de E35): activar archiva el anterior, duplicar
 * copia las rutinas propias y reapunta la cuadrícula, la ranura 2 nunca queda
 * sola y copiar la semana 1 pisa las semanas pedidas.
 */

const SEEDED_CLUB = "victoria-seadragons";

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

function seedCycle(
  database: TemporaryDatabase,
  clubId: string,
  options: { readonly name: string; readonly status: string },
): Promise<string> {
  return database.query(
    `insert into public.training_cycles
       (club_id, name, event_name, event_date, start_date, weeks, status)
     values ('${clubId}', '${options.name}', 'Nationals', '2026-12-13',
             '2026-11-16', 4, '${options.status}')
     returning id`,
  );
}

function seedRoutine(
  database: TemporaryDatabase,
  clubId: string,
  options: { readonly name: string; readonly cycleId: string | null },
): Promise<string> {
  const cycleSql = options.cycleId === null ? "null" : `'${options.cycleId}'`;
  return database.query(
    `insert into public.training_routines (club_id, cycle_id, name, color_index)
     values ('${clubId}', ${cycleSql}, '${options.name}', 2)
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

function statusOf(database: TemporaryDatabase, cycleId: string) {
  return database.query(
    `select status from public.training_cycles where id = '${cycleId}'`,
  );
}

function daysOf(
  database: TemporaryDatabase,
  cycleId: string,
  weekNo: number,
): Promise<string> {
  return database.query(
    `select d.weekday || ':' || d.slot || ':' || r.name
       from public.training_cycle_days d
       join public.training_routines r on r.id = d.routine_id
      where d.cycle_id = '${cycleId}' and d.week_no = ${weekNo}
      order by d.weekday, d.slot`,
  );
}

describeConPostgres("activar un ciclo", () => {
  it("lo activa y archiva el que lo era, y devuelve cuál archivó", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const current = await seedCycle(database, clubId, {
      name: "Winter",
      status: "active",
    });
    const draft = await seedCycle(database, clubId, {
      name: "Summer",
      status: "draft",
    });

    const archived = await database.query(
      `select archived_cycle_id
         from public.activate_training_cycle('${clubId}', '${draft}')`,
    );

    expect(archived).toBe(current);
    expect(await statusOf(database, draft)).toBe("active");
    expect(await statusOf(database, current)).toBe("archived");
  });

  it("sin activo anterior devuelve una fila con nulo", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const draft = await seedCycle(database, clubId, {
      name: "Summer",
      status: "draft",
    });

    const rows = await database.query(
      `select coalesce(archived_cycle_id::text, 'nulo')
         from public.activate_training_cycle('${clubId}', '${draft}')`,
    );

    expect(rows).toBe("nulo");
  });

  it("no toca nada si el ciclo es de otro club", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const otherClubId = await createOtherClub(database);
    const current = await seedCycle(database, clubId, {
      name: "Winter",
      status: "active",
    });
    const foreign = await seedCycle(database, otherClubId, {
      name: "Foreign",
      status: "draft",
    });

    const rows = await database.query(
      `select count(*)
         from public.activate_training_cycle('${clubId}', '${foreign}')`,
    );

    expect(rows).toBe("0");
    expect(await statusOf(database, current)).toBe("active");
    expect(await statusOf(database, foreign)).toBe("draft");
  });
});

describeConPostgres("duplicar un ciclo", () => {
  async function seedPlannedCycle(database: TemporaryDatabase) {
    const clubId = await seededClubId(database);
    const cycleId = await seedCycle(database, clubId, {
      name: "Winter",
      status: "active",
    });
    const own = await seedRoutine(database, clubId, {
      name: "Strength A",
      cycleId,
    });
    const shared = await seedRoutine(database, clubId, {
      name: "Pool",
      cycleId: null,
    });
    const exerciseId = await database.query(
      `insert into public.training_exercises (club_id, name, source)
       values ('${clubId}', 'Back squat', 'club') returning id`,
    );
    await database.query(
      `insert into public.training_routine_items
         (club_id, routine_id, position, kind, section_title)
       values ('${clubId}', '${own}', 0, 'section', 'Main 1');
       insert into public.training_routine_items
         (club_id, routine_id, position, kind, exercise_id, sets, reps)
       values ('${clubId}', '${own}', 1, 'exercise', '${exerciseId}', 4, '5')`,
    );
    await seedDay(database, clubId, {
      cycleId,
      weekNo: 1,
      weekday: 0,
      slot: 1,
      routineId: own,
    });
    await seedDay(database, clubId, {
      cycleId,
      weekNo: 1,
      weekday: 0,
      slot: 2,
      routineId: shared,
    });
    await database.query(
      `insert into public.training_cycle_weeks
         (club_id, cycle_id, week_no, note, dose_sets, dose_reps,
          dose_intensity_kind, dose_pct)
       values ('${clubId}', '${cycleId}', 1, 'Camp', 4, '5', 'pct', 80)`,
    );
    return { clubId, cycleId, own, shared };
  }

  function duplicate(
    database: TemporaryDatabase,
    seed: { readonly clubId: string; readonly cycleId: string },
  ): Promise<string> {
    return database.query(
      `select new_cycle_id || '|' || routines_copied
         from public.duplicate_training_cycle(
           '${seed.clubId}', '${seed.cycleId}', 'Winter (copy)', null)`,
    );
  }

  it("crea un borrador con el nombre dado y cuenta las rutinas copiadas", async () => {
    const database = await migratedDatabase();
    const seed = await seedPlannedCycle(database);

    const [copyId, copied] = (await duplicate(database, seed)).split("|");

    expect(copied).toBe("1");
    const copy = await database.query(
      `select name || '|' || status || '|' || weeks || '|' || start_date
         from public.training_cycles where id = '${copyId}'`,
    );
    expect(copy).toBe("Winter (copy)|draft|4|2026-11-16");
  });

  it("copia la rutina propia con sus filas y deja la compartida sin copiar", async () => {
    const database = await migratedDatabase();
    const seed = await seedPlannedCycle(database);

    const [copyId] = (await duplicate(database, seed)).split("|");

    const routines = await database.query(
      `select r.id <> '${seed.own}' and r.cycle_id = '${copyId}'
         from public.training_cycle_days d
         join public.training_routines r on r.id = d.routine_id
        where d.cycle_id = '${copyId}' and d.slot = 1`,
    );
    expect(routines).toBe("t");
    const items = await database.query(
      `select i.kind || ':' || coalesce(i.section_title, i.reps)
         from public.training_routine_items i
         join public.training_routines r on r.id = i.routine_id
        where r.cycle_id = '${copyId}'
        order by i.position`,
    );
    expect(rowsOf(items)).toEqual(["section:Main 1", "exercise:5"]);
    const sharedDay = await database.query(
      `select routine_id from public.training_cycle_days
        where cycle_id = '${copyId}' and slot = 2`,
    );
    expect(sharedDay).toBe(seed.shared);
    expect(await daysOf(database, copyId ?? "", 1)).toBe(
      "0:1:Strength A\n0:2:Pool",
    );
  });

  it("copia la nota y la dosis de cada semana", async () => {
    const database = await migratedDatabase();
    const seed = await seedPlannedCycle(database);

    const [copyId] = (await duplicate(database, seed)).split("|");

    const weeks = await database.query(
      `select week_no || '|' || note || '|' || dose_sets || '|' || dose_pct
         from public.training_cycle_weeks where cycle_id = '${copyId}'`,
    );
    expect(weeks).toBe("1|Camp|4|80.0");
  });

  it("no devuelve nada si el ciclo es de otro club", async () => {
    const database = await migratedDatabase();
    const seed = await seedPlannedCycle(database);
    const otherClubId = await createOtherClub(database);

    const rows = await database.query(
      `select count(*) from public.duplicate_training_cycle(
         '${otherClubId}', '${seed.cycleId}', 'Copy', null)`,
    );

    expect(rows).toBe("0");
  });
});

describeConPostgres("poner o quitar una rutina de un día", () => {
  async function seedEmptyCycle(database: TemporaryDatabase) {
    const clubId = await seededClubId(database);
    const cycleId = await seedCycle(database, clubId, {
      name: "Winter",
      status: "draft",
    });
    const strength = await seedRoutine(database, clubId, {
      name: "Strength",
      cycleId,
    });
    const pool = await seedRoutine(database, clubId, {
      name: "Pool",
      cycleId: null,
    });
    return { clubId, cycleId, strength, pool };
  }

  function setDay(
    database: TemporaryDatabase,
    seed: { readonly clubId: string; readonly cycleId: string },
    day: { readonly slot: number; readonly routineId: string | null },
  ): Promise<string> {
    const routineSql = day.routineId === null ? "null" : `'${day.routineId}'`;
    return database.query(
      `select public.set_training_cycle_day(
         '${seed.clubId}', '${seed.cycleId}', 2, 3, ${day.slot}, ${routineSql})`,
    );
  }

  it("guarda la rutina y la cambia si la ranura ya tenía una", async () => {
    const database = await migratedDatabase();
    const seed = await seedEmptyCycle(database);

    await setDay(database, seed, { slot: 1, routineId: seed.strength });
    await setDay(database, seed, { slot: 1, routineId: seed.pool });

    expect(await daysOf(database, seed.cycleId, 2)).toBe("3:1:Pool");
  });

  it("pedir la ranura 2 en un día vacío llena la 1", async () => {
    const database = await migratedDatabase();
    const seed = await seedEmptyCycle(database);

    await setDay(database, seed, { slot: 2, routineId: seed.pool });

    expect(await daysOf(database, seed.cycleId, 2)).toBe("3:1:Pool");
  });

  it("vaciar la 1 con la 2 puesta sube la 2 a la 1", async () => {
    const database = await migratedDatabase();
    const seed = await seedEmptyCycle(database);
    await setDay(database, seed, { slot: 1, routineId: seed.strength });
    await setDay(database, seed, { slot: 2, routineId: seed.pool });

    await setDay(database, seed, { slot: 1, routineId: null });

    expect(await daysOf(database, seed.cycleId, 2)).toBe("3:1:Pool");
  });

  it("vaciar la 2 deja la 1 como está", async () => {
    const database = await migratedDatabase();
    const seed = await seedEmptyCycle(database);
    await setDay(database, seed, { slot: 1, routineId: seed.strength });
    await setDay(database, seed, { slot: 2, routineId: seed.pool });

    await setDay(database, seed, { slot: 2, routineId: null });

    expect(await daysOf(database, seed.cycleId, 2)).toBe("3:1:Strength");
  });
});

describeConPostgres("copiar la semana 1", () => {
  it("pisa las semanas pedidas y deja las demás", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const cycleId = await seedCycle(database, clubId, {
      name: "Winter",
      status: "draft",
    });
    const strength = await seedRoutine(database, clubId, {
      name: "Strength",
      cycleId,
    });
    const taper = await seedRoutine(database, clubId, {
      name: "Taper",
      cycleId,
    });
    await seedDay(database, clubId, {
      cycleId,
      weekNo: 1,
      weekday: 1,
      slot: 1,
      routineId: strength,
    });
    await seedDay(database, clubId, {
      cycleId,
      weekNo: 2,
      weekday: 5,
      slot: 1,
      routineId: taper,
    });
    await seedDay(database, clubId, {
      cycleId,
      weekNo: 4,
      weekday: 5,
      slot: 1,
      routineId: taper,
    });

    await database.query(
      `select public.copy_training_cycle_week_one(
         '${clubId}', '${cycleId}', array[2])`,
    );

    expect(await daysOf(database, cycleId, 2)).toBe("1:1:Strength");
    expect(await daysOf(database, cycleId, 4)).toBe("5:1:Taper");
    expect(await daysOf(database, cycleId, 1)).toBe("1:1:Strength");
  });
});

describeConPostgres("las funciones de los ciclos", () => {
  it.each([
    "activate_training_cycle(uuid, uuid)",
    "duplicate_training_cycle(uuid, uuid, text, uuid)",
    "set_training_cycle_day(uuid, uuid, integer, integer, integer, uuid)",
    "copy_training_cycle_week_one(uuid, uuid, integer[])",
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

describeConPostgres("0085 aplicada dos veces", () => {
  it("no falla ni pierde los ciclos", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    await seedCycle(database, clubId, { name: "Winter", status: "active" });

    const again = await applyRepositoryMigrations(database);

    expect(again.code, again.stderr).toBe(0);
    const names = await database.query(
      `select name from public.training_cycles where club_id = '${clubId}'`,
    );
    expect(names).toBe("Winter");
  });
});
