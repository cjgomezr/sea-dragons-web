import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0041_update_series.sql` contra un Postgres desechable (#315, RF-12 del PRD
 * de E7). La función cambia la serie y sus ocurrencias futuras no
 * canceladas, las editadas solas incluidas, todo o nada. Las pasadas y las
 * canceladas no se tocan, y sin ninguna futura no escribe nada.
 */

const SEEDED_CLUB = "victoria-seadragons";

type World = {
  readonly clubId: string;
  readonly seriesId: string;
  readonly seniorSquad: string;
  readonly mastersSquad: string;
  readonly pastId: string;
  readonly cancelledId: string;
  readonly editedId: string;
  readonly upcomingId: string;
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

type OccurrenceSeed = {
  readonly world: Pick<World, "clubId" | "seriesId" | "seniorSquad">;
  readonly userId: string;
  /** Días desde hoy; negativo es pasado. */
  readonly daysFromToday: number;
  readonly startTime?: string;
  readonly notes?: string;
  readonly cancelled?: true;
};

async function seedOccurrence(
  database: TemporaryDatabase,
  seed: OccurrenceSeed,
): Promise<string> {
  const { world } = seed;
  const eventId = await database.query(
    `insert into public.events
       (club_id, series_id, title, event_type, starts_on, start_time,
        location, notes, audience, author_id, status, cancelled_at)
     values ('${world.clubId}', '${world.seriesId}', 'Entrenamiento',
             'training', current_date + ${seed.daysFromToday},
             '${seed.startTime ?? "19:00"}', 'MSAC',
             ${seed.notes === undefined ? "null" : `'${seed.notes}'`},
             'groups', '${seed.userId}',
             '${seed.cancelled ? "cancelled" : "scheduled"}',
             ${seed.cancelled ? "now()" : "null"})
     returning id`,
  );
  await database.query(
    `insert into public.event_groups (event_id, group_id, club_id)
     values ('${eventId}', '${world.seniorSquad}', '${world.clubId}')`,
  );
  await database.query(
    `insert into public.event_rsvps (event_id, user_id, club_id, response)
     values ('${eventId}', '${seed.userId}', '${world.clubId}', 'yes')`,
  );
  return eventId;
}

/** Una serie para el Senior Squad con una ocurrencia pasada, una cancelada,
 * una futura editada sola y otra futura, cada una con una respuesta. */
async function seedWorld(database: TemporaryDatabase): Promise<World> {
  const clubId = await database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
  const userId = await seedCaller(database, clubId);
  const seniorSquad = await seedGroup(database, clubId, "Senior Squad");
  const mastersSquad = await seedGroup(database, clubId, "Masters");
  const seriesId = await database.query(
    `insert into public.event_series
       (club_id, title, event_type, start_time, location, notes, audience,
        weekdays, starts_on, ends_on, author_id)
     values ('${clubId}', 'Entrenamiento', 'training', '19:00', 'MSAC',
             null, 'groups', '{1,2,3,4,5,6,7}', current_date - 30,
             current_date + 60, '${userId}')
     returning id`,
  );
  await database.query(
    `insert into public.event_series_groups (series_id, group_id, club_id)
     values ('${seriesId}', '${seniorSquad}', '${clubId}')`,
  );
  const base = { clubId, seriesId, seniorSquad };
  const occurrence = (
    seed: Omit<OccurrenceSeed, "world" | "userId">,
  ): Promise<string> =>
    seedOccurrence(database, { ...seed, world: base, userId });
  return {
    ...base,
    mastersSquad,
    pastId: await occurrence({ daysFromToday: -7 }),
    cancelledId: await occurrence({ daysFromToday: 7, cancelled: true }),
    editedId: await occurrence({
      daysFromToday: 14,
      startTime: "18:30",
      notes: "Piscina 2",
    }),
    upcomingId: await occurrence({ daysFromToday: 21 }),
  };
}

function updateSeriesCall(world: World, changes: object): string {
  return `select public.update_series('${world.clubId}', '${world.seriesId}', '${JSON.stringify(changes)}'::jsonb)`;
}

function describeOccurrence(
  database: TemporaryDatabase,
  eventId: string,
): Promise<string> {
  return database.query(
    `select title || '|' || start_time || '|' || location || '|'
            || coalesce(notes, 'sin notas') || '|' || audience || '|'
            || coalesce((select string_agg(group_id::text, ',' order by group_id)
                           from public.event_groups where event_id = e.id), '')
       from public.events e where id = '${eventId}'`,
  );
}

function describeSeries(
  database: TemporaryDatabase,
  world: World,
): Promise<string> {
  return database.query(
    `select title || '|' || start_time || '|' || location || '|'
            || coalesce(notes, 'sin notas') || '|' || audience || '|'
            || coalesce((select string_agg(group_id::text, ',' order by group_id)
                           from public.event_series_groups
                          where series_id = s.id), '')
       from public.event_series s where id = '${world.seriesId}'`,
  );
}

function snapshotAll(
  database: TemporaryDatabase,
  world: World,
): Promise<readonly string[]> {
  return Promise.all([
    describeSeries(database, world),
    ...[world.pastId, world.cancelledId, world.editedId, world.upcomingId].map(
      (id) => describeOccurrence(database, id),
    ),
  ]);
}

describeConPostgres("editar una serie en la base", () => {
  it("cambia la hora y el lugar de la serie y de sus dos ocurrencias futuras", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);

    const updated = await database.query(
      updateSeriesCall(world, { start_time: "20:00", location: "Aquatic" }),
    );

    expect(updated).toBe("2");
    await expect(describeSeries(database, world)).resolves.toBe(
      `Entrenamiento|20:00:00|Aquatic|sin notas|groups|${world.seniorSquad}`,
    );
    await expect(describeOccurrence(database, world.upcomingId)).resolves.toBe(
      `Entrenamiento|20:00:00|Aquatic|sin notas|groups|${world.seniorSquad}`,
    );
  });

  it("aplica los cambios a la ocurrencia editada sola y le deja lo demás", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);

    await database.query(
      updateSeriesCall(world, { start_time: "20:00", location: "Aquatic" }),
    );

    await expect(describeOccurrence(database, world.editedId)).resolves.toBe(
      `Entrenamiento|20:00:00|Aquatic|Piscina 2|groups|${world.seniorSquad}`,
    );
  });

  it("no toca la ocurrencia pasada ni la cancelada", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);
    const untouched = `Entrenamiento|19:00:00|MSAC|sin notas|groups|${world.seniorSquad}`;

    await database.query(
      updateSeriesCall(world, { start_time: "20:00", location: "Aquatic" }),
    );

    await expect(describeOccurrence(database, world.pastId)).resolves.toBe(
      untouched,
    );
    await expect(describeOccurrence(database, world.cancelledId)).resolves.toBe(
      untouched,
    );
  });

  it("sustituye la audiencia de la serie y de sus ocurrencias futuras", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);

    await database.query(
      updateSeriesCall(world, {
        audience: "groups",
        group_ids: [world.mastersSquad],
      }),
    );

    await expect(describeSeries(database, world)).resolves.toMatch(
      new RegExp(`\\|${world.mastersSquad}$`),
    );
    await expect(
      describeOccurrence(database, world.upcomingId),
    ).resolves.toMatch(new RegExp(`\\|${world.mastersSquad}$`));
    await expect(describeOccurrence(database, world.pastId)).resolves.toMatch(
      new RegExp(`\\|${world.seniorSquad}$`),
    );
  });

  it("pasa a todo el club sin filas de audiencia", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);

    await database.query(
      updateSeriesCall(world, { audience: "all", group_ids: [] }),
    );

    await expect(describeSeries(database, world)).resolves.toMatch(/\|all\|$/);
    await expect(describeOccurrence(database, world.editedId)).resolves.toMatch(
      /\|all\|$/,
    );
  });

  it("conserva las respuestas de las ocurrencias que cambia", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);

    await database.query(
      updateSeriesCall(world, { audience: "groups", group_ids: [] }),
    );

    await expect(
      database.query(
        `select count(*) from public.event_rsvps e
           join public.events ev on ev.id = e.event_id
          where ev.series_id = '${world.seriesId}'`,
      ),
    ).resolves.toBe("4");
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
      updateSeriesCall(world, {
        location: "Aquatic",
        audience: "groups",
        group_ids: [world.mastersSquad, foreignGroup],
      }),
    );

    expect(attempt.code).not.toBe(0);
    await expect(snapshotAll(database, world)).resolves.toEqual(before);
  });

  it("devuelve 0 y no escribe nada si no le quedan ocurrencias futuras", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);
    await database.query(
      `update public.events set status = 'cancelled', cancelled_at = now()
        where id in ('${world.editedId}', '${world.upcomingId}')`,
    );
    const before = await snapshotAll(database, world);

    const updated = await database.query(
      updateSeriesCall(world, { location: "Aquatic" }),
    );

    expect(updated).toBe("0");
    await expect(snapshotAll(database, world)).resolves.toEqual(before);
  });

  it("no toca una serie de otro club", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);
    const before = await snapshotAll(database, world);
    const otherClub = await database.query(
      `insert into public.clubs (name, slug)
       values ('Otro club', 'otro-club-' || gen_random_uuid())
       returning id`,
    );

    const updated = await database.query(
      updateSeriesCall(
        { ...world, clubId: otherClub },
        { location: "Aquatic" },
      ),
    );

    expect(updated).toBe("0");
    await expect(snapshotAll(database, world)).resolves.toEqual(before);
  });
});

describeConPostgres("quién puede editar series en la base", () => {
  it("sólo service_role ejecuta update_series", async () => {
    const database = await migratedDatabase();

    const grantees = await database.query(
      `select string_agg(r.rolname, ',' order by r.rolname)
         from pg_roles r
        where r.rolname in ('anon', 'authenticated', 'service_role')
          and has_function_privilege(
                r.rolname, 'public.update_series(uuid, uuid, jsonb)', 'execute')`,
    );

    expect(grantees).toBe("service_role");
  });
});
