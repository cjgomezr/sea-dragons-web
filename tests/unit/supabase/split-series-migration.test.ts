import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0073_split_series.sql` contra un Postgres desechable (#653, RF-11 y D2 del
 * PRD de E24). Partir desde una sesión deja la serie original hasta el día
 * anterior y crea otra desde esa fecha con los cambios. Las sesiones movidas
 * conservan su id y sus respuestas; las anteriores no cambian. Todo o nada.
 */

const SEEDED_CLUB = "victoria-seadragons";

type OccurrenceSpec = {
  /** Días desde hoy; negativo es pasado. */
  readonly daysFromToday: number;
  readonly startTime?: string;
  readonly notes?: string;
  readonly cancelled?: true;
};

type Seeded = {
  readonly clubId: string;
  readonly seriesId: string;
  readonly userId: string;
  readonly seniorSquad: string;
  readonly mastersSquad: string;
};

function seedGroup(
  database: TemporaryDatabase,
  clubId: string,
  name: string,
): Promise<string> {
  return database.query(
    `insert into public.groups (club_id, name) values ('${clubId}', '${name}')
     returning id`,
  );
}

async function seedCaller(
  database: TemporaryDatabase,
  clubId: string,
): Promise<string> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status)
     values ('${clubId}', '${userId}', 'Carla Committee',
             '${userId}@example.test', 'active')`,
  );
  return userId;
}

async function seedSeries(
  database: TemporaryDatabase,
  startsInDays: number,
): Promise<Seeded> {
  const clubId = await database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
  const userId = await seedCaller(database, clubId);
  const seniorSquad = await seedGroup(database, clubId, "Senior Squad");
  const mastersSquad = await seedGroup(database, clubId, "Masters");
  const seriesId = await database.query(
    `insert into public.event_series
       (club_id, title, event_type, start_time, end_time, location, notes,
        audience, weekdays, starts_on, ends_on, author_id)
     values ('${clubId}', 'Entrenamiento', 'training', '19:00', '20:30',
             'MSAC', null, 'groups', '{1,2,3,4,5,6,7}',
             current_date + ${startsInDays}, current_date + 60, '${userId}')
     returning id`,
  );
  await database.query(
    `insert into public.event_series_groups (series_id, group_id, club_id)
     values ('${seriesId}', '${seniorSquad}', '${clubId}')`,
  );
  return { clubId, seriesId, userId, seniorSquad, mastersSquad };
}

async function seedOccurrence(
  database: TemporaryDatabase,
  seeded: Seeded,
  spec: OccurrenceSpec,
): Promise<string> {
  const eventId = await database.query(
    `insert into public.events
       (club_id, series_id, title, event_type, starts_on, start_time,
        end_time, location, notes, audience, author_id, status, cancelled_at)
     values ('${seeded.clubId}', '${seeded.seriesId}', 'Entrenamiento',
             'training', current_date + ${spec.daysFromToday},
             '${spec.startTime ?? "19:00"}', '20:30', 'MSAC',
             ${spec.notes === undefined ? "null" : `'${spec.notes}'`},
             'groups', '${seeded.userId}',
             '${spec.cancelled ? "cancelled" : "scheduled"}',
             ${spec.cancelled ? "now()" : "null"})
     returning id`,
  );
  await database.query(
    `insert into public.event_groups (event_id, group_id, club_id)
     values ('${eventId}', '${seeded.seniorSquad}', '${seeded.clubId}')`,
  );
  await database.query(
    `insert into public.event_rsvps (event_id, user_id, club_id, response)
     values ('${eventId}', '${seeded.userId}', '${seeded.clubId}', 'yes')`,
  );
  return eventId;
}

type World = Seeded & {
  readonly pastId: string;
  readonly earlierId: string;
  readonly chosenId: string;
  readonly cancelledId: string;
  readonly editedId: string;
  readonly upcomingId: string;
};

/** Una serie diaria para el Senior Squad desde hace un mes: una sesión
 * pasada, una futura anterior a la elegida, la elegida (en 7 días) y, detrás,
 * una cancelada, una editada sola y otra futura. Cada una con su respuesta. */
async function seedWorld(database: TemporaryDatabase): Promise<World> {
  const seeded = await seedSeries(database, -30);
  const occurrence = (spec: OccurrenceSpec): Promise<string> =>
    seedOccurrence(database, seeded, spec);
  return {
    ...seeded,
    pastId: await occurrence({ daysFromToday: -7 }),
    earlierId: await occurrence({ daysFromToday: 3 }),
    chosenId: await occurrence({ daysFromToday: 7 }),
    cancelledId: await occurrence({ daysFromToday: 10, cancelled: true }),
    editedId: await occurrence({
      daysFromToday: 14,
      startTime: "18:30",
      notes: "Piscina 2",
    }),
    upcomingId: await occurrence({ daysFromToday: 21 }),
  };
}

type SplitTarget = {
  readonly clubId: string;
  readonly seriesId: string;
  readonly fromId: string;
};

/** Los días y la fecha final nuevos, como los manda el servidor (#654). */
type ScheduleArgument = {
  readonly weekdays: readonly number[];
  readonly ends_on: string;
  readonly session_dates: readonly string[];
  readonly added_dates: readonly string[];
};

function splitSeriesCall(
  target: SplitTarget,
  changes: object,
  schedule?: ScheduleArgument,
): string {
  const scheduleArgument =
    schedule === undefined ? "" : `, '${JSON.stringify(schedule)}'::jsonb`;
  return `select public.split_series('${target.clubId}', '${target.seriesId}', '${target.fromId}', '${JSON.stringify(changes)}'::jsonb${scheduleArgument})`;
}

type SplitOutcome = {
  readonly outcome: string;
  readonly series_id?: string;
  readonly updated_occurrences?: number;
};

async function splitSeries(
  database: TemporaryDatabase,
  target: SplitTarget,
  changes: object,
  schedule?: ScheduleArgument,
): Promise<SplitOutcome> {
  return JSON.parse(
    await database.query(splitSeriesCall(target, changes, schedule)),
  ) as SplitOutcome;
}

function fromChosen(world: World): SplitTarget {
  return {
    clubId: world.clubId,
    seriesId: world.seriesId,
    fromId: world.chosenId,
  };
}

/** Lo que importa de una sesión, en una línea. */
function describeOccurrence(
  database: TemporaryDatabase,
  eventId: string,
): Promise<string> {
  return database.query(
    `select series_id || '|' || title || '|' || start_time || '|' || location
            || '|' || coalesce(notes, 'sin notas') || '|' || status || '|'
            || coalesce((select string_agg(group_id::text, ',' order by group_id)
                           from public.event_groups where event_id = e.id), '')
       from public.events e where id = '${eventId}'`,
  );
}

function describeSeries(
  database: TemporaryDatabase,
  seriesId: string,
): Promise<string> {
  return database.query(
    `select title || '|' || start_time || '|' || location || '|'
            || weekdays::text || '|' || (starts_on - current_date) || '|'
            || (ends_on - current_date) || '|'
            || coalesce((select string_agg(group_id::text, ',' order by group_id)
                           from public.event_series_groups
                          where series_id = s.id), '')
       from public.event_series s where id = '${seriesId}'`,
  );
}

function snapshotAll(
  database: TemporaryDatabase,
  world: World,
): Promise<readonly string[]> {
  return Promise.all([
    describeSeries(database, world.seriesId),
    database.query(
      `select count(*) from public.event_series
        where club_id = '${world.clubId}'`,
    ),
    ...[
      world.pastId,
      world.earlierId,
      world.chosenId,
      world.cancelledId,
      world.editedId,
      world.upcomingId,
    ].map((id) => describeOccurrence(database, id)),
  ]);
}

describeConPostgres("partir una serie en la base", () => {
  it("acorta la original al día anterior y crea otra hasta el final con los mismos días", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);

    const split = await splitSeries(database, fromChosen(world), {
      start_time: "20:00",
      location: "Aquatic",
    });

    expect(split).toMatchObject({ outcome: "split", updated_occurrences: 3 });
    expect(split.series_id).not.toBe(world.seriesId);
    await expect(describeSeries(database, world.seriesId)).resolves.toBe(
      `Entrenamiento|19:00:00|MSAC|{1,2,3,4,5,6,7}|-30|6|${world.seniorSquad}`,
    );
    await expect(
      describeSeries(database, String(split.series_id)),
    ).resolves.toBe(
      `Entrenamiento|20:00:00|Aquatic|{1,2,3,4,5,6,7}|7|60|${world.seniorSquad}`,
    );
  });

  it("mueve las sesiones desde la elegida, con su id y los cambios, y deja la editada sola con lo suyo", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);

    const split = await splitSeries(database, fromChosen(world), {
      start_time: "20:00",
      location: "Aquatic",
    });

    const newId = String(split.series_id);
    await expect(describeOccurrence(database, world.chosenId)).resolves.toBe(
      `${newId}|Entrenamiento|20:00:00|Aquatic|sin notas|scheduled|${world.seniorSquad}`,
    );
    await expect(describeOccurrence(database, world.editedId)).resolves.toBe(
      `${newId}|Entrenamiento|20:00:00|Aquatic|Piscina 2|scheduled|${world.seniorSquad}`,
    );
    await expect(describeOccurrence(database, world.upcomingId)).resolves.toBe(
      `${newId}|Entrenamiento|20:00:00|Aquatic|sin notas|scheduled|${world.seniorSquad}`,
    );
  });

  it("mueve la cancelada sin descancelarla ni cambiarle los campos", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);

    const split = await splitSeries(database, fromChosen(world), {
      location: "Aquatic",
    });

    await expect(describeOccurrence(database, world.cancelledId)).resolves.toBe(
      `${String(split.series_id)}|Entrenamiento|19:00:00|MSAC|sin notas|cancelled|${world.seniorSquad}`,
    );
  });

  it("no toca las sesiones anteriores a la elegida, futuras ni pasadas", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);
    const untouched = `${world.seriesId}|Entrenamiento|19:00:00|MSAC|sin notas|scheduled|${world.seniorSquad}`;

    await splitSeries(database, fromChosen(world), {
      location: "Aquatic",
      audience: "groups",
      group_ids: [world.mastersSquad],
    });

    await expect(describeOccurrence(database, world.pastId)).resolves.toBe(
      untouched,
    );
    await expect(describeOccurrence(database, world.earlierId)).resolves.toBe(
      untouched,
    );
  });

  it("da la audiencia nueva a la serie nueva y a sus sesiones", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);

    const split = await splitSeries(database, fromChosen(world), {
      audience: "groups",
      group_ids: [world.mastersSquad],
    });

    await expect(
      describeSeries(database, String(split.series_id)),
    ).resolves.toMatch(new RegExp(`\\|${world.mastersSquad}$`));
    await expect(describeOccurrence(database, world.chosenId)).resolves.toMatch(
      new RegExp(`\\|${world.mastersSquad}$`),
    );
    await expect(describeSeries(database, world.seriesId)).resolves.toMatch(
      new RegExp(`\\|${world.seniorSquad}$`),
    );
  });

  it("conserva las respuestas, la asistencia y los equipos de las sesiones movidas", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);
    await database.query(
      `insert into public.attendance_records
         (event_id, user_id, club_id, status)
       values ('${world.chosenId}', '${world.userId}', '${world.clubId}',
               'present')`,
    );
    await database.query(
      `insert into public.team_splits
         (club_id, event_id, mode, team_a_name, team_a_color, team_b_name,
          team_b_color)
       values ('${world.clubId}', '${world.chosenId}', 'manual', 'Blancos',
               '#ffffff', 'Negros', '#000000')`,
    );

    const split = await splitSeries(database, fromChosen(world), {
      location: "Aquatic",
    });

    await expect(
      database.query(
        `select count(*) from public.event_rsvps r
           join public.events e on e.id = r.event_id
          where e.series_id = '${String(split.series_id)}'`,
      ),
    ).resolves.toBe("4");
    await expect(
      database.query(
        `select count(*) from public.attendance_records
          where event_id = '${world.chosenId}'`,
      ),
    ).resolves.toBe("1");
    await expect(
      database.query(
        `select count(*) from public.team_splits
          where event_id = '${world.chosenId}'`,
      ),
    ).resolves.toBe("1");
  });

  it("edita la serie entera sin crear otra si la elegida es la primera", async () => {
    const database = await migratedDatabase();
    const seeded = await seedSeries(database, 3);
    const firstId = await seedOccurrence(database, seeded, {
      daysFromToday: 3,
    });
    const laterId = await seedOccurrence(database, seeded, {
      daysFromToday: 10,
    });

    const split = await splitSeries(
      database,
      { clubId: seeded.clubId, seriesId: seeded.seriesId, fromId: firstId },
      { location: "Aquatic" },
    );

    expect(split).toEqual({
      outcome: "edited",
      series_id: seeded.seriesId,
      updated_occurrences: 2,
    });
    await expect(
      database.query(
        `select count(*) from public.event_series
          where club_id = '${seeded.clubId}'`,
      ),
    ).resolves.toBe("1");
    await expect(describeOccurrence(database, laterId)).resolves.toBe(
      `${seeded.seriesId}|Entrenamiento|19:00:00|Aquatic|sin notas|scheduled|${seeded.seniorSquad}`,
    );
  });

  it("rechaza partir desde una sesión que ya empezó, sin escribir nada", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);
    const before = await snapshotAll(database, world);

    const split = await splitSeries(
      database,
      { ...fromChosen(world), fromId: world.pastId },
      { location: "Aquatic" },
    );

    expect(split).toEqual({ outcome: "occurrence_started" });
    await expect(snapshotAll(database, world)).resolves.toEqual(before);
  });

  it("rechaza una sesión de otra serie, sin escribir nada", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);
    const otherSeriesId = await database.query(
      `insert into public.event_series
         (club_id, title, event_type, start_time, location, audience,
          weekdays, starts_on, ends_on, author_id)
       select club_id, 'Social', 'social', start_time, location, audience,
              weekdays, starts_on, ends_on, author_id
         from public.event_series where id = '${world.seriesId}'
       returning id`,
    );
    const other = { ...world, seriesId: otherSeriesId };
    const foreignId = await seedOccurrence(database, other, {
      daysFromToday: 7,
    });
    const before = await snapshotAll(database, world);

    const split = await splitSeries(
      database,
      { ...fromChosen(world), fromId: foreignId },
      { location: "Aquatic" },
    );

    expect(split).toEqual({ outcome: "session_not_in_series" });
    await expect(snapshotAll(database, world)).resolves.toEqual(before);
  });

  it("rechaza la segunda de dos particiones a la vez desde la misma sesión", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);

    const outcomes = await Promise.all([
      splitSeries(database, fromChosen(world), { location: "Aquatic" }),
      splitSeries(database, fromChosen(world), { location: "Harold Holt" }),
    ]);

    expect(outcomes.map((split) => split.outcome).sort()).toEqual([
      "session_not_in_series",
      "split",
    ]);
    await expect(
      database.query(
        `select count(*) from public.event_series
          where club_id = '${world.clubId}'`,
      ),
    ).resolves.toBe("2");
  });

  it("no cambia nada si falla a medias, con un grupo nuevo de otro club", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);
    const before = await snapshotAll(database, world);
    const otherClub = await database.query(
      `insert into public.clubs (name, slug)
       values ('Otro club', 'otro-club-' || gen_random_uuid())
       returning id`,
    );
    const foreignGroup = await seedGroup(database, otherClub, "Ajeno");

    const attempt = await database.attempt(
      splitSeriesCall(fromChosen(world), {
        location: "Aquatic",
        audience: "groups",
        group_ids: [world.mastersSquad, foreignGroup],
      }),
    );

    expect(attempt.code).not.toBe(0);
    await expect(snapshotAll(database, world)).resolves.toEqual(before);
  });

  it("no parte ni escribe si desde la elegida no queda ninguna sesión por cambiar", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);
    await database.query(
      `update public.events set status = 'cancelled', cancelled_at = now()
        where id in ('${world.chosenId}', '${world.editedId}',
                     '${world.upcomingId}')`,
    );
    const before = await snapshotAll(database, world);

    const split = await splitSeries(database, fromChosen(world), {
      location: "Aquatic",
    });

    expect(split).toMatchObject({ updated_occurrences: 0 });
    await expect(snapshotAll(database, world)).resolves.toEqual(before);
  });

  it("responde que la sesión no es de la serie a una serie de otro club", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);
    const before = await snapshotAll(database, world);
    const otherClub = await database.query(
      `insert into public.clubs (name, slug)
       values ('Otro club', 'otro-club-' || gen_random_uuid())
       returning id`,
    );

    const split = await splitSeries(
      database,
      { ...fromChosen(world), clubId: otherClub },
      { location: "Aquatic" },
    );

    expect(split).toEqual({ outcome: "session_not_in_series" });
    await expect(snapshotAll(database, world)).resolves.toEqual(before);
  });
});

describeConPostgres("quién puede partir series en la base", () => {
  it("sólo service_role ejecuta split_series", async () => {
    const database = await migratedDatabase();

    const grantees = await database.query(
      `select string_agg(r.rolname, ',' order by r.rolname)
         from pg_roles r
        where r.rolname in ('anon', 'authenticated', 'service_role')
          and has_function_privilege(
                r.rolname,
                'public.split_series(uuid, uuid, uuid, jsonb, jsonb)', 'execute')`,
    );

    expect(grantees).toBe("service_role");
  });

  it("nadie ejecuta reschedule_series_sessions desde fuera", async () => {
    const database = await migratedDatabase();

    const grantees = await database.query(
      `select count(*)
         from pg_roles r
        where r.rolname in ('anon', 'authenticated', 'service_role')
          and has_function_privilege(
                r.rolname,
                'public.reschedule_series_sessions(uuid, uuid, date, jsonb)',
                'execute')`,
    );

    expect(grantees).toBe("0");
  });

  it("no deja la versión de cuatro argumentos al lado de la nueva", async () => {
    const database = await migratedDatabase();

    const versions = await database.query(
      `select count(*) from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'split_series'`,
    );

    expect(versions).toBe("1");
  });
});

/** La fecha de dentro de tantos días, en `YYYY-MM-DD`. */
function dayFromToday(
  database: TemporaryDatabase,
  daysFromToday: number,
): Promise<string> {
  return database.query(`select (current_date + ${daysFromToday})::text`);
}

async function daysFromToday(
  database: TemporaryDatabase,
  offsets: readonly number[],
): Promise<readonly string[]> {
  return Promise.all(offsets.map((offset) => dayFromToday(database, offset)));
}

/** El horario nuevo desde la elegida (en 7 días), con fechas en días desde
 * hoy. */
async function scheduleOf(
  database: TemporaryDatabase,
  plan: {
    readonly weekdays: readonly number[];
    readonly endsIn: number;
    readonly sessions: readonly number[];
    readonly added: readonly number[];
  },
): Promise<ScheduleArgument> {
  return {
    weekdays: plan.weekdays,
    ends_on: await dayFromToday(database, plan.endsIn),
    session_dates: await daysFromToday(database, plan.sessions),
    added_dates: await daysFromToday(database, plan.added),
  };
}

function rsvpCount(
  database: TemporaryDatabase,
  eventId: string,
): Promise<string> {
  return database.query(
    `select count(*) from public.event_rsvps where event_id = '${eventId}'`,
  );
}

/** Las sesiones de una serie en una fecha, con su estado. */
function sessionsOn(
  database: TemporaryDatabase,
  seriesId: string,
  daysFromNow: number,
): Promise<string> {
  return database.query(
    `select coalesce(string_agg(status, ','), '')
       from public.events
      where series_id = '${seriesId}'
        and starts_on = current_date + ${daysFromNow}`,
  );
}

describeConPostgres(
  "partir una serie con otros días o fecha final (#654)",
  () => {
    it("cancela las sesiones movidas que ya no caen en las fechas, sin borrarlas ni sus respuestas", async () => {
      const database = await migratedDatabase();
      const world = await seedWorld(database);
      const schedule = await scheduleOf(database, {
        weekdays: [1, 2],
        endsIn: 60,
        sessions: [7, 21],
        added: [],
      });

      const split = await splitSeries(
        database,
        fromChosen(world),
        {},
        schedule,
      );

      const newId = String(split.series_id);
      expect(split).toMatchObject({ outcome: "split", updated_occurrences: 3 });
      await expect(describeOccurrence(database, world.editedId)).resolves.toBe(
        `${newId}|Entrenamiento|18:30:00|MSAC|Piscina 2|cancelled|${world.seniorSquad}`,
      );
      await expect(rsvpCount(database, world.editedId)).resolves.toBe("1");
      await expect(sessionsOn(database, newId, 21)).resolves.toBe("scheduled");
    });

    it("guarda los días y la fecha final nuevos en la serie nueva, no en la original", async () => {
      const database = await migratedDatabase();
      const world = await seedWorld(database);
      const schedule = await scheduleOf(database, {
        weekdays: [1, 4],
        endsIn: 40,
        sessions: [7, 14, 21],
        added: [],
      });

      const split = await splitSeries(
        database,
        fromChosen(world),
        {},
        schedule,
      );

      await expect(
        describeSeries(database, String(split.series_id)),
      ).resolves.toBe(
        `Entrenamiento|19:00:00|MSAC|{1,4}|7|40|${world.seniorSquad}`,
      );
      await expect(describeSeries(database, world.seriesId)).resolves.toBe(
        `Entrenamiento|19:00:00|MSAC|{1,2,3,4,5,6,7}|-30|6|${world.seniorSquad}`,
      );
    });

    it("crea las sesiones de las fechas añadidas sin respuestas, con la audiencia y los cambios", async () => {
      const database = await migratedDatabase();
      const world = await seedWorld(database);
      const schedule = await scheduleOf(database, {
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        endsIn: 70,
        sessions: [7, 8, 14, 21, 70],
        added: [8, 70],
      });

      const split = await splitSeries(
        database,
        fromChosen(world),
        {
          start_time: "20:00",
          audience: "groups",
          group_ids: [world.mastersSquad],
        },
        schedule,
      );

      const newId = String(split.series_id);
      const createdId = await database.query(
        `select id from public.events
        where series_id = '${newId}' and starts_on = current_date + 70`,
      );
      await expect(describeOccurrence(database, createdId)).resolves.toBe(
        `${newId}|Entrenamiento|20:00:00|MSAC|sin notas|scheduled|${world.mastersSquad}`,
      );
      await expect(rsvpCount(database, createdId)).resolves.toBe("0");
      await expect(sessionsOn(database, newId, 8)).resolves.toBe("scheduled");
    });

    it("reactiva la cancelada de una fecha añadida, sin duplicarla, con sus respuestas y los campos de la serie", async () => {
      const database = await migratedDatabase();
      const world = await seedWorld(database);
      await database.query(
        `update public.events set start_time = '17:00', notes = 'Vieja'
        where id = '${world.cancelledId}'`,
      );
      const schedule = await scheduleOf(database, {
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        endsIn: 60,
        sessions: [7, 10, 14, 21],
        added: [10],
      });

      const split = await splitSeries(
        database,
        fromChosen(world),
        {},
        schedule,
      );

      const newId = String(split.series_id);
      await expect(
        describeOccurrence(database, world.cancelledId),
      ).resolves.toBe(
        `${newId}|Entrenamiento|19:00:00|MSAC|sin notas|scheduled|${world.seniorSquad}`,
      );
      await expect(sessionsOn(database, newId, 10)).resolves.toBe("scheduled");
      await expect(rsvpCount(database, world.cancelledId)).resolves.toBe("1");
    });

    it("deja cancelada la de una fecha que la serie ya tenía", async () => {
      const database = await migratedDatabase();
      const world = await seedWorld(database);
      const schedule = await scheduleOf(database, {
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        endsIn: 60,
        sessions: [7, 10, 14, 21],
        added: [],
      });

      const split = await splitSeries(
        database,
        fromChosen(world),
        {},
        schedule,
      );

      await expect(
        sessionsOn(database, String(split.series_id), 10),
      ).resolves.toBe("cancelled");
    });

    it("al acortar cancela las sesiones posteriores a la fecha final", async () => {
      const database = await migratedDatabase();
      const world = await seedWorld(database);
      const schedule = await scheduleOf(database, {
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        endsIn: 15,
        sessions: [7, 14],
        added: [],
      });

      const split = await splitSeries(
        database,
        fromChosen(world),
        {},
        schedule,
      );

      await expect(
        sessionsOn(database, String(split.series_id), 21),
      ).resolves.toBe("cancelled");
      await expect(
        sessionsOn(database, String(split.series_id), 14),
      ).resolves.toBe("scheduled");
    });

    it("no toca las sesiones anteriores a la elegida", async () => {
      const database = await migratedDatabase();
      const world = await seedWorld(database);
      const untouched = `${world.seriesId}|Entrenamiento|19:00:00|MSAC|sin notas|scheduled|${world.seniorSquad}`;
      const schedule = await scheduleOf(database, {
        weekdays: [1],
        endsIn: 60,
        sessions: [7],
        added: [],
      });

      await splitSeries(database, fromChosen(world), {}, schedule);

      await expect(describeOccurrence(database, world.pastId)).resolves.toBe(
        untouched,
      );
      await expect(describeOccurrence(database, world.earlierId)).resolves.toBe(
        untouched,
      );
    });

    it("desde la primera sesión cambia los días de la serie entera, sin crear otra", async () => {
      const database = await migratedDatabase();
      const seeded = await seedSeries(database, 3);
      const firstId = await seedOccurrence(database, seeded, {
        daysFromToday: 3,
      });
      await seedOccurrence(database, seeded, { daysFromToday: 10 });
      const schedule = await scheduleOf(database, {
        weekdays: [2, 5],
        endsIn: 30,
        sessions: [3, 5, 10],
        added: [5],
      });

      const split = await splitSeries(
        database,
        { clubId: seeded.clubId, seriesId: seeded.seriesId, fromId: firstId },
        {},
        schedule,
      );

      expect(split).toEqual({
        outcome: "edited",
        series_id: seeded.seriesId,
        updated_occurrences: 3,
      });
      await expect(describeSeries(database, seeded.seriesId)).resolves.toBe(
        `Entrenamiento|19:00:00|MSAC|{2,5}|3|30|${seeded.seniorSquad}`,
      );
      await expect(sessionsOn(database, seeded.seriesId, 5)).resolves.toBe(
        "scheduled",
      );
    });

    it("parte aunque desde la elegida estén todas canceladas si hay fechas que añadir", async () => {
      const database = await migratedDatabase();
      const world = await seedWorld(database);
      await database.query(
        `update public.events set status = 'cancelled', cancelled_at = now()
        where id in ('${world.chosenId}', '${world.editedId}',
                     '${world.upcomingId}')`,
      );
      const schedule = await scheduleOf(database, {
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        endsIn: 60,
        sessions: [8],
        added: [8],
      });

      const split = await splitSeries(
        database,
        fromChosen(world),
        {},
        schedule,
      );

      expect(split).toMatchObject({ outcome: "split", updated_occurrences: 1 });
      await expect(
        sessionsOn(database, String(split.series_id), 8),
      ).resolves.toBe("scheduled");
    });

    it("rechaza fechas anteriores a la elegida, sin cambiar nada", async () => {
      const database = await migratedDatabase();
      const world = await seedWorld(database);
      const before = await snapshotAll(database, world);
      const schedule = await scheduleOf(database, {
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        endsIn: 60,
        sessions: [4, 7],
        added: [4],
      });

      const attempt = await database.attempt(
        splitSeriesCall(fromChosen(world), {}, schedule),
      );

      expect(attempt.code).not.toBe(0);
      await expect(snapshotAll(database, world)).resolves.toEqual(before);
    });

    it("no cambia nada si falla a medias, ni cancela ni crea sesiones", async () => {
      const database = await migratedDatabase();
      const world = await seedWorld(database);
      const before = await snapshotAll(database, world);
      const otherClub = await database.query(
        `insert into public.clubs (name, slug)
       values ('Otro club', 'otro-club-' || gen_random_uuid())
       returning id`,
      );
      const foreignGroup = await seedGroup(database, otherClub, "Ajeno");
      const schedule = await scheduleOf(database, {
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        endsIn: 60,
        sessions: [7, 8],
        added: [8],
      });

      const attempt = await database.attempt(
        splitSeriesCall(
          fromChosen(world),
          { audience: "groups", group_ids: [foreignGroup] },
          schedule,
        ),
      );

      expect(attempt.code).not.toBe(0);
      await expect(snapshotAll(database, world)).resolves.toEqual(before);
      await expect(
        database.query(
          `select count(*) from public.events where club_id = '${world.clubId}'`,
        ),
      ).resolves.toBe("6");
    });
  },
);
