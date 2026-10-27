import { expect, it } from "vitest";
import {
  type MembershipStanding,
  type MembershipStatus,
  isStandingCurrent,
} from "@/lib/membership/membership";
import {
  type RunResult,
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0083_training.sql` contra un Postgres desechable (#896, RF-1 y D4 a D13
 * del PRD de E35). Lo que la base afirma sola: la forma de cada fila, un solo
 * ciclo activo por club, dos rutinas por día como mucho, nombres de ejercicio
 * sin repetir, que no se borra lo que está en uso, que las marcas son de su
 * dueño, que el plan lo lee quien está al día (o planifica) y que sólo el
 * servidor escribe.
 */

const SEEDED_CLUB = "victoria-seadragons";

const TRAINING_TABLES = [
  "training_cycle_days",
  "training_cycle_weeks",
  "training_cycles",
  "training_exercises",
  "training_marks",
  "training_member_marks",
  "training_routine_items",
  "training_routines",
] as const;

/** Un lunes, como pide el inicio de un ciclo (D5). */
const CYCLE_START = "2027-01-04";

type Role = "Admin" | "Coach" | "Committee" | "Player";

type Member = { readonly clubId: string; readonly userId: string };

type CycleStatus = "draft" | "active" | "archived";

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

/** Un socio activo con su rol y, si se da, el estado de su membresía. */
async function seedMember(
  database: TemporaryDatabase,
  clubId: string,
  options: { readonly role: Role; readonly status?: MembershipStatus },
): Promise<Member> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status, role)
     values ('${clubId}', '${userId}', 'Tere Training',
             '${userId}@example.test', 'active', '${options.role}')`,
  );
  if (options.status !== undefined) {
    await database.query(
      `insert into public.memberships
         (user_id, club_id, plan, status, waived_reason)
       values ('${userId}', '${clubId}', 'Full', '${options.status}',
               ${options.status === "waived" ? "'Beca'" : "null"})`,
    );
  }
  return { clubId, userId };
}

function asUser(member: Member): string {
  return `set role authenticated;
    set request.jwt.claims = '{"sub":"${member.userId}"}';`;
}

function seedCycle(
  database: TemporaryDatabase,
  clubId: string,
  status: CycleStatus,
): Promise<string> {
  return database.query(
    `insert into public.training_cycles
       (club_id, name, start_date, weeks, status)
     values ('${clubId}', 'Road to Nationals', '${CYCLE_START}', 12,
             '${status}')
     returning id`,
  );
}

function seedRoutine(
  database: TemporaryDatabase,
  clubId: string,
  cycleId: string | null,
): Promise<string> {
  return database.query(
    `insert into public.training_routines
       (club_id, cycle_id, name, color_index)
     values ('${clubId}', ${cycleId === null ? "null" : `'${cycleId}'`},
             'Strength A', 0)
     returning id`,
  );
}

/** Una rutina del ciclo con una fila, un día y la nota de la semana 1. */
async function seedCycleContent(
  database: TemporaryDatabase,
  clubId: string,
  cycleId: string,
): Promise<void> {
  const routineId = await seedRoutine(database, clubId, cycleId);
  await database.query(
    `insert into public.training_cycle_days
       (club_id, cycle_id, week_no, weekday, slot, routine_id)
     values ('${clubId}', '${cycleId}', 1, 0, 1, '${routineId}');
     insert into public.training_cycle_weeks
       (club_id, cycle_id, week_no, note)
     values ('${clubId}', '${cycleId}', 1, 'Training Camp');
     insert into public.training_routine_items
       (club_id, routine_id, position, kind, section_title)
     values ('${clubId}', '${routineId}', 0, 'section', 'Warm up')`,
  );
}

/** `ciclos|rutinas|filas|días|semanas` que lee cada socio con su sesión. */
function countsVisibleTo(
  database: TemporaryDatabase,
  members: readonly Member[],
): Promise<(string | undefined)[]> {
  const countsSql = `select
      (select count(*) from public.training_cycles) || '|' ||
      (select count(*) from public.training_routines) || '|' ||
      (select count(*) from public.training_routine_items) || '|' ||
      (select count(*) from public.training_cycle_days) || '|' ||
      (select count(*) from public.training_cycle_weeks)`;
  return Promise.all(
    members.map(async (member) =>
      rowsOf(await database.query(`${asUser(member)} ${countsSql}`)).at(-1),
    ),
  );
}

function seedClubExercise(
  database: TemporaryDatabase,
  clubId: string,
  name: string,
): Promise<string> {
  return database.query(
    `insert into public.training_exercises (club_id, name, source)
     values ('${clubId}', '${name}', 'club')
     returning id`,
  );
}

function seedMark(
  database: TemporaryDatabase,
  clubId: string,
  name: string,
): Promise<string> {
  return database.query(
    `insert into public.training_marks (club_id, name)
     values ('${clubId}', '${name}')
     returning id`,
  );
}

/** Lo justo para colgar filas de rutina: club, rutina, ejercicio y marca. */
async function seedRoutineWorld(database: TemporaryDatabase): Promise<{
  readonly clubId: string;
  readonly routineId: string;
  readonly exerciseId: string;
  readonly markId: string;
}> {
  const clubId = await seededClubId(database);
  const cycleId = await seedCycle(database, clubId, "draft");
  const routineId = await seedRoutine(database, clubId, cycleId);
  const exerciseId = await seedClubExercise(database, clubId, "Back squat");
  const markId = await seedMark(database, clubId, "Back squat 1RM");
  return { clubId, routineId, exerciseId, markId };
}

/** Inserta una fila de rutina con las columnas dadas sobre una base mínima. */
function insertItemSql(
  world: { readonly clubId: string; readonly routineId: string },
  columns: Readonly<Record<string, string>>,
): string {
  const names = ["club_id", "routine_id", "position", ...Object.keys(columns)];
  const values = [
    `'${world.clubId}'`,
    `'${world.routineId}'`,
    "0",
    ...Object.values(columns),
  ];
  return `insert into public.training_routine_items (${names.join(", ")})
          values (${values.join(", ")})`;
}

function expectRejectedBy(result: RunResult, pattern: RegExp): void {
  expect(result.code).toBeGreaterThan(0);
  expect(result.stderr).toMatch(pattern);
}

function rowsOf(output: string): string[] {
  return output.split("\n").filter((line) => line.trim() !== "");
}

describeConPostgres("las tablas de entrenamiento", () => {
  it("crea las ocho tablas con RLS activo y club_id, nulo sólo en los ejercicios", async () => {
    const database = await migratedDatabase();

    const tables = await database.query(
      `select c.relname || '|' || c.relrowsecurity || '|' || a.attnotnull
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid and a.attname = 'club_id'
        where n.nspname = 'public' and c.relkind = 'r'
          and c.relname like 'training\\_%'
        order by c.relname`,
    );

    expect(rowsOf(tables)).toEqual(
      TRAINING_TABLES.map(
        (table) =>
          `${table}|true|${table === "training_exercises" ? "false" : "true"}`,
      ),
    );
  });

  it("al aplicarse dos veces no falla ni cambia los datos", async () => {
    const database = await migratedDatabase();
    const { clubId, routineId, exerciseId, markId } =
      await seedRoutineWorld(database);
    await database.query(
      insertItemSql(
        { clubId, routineId },
        {
          kind: "'exercise'",
          exercise_id: `'${exerciseId}'`,
          load_kind: "'pct'",
          load_mark_id: `'${markId}'`,
          load_pct: "75",
        },
      ),
    );
    const afterFirst = await database.snapshot();

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(afterFirst).toMatch(/training_routine_items/);
    expect(await database.snapshot()).toBe(afterFirst);
  });

  it("admite dos rutinas en un día y rechaza una tercera", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const cycleId = await seedCycle(database, clubId, "draft");
    const routineId = await seedRoutine(database, clubId, cycleId);
    const daySql = (slot: number): string =>
      `insert into public.training_cycle_days
         (club_id, cycle_id, week_no, weekday, slot, routine_id)
       values ('${clubId}', '${cycleId}', 1, 0, ${slot}, '${routineId}')`;
    await database.query(daySql(1));
    await database.query(daySql(2));

    const third = await database.attempt(daySql(3));
    const repeated = await database.attempt(daySql(1));

    expectRejectedBy(third, /training_cycle_days_slot_check/);
    expectRejectedBy(repeated, /training_cycle_days_pkey/);
  });

  it("rechaza un segundo ciclo activo en el club, no en otro club", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const otherClub = await createOtherClub(database);
    await seedCycle(database, clubId, "active");
    await seedCycle(database, clubId, "draft");
    await seedCycle(database, otherClub, "active");

    const second = await database.attempt(
      `insert into public.training_cycles
         (club_id, name, start_date, weeks, status)
       values ('${clubId}', 'Otro', '${CYCLE_START}', 4, 'active')`,
    );

    expectRejectedBy(second, /training_cycles_one_active_per_club/);
  });

  it("rechaza un ciclo que no empieza en lunes", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);

    const tuesday = await database.attempt(
      `insert into public.training_cycles (club_id, name, start_date, weeks)
       values ('${clubId}', 'Martes', '2027-01-05', 4)`,
    );

    expectRejectedBy(tuesday, /training_cycles_start_date_monday_check/);
  });

  it("rechaza una sección con ejercicio, dosis o carga, y un ejercicio sin ejercicio", async () => {
    const database = await migratedDatabase();
    const world = await seedRoutineWorld(database);
    const section = { kind: "'section'", section_title: "'Warm up'" };
    await database.query(insertItemSql(world, section));

    const attempts = await Promise.all(
      [
        { ...section, exercise_id: `'${world.exerciseId}'` },
        { ...section, sets: "3" },
        { ...section, reps: "'8'" },
        { ...section, load_kind: "'text'", load_text: "'Bodyweight'" },
        { kind: "'exercise'" },
        { kind: "'section'" },
      ].map((columns) => database.attempt(insertItemSql(world, columns))),
    );

    for (const attempt of attempts) {
      expectRejectedBy(attempt, /training_routine_items_kind_shape_check/);
    }
  });

  it("rechaza una carga pct o week sin marca, pct sin porcentaje y text sin texto", async () => {
    const database = await migratedDatabase();
    const world = await seedRoutineWorld(database);
    const exercise = {
      kind: "'exercise'",
      exercise_id: `'${world.exerciseId}'`,
    };
    await database.query(
      insertItemSql(world, {
        ...exercise,
        load_kind: "'week'",
        load_mark_id: `'${world.markId}'`,
      }),
    );

    const withoutMark = await Promise.all(
      [
        { ...exercise, load_kind: "'pct'", load_pct: "75" },
        { ...exercise, load_kind: "'week'" },
      ].map((columns) => database.attempt(insertItemSql(world, columns))),
    );
    const withoutPct = await database.attempt(
      insertItemSql(world, {
        ...exercise,
        load_kind: "'pct'",
        load_mark_id: `'${world.markId}'`,
      }),
    );
    const withoutText = await database.attempt(
      insertItemSql(world, { ...exercise, load_kind: "'text'" }),
    );

    for (const attempt of withoutMark) {
      expectRejectedBy(attempt, /training_routine_items_load_mark_check/);
    }
    expectRejectedBy(withoutPct, /training_routine_items_load_pct_check/);
    expectRejectedBy(withoutText, /training_routine_items_load_text_check/);
  });

  it("rechaza un nombre de ejercicio repetido sin contar mayúsculas ni acentos, en el club y en la biblioteca", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const otherClub = await createOtherClub(database);
    await seedClubExercise(database, clubId, "Sentadilla");
    await seedClubExercise(database, otherClub, "Sentadilla");
    await database.query(
      `insert into public.training_exercises (name, source, library_key)
       values ('Sentadilla', 'library', 'Barbell_Squat')`,
    );

    const inClub = await database.attempt(
      `insert into public.training_exercises (club_id, name, source)
       values ('${clubId}', 'sentad' || chr(237) || 'lla', 'club')`,
    );
    const inLibrary = await database.attempt(
      `insert into public.training_exercises (name, source, library_key)
       values ('SENTAD' || chr(205) || 'LLA', 'library', 'Other_Squat')`,
    );

    expectRejectedBy(inClub, /training_exercises_name_per_scope_key/);
    expectRejectedBy(inLibrary, /training_exercises_name_per_scope_key/);
  });

  it("impide borrar un ejercicio usado en una rutina y una marca usada en una fila", async () => {
    const database = await migratedDatabase();
    const world = await seedRoutineWorld(database);
    await database.query(
      insertItemSql(world, {
        kind: "'exercise'",
        exercise_id: `'${world.exerciseId}'`,
        load_kind: "'week'",
        load_mark_id: `'${world.markId}'`,
      }),
    );

    const exercise = await database.attempt(
      `delete from public.training_exercises where id = '${world.exerciseId}'`,
    );
    const mark = await database.attempt(
      `delete from public.training_marks where id = '${world.markId}'`,
    );

    expectRejectedBy(exercise, /training_routine_items_exercise_id_fkey/);
    expectRejectedBy(mark, /training_routine_items_load_mark_fkey/);
  });

  it("rechaza un valor de marca de 0 o de más de 500 kg", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const owner = await seedMember(database, clubId, { role: "Player" });
    const markId = await seedMark(database, clubId, "Deadlift");
    const markSql = (value: string): string =>
      `insert into public.training_member_marks
         (user_id, club_id, mark_id, value)
       values ('${owner.userId}', '${clubId}', '${markId}', ${value})
       on conflict (user_id, mark_id) do update set value = excluded.value`;
    await database.query(markSql("500"));

    const attempts = await Promise.all(
      ["0", "500.1"].map((value) => database.attempt(markSql(value))),
    );

    for (const attempt of attempts) {
      expectRejectedBy(attempt, /training_member_marks_value_check/);
    }
  });

  it("cada socio lee sólo sus marcas: ni otro socio, ni el Coach, ni el Admin leen las ajenas", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const owner = await seedMember(database, clubId, { role: "Player" });
    const readers = await Promise.all(
      (["Player", "Coach", "Admin"] as const).map((role) =>
        seedMember(database, clubId, { role }),
      ),
    );
    const markId = await seedMark(database, clubId, "Bench press");
    await database.query(
      `insert into public.training_member_marks
         (user_id, club_id, mark_id, value)
       values ('${owner.userId}', '${clubId}', '${markId}', 82.5)`,
    );
    const readSql = "select value from public.training_member_marks";

    const own = await database.query(`${asUser(owner)} ${readSql}`);
    const others = await Promise.all(
      readers.map((reader) =>
        database.query(`${asUser(reader)} select count(*)
                          from public.training_member_marks`),
      ),
    );

    expect(rowsOf(own)).toContain("82.5");
    expect(others.map((output) => rowsOf(output).at(-1))).toEqual([
      "0",
      "0",
      "0",
    ]);
  });

  it("authenticated recibe permission denied al escribir en cualquier tabla nueva", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const admin = await seedMember(database, clubId, {
      role: "Admin",
      status: "active",
    });

    const attempts = await Promise.all(
      TRAINING_TABLES.flatMap((table) => [
        database.attempt(
          `${asUser(admin)} insert into public.${table} default values`,
        ),
        database.attempt(
          `${asUser(admin)} update public.${table} set club_id = club_id`,
        ),
        database.attempt(`${asUser(admin)} delete from public.${table}`),
      ]),
    );

    for (const attempt of attempts) {
      expectRejectedBy(attempt, /permission denied/);
    }
  });

  it("concede a authenticated sólo lectura, a service_role las escrituras y a anon nada", async () => {
    const database = await migratedDatabase();

    const grants = await database.query(
      `select t.name || '|' || string_agg(r.role || ':' || p.privilege, ','
                                          order by r.role, p.privilege)
         from unnest(array['${TRAINING_TABLES.join("','")}']) as t(name)
         cross join unnest(array['anon', 'authenticated', 'service_role'])
           as r(role)
         cross join unnest(array['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
           as p(privilege)
        where has_table_privilege(r.role, 'public.' || t.name, p.privilege)
        group by t.name
        order by t.name collate "C"`,
    );

    expect(rowsOf(grants)).toEqual(
      TRAINING_TABLES.map(
        (table) =>
          `${table}|authenticated:SELECT,service_role:DELETE,` +
          "service_role:INSERT,service_role:SELECT,service_role:UPDATE",
      ),
    );
  });

  it("el ciclo activo y sus rutinas los lee quien está al día; quien no, no", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    await seedCycleContent(
      database,
      clubId,
      await seedCycle(database, clubId, "active"),
    );
    await seedRoutine(database, clubId, null);
    const current = await Promise.all(
      (["active", "trialing", "waived"] as const).map((status) =>
        seedMember(database, clubId, { role: "Player", status }),
      ),
    );
    const blocked = await Promise.all(
      (["past_due", "pending", "cancelled"] as const).map((status) =>
        seedMember(database, clubId, { role: "Committee", status }),
      ),
    );
    const withoutMembership = await seedMember(database, clubId, {
      role: "Player",
    });

    const currentCounts = await countsVisibleTo(database, current);
    const blockedCounts = await countsVisibleTo(database, [
      ...blocked,
      withoutMembership,
    ]);

    expect(currentCounts).toEqual(["1|2|1|1|1", "1|2|1|1|1", "1|2|1|1|1"]);
    expect(blockedCounts).toEqual([
      "0|0|0|0|0",
      "0|0|0|0|0",
      "0|0|0|0|0",
      "0|0|0|0|0",
    ]);
  });

  it("los borradores y archivados sólo los leen el Admin y el Coach, aunque no estén al día", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    for (const status of ["draft", "archived"] as const) {
      await seedCycleContent(
        database,
        clubId,
        await seedCycle(database, clubId, status),
      );
    }
    const planners = await Promise.all(
      (["Admin", "Coach"] as const).map((role) =>
        seedMember(database, clubId, { role, status: "past_due" }),
      ),
    );
    const currentPlayer = await seedMember(database, clubId, {
      role: "Player",
      status: "active",
    });

    const plannerCounts = await countsVisibleTo(database, planners);
    const playerCounts = await countsVisibleTo(database, [currentPlayer]);

    expect(plannerCounts).toEqual(["2|2|2|2|2", "2|2|2|2|2"]);
    expect(playerCounts).toEqual(["0|0|0|0|0"]);
  });

  it("los ejercicios de la biblioteca los lee cualquiera con sesión; los del club, sólo sus socios", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const otherClub = await createOtherClub(database);
    await database.query(
      `insert into public.training_exercises (name, source, library_key)
       values ('Push-up', 'library', 'Pushups')`,
    );
    await seedClubExercise(database, clubId, "Fin kick");
    await seedMark(database, clubId, "Deadlift");
    const outsider = await seedMember(database, otherClub, { role: "Player" });

    const names = await database.query(
      `${asUser(outsider)} select name from public.training_exercises
        union all select name from public.training_marks`,
    );

    expect(rowsOf(names)).toContain("Push-up");
    expect(names).not.toMatch(/Fin kick|Deadlift/);
  });

  it("crea el bucket público training-exercise-images para JPEG, PNG y WebP de hasta 5 MB", async () => {
    const database = await migratedDatabase();

    const bucket = await database.query(
      `select public::text || '|' || file_size_limit || '|'
              || array_to_string(allowed_mime_types, ',')
         from storage.buckets where id = 'training-exercise-images'`,
    );

    expect(bucket).toBe("true|5242880|image/jpeg,image/png,image/webp");
  });

  it("schema-expected.txt declara lo que la migración deja", async () => {
    const database = await migratedDatabase();

    const check = await database.checkSchema();

    expect(check.code, check.stdout + check.stderr).toBe(0);
  });
});

const NOW = new Date("2027-03-01T00:00:00Z");
const FUTURE = new Date("2027-04-01T00:00:00Z");
const PAST = new Date("2027-02-01T00:00:00Z");

function standing(
  status: MembershipStatus,
  dates: Partial<Omit<MembershipStanding, "status">> = {},
): MembershipStanding {
  return {
    status,
    stripeSubscriptionId: null,
    trialEnd: null,
    currentPeriodEnd: null,
    waivedUntil: null,
    ...dates,
  };
}

const STANDINGS: readonly MembershipStanding[] = [
  standing("pending"),
  standing("trialing"),
  standing("active"),
  standing("past_due"),
  standing("cancelled"),
  standing("waived"),
  standing("waived", { waivedUntil: FUTURE }),
  standing("waived", { waivedUntil: PAST }),
  standing("waived", {
    waivedUntil: PAST,
    stripeSubscriptionId: "sub_1",
    trialEnd: FUTURE,
  }),
  standing("waived", {
    waivedUntil: PAST,
    stripeSubscriptionId: "sub_1",
    currentPeriodEnd: FUTURE,
  }),
  standing("waived", {
    waivedUntil: PAST,
    stripeSubscriptionId: "sub_1",
    trialEnd: PAST,
    currentPeriodEnd: PAST,
  }),
];

function sqlLiteral(value: string | Date | null): string {
  if (value === null) {
    return "null";
  }
  return value instanceof Date ? `'${value.toISOString()}'` : `'${value}'`;
}

function standingSql(entry: MembershipStanding): string {
  return `public.is_membership_current(
    ${sqlLiteral(entry.status)}, ${sqlLiteral(entry.stripeSubscriptionId)},
    ${sqlLiteral(entry.trialEnd)}, ${sqlLiteral(entry.currentPeriodEnd)},
    ${sqlLiteral(entry.waivedUntil)}, ${sqlLiteral(NOW)})`;
}

describeConPostgres("la regla de estar al día en SQL", () => {
  it("coincide con isStandingCurrent en los seis estados y la exención vencida", async () => {
    const database = await migratedDatabase();

    const fromSql = await database.query(
      `select ${STANDINGS.map(standingSql).join(" || ',' || ")}`,
    );

    expect(fromSql).toBe(
      STANDINGS.map((entry) => String(isStandingCurrent(entry, NOW))).join(","),
    );
  });
});
