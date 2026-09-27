import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0035_create_events.sql` contra un Postgres desechable (#307, RF-2 y RF-3
 * del PRD de E7). Una serie son muchas filas: la serie, su audiencia, cada
 * ocurrencia y la audiencia de cada una. La función las escribe todas o
 * ninguna.
 */

const SEEDED_CLUB = "victoria-seadragons";

type Saved = {
  readonly series_id: string | null;
  readonly event_ids: readonly string[];
};

type Schedule = {
  readonly title?: string;
  readonly event_type?: string;
  readonly start_time?: string;
  readonly location?: string;
  readonly notes?: string | null;
  readonly audience?: "all" | "groups";
  readonly group_ids?: readonly string[];
  readonly occurrence_dates: readonly string[];
  readonly series?: {
    readonly weekdays: readonly number[];
    readonly starts_on: string;
    readonly ends_on: string;
  } | null;
};

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

async function seedMember(
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

function scheduleJson(schedule: Schedule): string {
  return JSON.stringify({
    title: "Entrenamiento",
    event_type: "training",
    start_time: "19:00",
    location: "MSAC",
    notes: null,
    audience: "all",
    group_ids: [],
    series: null,
    ...schedule,
  });
}

function createEventsCall(
  author: { readonly clubId: string; readonly userId: string },
  schedule: Schedule,
): string {
  return `select public.create_events('${author.clubId}', '${author.userId}', '${scheduleJson(schedule)}'::jsonb)`;
}

async function createEvents(
  database: TemporaryDatabase,
  author: { readonly clubId: string; readonly userId: string },
  schedule: Schedule,
): Promise<Saved> {
  return JSON.parse(
    await database.query(createEventsCall(author, schedule)),
  ) as Saved;
}

function count(database: TemporaryDatabase, table: string): Promise<string> {
  return database.query(`select count(*) from public.${table}`);
}

async function seededAuthor(
  database: TemporaryDatabase,
): Promise<{ readonly clubId: string; readonly userId: string }> {
  const clubId = await seededClubId(database);
  return { clubId, userId: await seedMember(database, clubId) };
}

describeConPostgres("crear eventos todo o nada", () => {
  it("guarda un evento suelto con su audiencia de grupos y sin serie", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const seniorSquad = await seedGroup(
      database,
      author.clubId,
      "Senior Squad",
    );

    const saved = await createEvents(database, author, {
      title: "Liga estatal",
      event_type: "competition",
      start_time: "10:00",
      notes: "Llevad gorro azul.",
      audience: "groups",
      group_ids: [seniorSquad],
      occurrence_dates: ["2027-07-10"],
    });

    expect(saved.series_id).toBeNull();
    expect(saved.event_ids).toHaveLength(1);
    const row = await database.query(
      `select title || '|' || event_type || '|' || starts_on || '|'
              || start_time || '|' || location || '|' || notes || '|'
              || audience || '|' || coalesce(series_id::text, 'sin serie')
              || '|' || (author_id = '${author.userId}')
         from public.events where id = '${saved.event_ids[0]}'`,
    );
    expect(row).toBe(
      "Liga estatal|competition|2027-07-10|10:00:00|MSAC|Llevad gorro azul.|groups|sin serie|true",
    );
    await expect(
      database.query(
        `select group_id from public.event_groups
          where event_id = '${saved.event_ids[0]}'`,
      ),
    ).resolves.toBe(seniorSquad);
    await expect(count(database, "event_series")).resolves.toBe("0");
  });

  it("guarda la serie, su audiencia y una ocurrencia por fecha con la misma audiencia", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const seniorSquad = await seedGroup(
      database,
      author.clubId,
      "Senior Squad",
    );
    const dates = ["2027-07-01", "2027-07-06", "2027-07-08"];

    const saved = await createEvents(database, author, {
      audience: "groups",
      group_ids: [seniorSquad],
      occurrence_dates: dates,
      series: {
        weekdays: [2, 4],
        starts_on: "2027-07-01",
        ends_on: "2027-07-08",
      },
    });

    expect(saved.series_id).not.toBeNull();
    expect(saved.event_ids).toHaveLength(3);
    await expect(
      database.query(
        `select string_agg(starts_on::text, ',' order by starts_on)
           from public.events where series_id = '${saved.series_id}'`,
      ),
    ).resolves.toBe(dates.join(","));
    await expect(
      database.query(
        `select weekdays::text || '|' || starts_on || '|' || ends_on
           from public.event_series where id = '${saved.series_id}'`,
      ),
    ).resolves.toBe("{2,4}|2027-07-01|2027-07-08");
    await expect(count(database, "event_series_groups")).resolves.toBe("1");
    await expect(
      database.query(
        `select count(*) from public.event_groups
          where group_id = '${seniorSquad}'`,
      ),
    ).resolves.toBe("3");
  });

  it("devuelve los ids de las ocurrencias en el orden de sus fechas", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);

    const saved = await createEvents(database, author, {
      occurrence_dates: ["2027-07-01", "2027-07-06"],
      series: {
        weekdays: [2, 4],
        starts_on: "2027-07-01",
        ends_on: "2027-07-06",
      },
    });

    const orderedIds = await database.query(
      `select string_agg(id::text, ',' order by starts_on)
         from public.events`,
    );
    expect(saved.event_ids.join(",")).toBe(orderedIds);
  });

  it("empieza cada ocurrencia a las 19:00 de Melbourne a los dos lados del cambio de abril", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);

    await createEvents(database, author, {
      occurrence_dates: ["2027-03-30", "2027-04-06"],
      series: { weekdays: [2], starts_on: "2027-03-29", ends_on: "2027-04-12" },
    });

    const starts = await database.query(
      `select string_agg(
                to_char(starts_at at time zone 'Australia/Melbourne', 'HH24:MI')
                || '/' || to_char(starts_at at time zone 'UTC', 'HH24:MI'),
                ',' order by starts_on)
         from public.events`,
    );
    expect(starts).toBe("19:00/08:00,19:00/09:00");
  });

  it("no deja ni la serie ni ninguna ocurrencia ni su audiencia si una fila falla", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const otherClub = await createOtherClub(database);
    const foreignGroup = await seedGroup(database, otherClub, "Ajeno");

    const attempt = await database.attempt(
      createEventsCall(author, {
        audience: "groups",
        group_ids: [foreignGroup],
        occurrence_dates: ["2027-07-01", "2027-07-06"],
        series: {
          weekdays: [2, 4],
          starts_on: "2027-07-01",
          ends_on: "2027-07-06",
        },
      }),
    );

    expect(attempt.code).not.toBe(0);
    for (const table of [
      "event_series",
      "event_series_groups",
      "events",
      "event_groups",
    ]) {
      await expect(count(database, table)).resolves.toBe("0");
    }
  });

  it("rechaza una llamada sin ninguna fecha", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);

    const attempt = await database.attempt(
      createEventsCall(author, { occurrence_dates: [] }),
    );

    expect(attempt.code).not.toBe(0);
    await expect(count(database, "events")).resolves.toBe("0");
  });
});

describeConPostgres("quién puede crear eventos en la base", () => {
  it("sólo service_role ejecuta create_events", async () => {
    const database = await migratedDatabase();

    const grantees = await database.query(
      `select string_agg(r.rolname, ',' order by r.rolname)
         from pg_roles r
        where r.rolname in ('anon', 'authenticated', 'service_role')
          and has_function_privilege(
                r.rolname, 'public.create_events(uuid, uuid, jsonb)', 'execute')`,
    );

    expect(grantees).toBe("service_role");
  });
});
