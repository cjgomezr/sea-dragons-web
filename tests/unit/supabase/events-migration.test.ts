import { expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `public.events`, `public.event_series` y sus tablas de audiencia contra un
 * Postgres desechable (#306, RF-1 y RF-4 del PRD de E7). La regla que más
 * importa es la de lectura: un miembro sólo recibe, aunque llame a la base
 * directamente, los eventos de su club dirigidos a él (AC-050, AC-052).
 */

/** Los límites que la migración nombra. */
const TITLE_MAX_LENGTH = 80;
const LOCATION_MAX_LENGTH = 120;
const NOTES_MAX_LENGTH = 2000;

/** Etiquetas que psql imprime entre las filas que sí interesan. */
const COMMAND_TAGS: ReadonlySet<string> = new Set(["SET"]);

async function seededClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    "select id from public.clubs where slug = 'victoria-seadragons'",
  );
}

async function seedOtherClub(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `insert into public.clubs (name, slug)
     values ('Otro club', 'otro-club-' || gen_random_uuid())
     returning id`,
  );
}

interface SeedMemberOptions {
  readonly clubId?: string;
  readonly accountStatus?: "incomplete" | "active" | "inactive";
}

/** Crea una identidad y su socio, y devuelve el `user_id` que los une. */
async function seedMember(
  database: TemporaryDatabase,
  options: SeedMemberOptions = {},
): Promise<string> {
  const clubId = options.clubId ?? (await seededClubId(database));
  const accountStatus = options.accountStatus ?? "active";
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members (club_id, user_id, full_name, email, account_status)
     values ('${clubId}', '${userId}', 'Socio de prueba',
             '${userId}@example.test', '${accountStatus}')`,
  );
  return userId;
}

async function seedGroup(
  database: TemporaryDatabase,
  name: string,
  clubId?: string,
): Promise<string> {
  const club = clubId ?? (await seededClubId(database));
  return database.query(
    `insert into public.groups (club_id, name) values ('${club}', '${name}')
     returning id`,
  );
}

async function addToGroup(
  database: TemporaryDatabase,
  groupId: string,
  userId: string,
): Promise<void> {
  await database.query(
    `insert into public.group_memberships (group_id, user_id, club_id)
     select '${groupId}', '${userId}', club_id from public.groups
      where id = '${groupId}'`,
  );
}

/** Columnas de un evento, en SQL literal: una cadena va entre comillas. */
interface EventColumns {
  readonly authorId: string;
  readonly clubId?: string;
  readonly title?: string;
  readonly eventType?: string;
  readonly startsOn?: string;
  readonly startTime?: string;
  readonly location?: string;
  readonly notes?: string;
  readonly audience?: string;
  readonly status?: string;
  readonly cancelledAt?: string;
  readonly seriesId?: string;
}

function insertEventSql(event: EventColumns, clubId: string): string {
  return `insert into public.events
            (club_id, title, event_type, starts_on, start_time, location,
             notes, audience, status, cancelled_at, series_id, author_id)
          values ('${clubId}', ${event.title ?? "'Entrenamiento'"},
                  ${event.eventType ?? "'training'"},
                  ${event.startsOn ?? "'2026-05-12'"},
                  ${event.startTime ?? "'19:00'"},
                  ${event.location ?? "'MSAC'"},
                  ${event.notes ?? "null"},
                  ${event.audience ?? "'all'"},
                  ${event.status ?? "'scheduled'"},
                  ${event.cancelledAt ?? "null"},
                  ${event.seriesId ?? "null"},
                  '${event.authorId}')`;
}

async function insertEvent(
  database: TemporaryDatabase,
  event: EventColumns,
): Promise<RunResult> {
  const clubId = event.clubId ?? (await seededClubId(database));
  return database.attempt(insertEventSql(event, clubId));
}

async function seedEvent(
  database: TemporaryDatabase,
  event: EventColumns,
): Promise<string> {
  const clubId = event.clubId ?? (await seededClubId(database));
  return database.query(`${insertEventSql(event, clubId)} returning id`);
}

/** Columnas de una serie, en SQL literal, como las de un evento. */
interface SeriesColumns {
  readonly authorId: string;
  readonly clubId?: string;
  readonly weekdays?: string;
  readonly startsOn?: string;
  readonly endsOn?: string;
}

function insertSeriesSql(series: SeriesColumns, clubId: string): string {
  return `insert into public.event_series
            (club_id, title, event_type, start_time, location, notes,
             audience, weekdays, starts_on, ends_on, author_id)
          values ('${clubId}', 'Entrenamiento', 'training', '19:00', 'MSAC',
                  null, 'all', ${series.weekdays ?? "'{2,4}'"},
                  ${series.startsOn ?? "'2026-03-01'"},
                  ${series.endsOn ?? "'2026-06-30'"},
                  '${series.authorId}')`;
}

async function insertSeries(
  database: TemporaryDatabase,
  series: SeriesColumns,
): Promise<RunResult> {
  const clubId = series.clubId ?? (await seededClubId(database));
  return database.attempt(insertSeriesSql(series, clubId));
}

async function seedSeries(
  database: TemporaryDatabase,
  series: SeriesColumns,
): Promise<string> {
  const clubId = series.clubId ?? (await seededClubId(database));
  return database.query(`${insertSeriesSql(series, clubId)} returning id`);
}

async function targetGroup(
  database: TemporaryDatabase,
  eventId: string,
  groupId: string,
): Promise<RunResult> {
  return database.attempt(
    `insert into public.event_groups (event_id, group_id, club_id)
     select '${eventId}', '${groupId}', club_id from public.events
      where id = '${eventId}'`,
  );
}

async function targetSeriesGroup(
  database: TemporaryDatabase,
  seriesId: string,
  groupId: string,
): Promise<RunResult> {
  return database.attempt(
    `insert into public.event_series_groups (series_id, group_id, club_id)
     select '${seriesId}', '${groupId}', club_id from public.event_series
      where id = '${seriesId}'`,
  );
}

function count(database: TemporaryDatabase, table: string): Promise<string> {
  return database.query(`select count(*) from public.${table}`);
}

type ApiIdentity =
  | { readonly role: "anon" }
  | { readonly role: "authenticated"; readonly subject: string };

/** Lo que PostgREST monta antes de cada consulta: el rol de la API y, si hay
 * sesión, el `sub` del JWT que `auth.uid()` lee. */
function asApiIdentity(identity: ApiIdentity, sql: string): string {
  const claims =
    identity.role === "anon"
      ? ""
      : `set request.jwt.claims = '{"sub":"${identity.subject}"}'; `;
  return `set role ${identity.role}; ${claims}${sql}`;
}

function rowsOf(result: RunResult): string[] {
  return result.stdout
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !COMMAND_TAGS.has(line));
}

async function readAs(
  database: TemporaryDatabase,
  subject: string,
  sql: string,
): Promise<string[]> {
  const lectura = await database.attempt(
    asApiIdentity({ role: "authenticated", subject }, sql),
  );
  expect(lectura.code, lectura.stderr).toBe(0);
  return rowsOf(lectura);
}

function visibleTitles(
  database: TemporaryDatabase,
  subject: string,
): Promise<string[]> {
  // collate "C", como en las publicaciones: el orden no depende del Postgres.
  return readAs(
    database,
    subject,
    'select title from public.events order by title collate "C"',
  );
}

function columnsOf(
  database: TemporaryDatabase,
  table: string,
): Promise<string> {
  return database.query(
    `select column_name || ' ' || data_type || ' null=' || is_nullable
       from information_schema.columns
      where table_schema = 'public' and table_name = '${table}'
      order by column_name`,
  );
}

describeConPostgres("esquema de eventos", () => {
  it("guarda de cada evento club, título, tipo, fecha, hora, inicio, lugar, notas, audiencia, estado, serie y autor", async () => {
    const database = await migratedDatabase();

    const columns = await columnsOf(database, "events");

    expect(columns.split("\n")).toEqual([
      "audience text null=NO",
      "author_id uuid null=NO",
      "cancelled_at timestamp with time zone null=YES",
      "club_id uuid null=NO",
      "created_at timestamp with time zone null=NO",
      "event_type text null=NO",
      "id uuid null=NO",
      "location text null=NO",
      "notes text null=YES",
      "series_id uuid null=YES",
      "start_time time without time zone null=NO",
      "starts_at timestamp with time zone null=YES",
      "starts_on date null=NO",
      "status text null=NO",
      "title text null=NO",
    ]);
  });

  it("guarda de cada serie sus días, su rango y los campos que comparten sus ocurrencias", async () => {
    const database = await migratedDatabase();

    const columns = await columnsOf(database, "event_series");

    expect(columns.split("\n")).toEqual([
      "audience text null=NO",
      "author_id uuid null=NO",
      "club_id uuid null=NO",
      "created_at timestamp with time zone null=NO",
      "ends_on date null=NO",
      "event_type text null=NO",
      "id uuid null=NO",
      "location text null=NO",
      "notes text null=YES",
      "start_time time without time zone null=NO",
      "starts_on date null=NO",
      "title text null=NO",
      "weekdays ARRAY null=NO",
    ]);
  });

  it.each(["event_groups", "event_series_groups"])(
    "guarda en %s el grupo y el club de cada audiencia",
    async (table) => {
      const database = await migratedDatabase();

      const columns = await columnsOf(database, table);

      expect(columns).toMatch(/club_id uuid null=NO/);
      expect(columns).toMatch(/group_id uuid null=NO/);
    },
  );

  it("es idempotente: aplicada dos veces no falla ni duplica nada", async () => {
    const database = await migratedDatabase();
    const despuesDeLaPrimera = await database.snapshot();

    const segunda = await applyRepositoryMigrations(database);

    expect(segunda.code, segunda.stderr).toBe(0);
    for (const table of [
      "events",
      "event_groups",
      "event_series",
      "event_series_groups",
    ]) {
      expect(despuesDeLaPrimera).toMatch(new RegExp(`tabla ${table} rls=t`));
    }
    expect(await database.snapshot()).toBe(despuesDeLaPrimera);
  });

  it.each(["training", "competition", "meeting", "social"])(
    "acepta el tipo %s",
    async (eventType) => {
      const database = await migratedDatabase();
      const authorId = await seedMember(database);

      const insercion = await insertEvent(database, {
        authorId,
        eventType: `'${eventType}'`,
      });

      expect(insercion.code, insercion.stderr).toBe(0);
    },
  );

  it("rechaza un tipo que no es training, competition, meeting ni social", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertEvent(database, {
      authorId,
      eventType: "'party'",
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/events_event_type_check/);
  });

  it.each([
    ["vacío", "''"],
    ["de solo espacios", "'   '"],
    ["más largo que el límite", `repeat('x', ${TITLE_MAX_LENGTH + 1})`],
  ])("rechaza un título %s", async (_caso, title) => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertEvent(database, { authorId, title });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/events_title_length/);
  });

  it.each([
    ["vacío", "''"],
    ["más largo que el límite", `repeat('x', ${LOCATION_MAX_LENGTH + 1})`],
  ])("rechaza un lugar %s", async (_caso, location) => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertEvent(database, { authorId, location });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/events_location_length/);
  });

  it("rechaza unas notas más largas que el límite", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertEvent(database, {
      authorId,
      notes: `repeat('x', ${NOTES_MAX_LENGTH + 1})`,
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/events_notes_length/);
  });

  it("acepta título, lugar y notas justo en sus límites", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertEvent(database, {
      authorId,
      title: `repeat('x', ${TITLE_MAX_LENGTH})`,
      location: `repeat('x', ${LOCATION_MAX_LENGTH})`,
      notes: `repeat('x', ${NOTES_MAX_LENGTH})`,
    });

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it("rechaza una audiencia que no es todo el club ni grupos", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertEvent(database, {
      authorId,
      audience: "'club'",
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/events_audience_check/);
  });

  it("rechaza un estado que no es scheduled ni cancelled", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertEvent(database, {
      authorId,
      status: "'postponed'",
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/events_status_check/);
  });

  it("nace programado, sin fecha de cancelación y con fecha de creación", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const clubId = await seededClubId(database);

    const eventId = await database.query(
      `insert into public.events
         (club_id, title, event_type, starts_on, start_time, location,
          audience, author_id)
       values ('${clubId}', 'Entrenamiento', 'training', '2026-05-12',
               '19:00', 'MSAC', 'all', '${authorId}')
       returning id`,
    );

    expect(
      await database.query(
        `select status || ' ' || (cancelled_at is null) || ' ' || (created_at is not null)
           from public.events where id = '${eventId}'`,
      ),
    ).toBe("scheduled true true");
  });

  it.each([
    ["cancelado sin fecha de cancelación", "'cancelled'", "null"],
    ["programado con fecha de cancelación", "'scheduled'", "now()"],
  ])("rechaza un evento %s", async (_caso, status, cancelledAt) => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertEvent(database, {
      authorId,
      status,
      cancelledAt,
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/events_cancelled_at_matches_status/);
  });

  it("acepta un evento cancelado con su fecha de cancelación", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertEvent(database, {
      authorId,
      status: "'cancelled'",
      cancelledAt: "now()",
    });

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it("rechaza un autor de otro club", async () => {
    const database = await migratedDatabase();
    const otherClubId = await seedOtherClub(database);
    const authorId = await seedMember(database, { clubId: otherClubId });

    const insercion = await insertEvent(database, { authorId });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/events_author_same_club_fkey/);
  });

  it("acepta una ocurrencia de una serie de su club", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const seriesId = await seedSeries(database, { authorId });

    const insercion = await insertEvent(database, {
      authorId,
      seriesId: `'${seriesId}'`,
    });

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it("rechaza una ocurrencia de una serie de otro club", async () => {
    const database = await migratedDatabase();
    const otherClubId = await seedOtherClub(database);
    const otherAuthorId = await seedMember(database, { clubId: otherClubId });
    const seriesId = await seedSeries(database, {
      authorId: otherAuthorId,
      clubId: otherClubId,
    });
    const authorId = await seedMember(database);

    const insercion = await insertEvent(database, {
      authorId,
      seriesId: `'${seriesId}'`,
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/events_series_same_club_fkey/);
  });
});

describeConPostgres("esquema de eventos: las series", () => {
  it.each([
    ["un día", "'{3}'"],
    ["los siete días", "'{1,2,3,4,5,6,7}'"],
  ])("acepta %s de la semana", async (_caso, weekdays) => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertSeries(database, { authorId, weekdays });

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it.each([
    ["sin ningún día", "'{}'"],
    ["con un día repetido", "'{2,2}'"],
    ["con un día 0", "'{0,2}'"],
    ["con un día 8", "'{2,8}'"],
    ["con un día nulo", "'{2,null}'"],
  ])("rechaza una serie %s", async (_caso, weekdays) => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertSeries(database, { authorId, weekdays });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/event_series_weekdays_check/);
  });

  it("rechaza una serie que termina antes de empezar", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertSeries(database, {
      authorId,
      startsOn: "'2026-03-10'",
      endsOn: "'2026-03-09'",
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/event_series_date_range/);
  });

  it("rechaza una serie de más de un año", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertSeries(database, {
      authorId,
      startsOn: "'2026-03-10'",
      endsOn: "'2027-03-11'",
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/event_series_date_range/);
  });

  it.each([
    ["de un solo día", "'2026-03-10'"],
    ["de justo un año", "'2027-03-10'"],
  ])("acepta una serie %s", async (_caso, endsOn) => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertSeries(database, {
      authorId,
      startsOn: "'2026-03-10'",
      endsOn,
    });

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it("rechaza en una serie los mismos valores que en un evento", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const clubId = await seededClubId(database);

    const insercion = await database.attempt(
      `insert into public.event_series
         (club_id, title, event_type, start_time, location, audience,
          weekdays, starts_on, ends_on, author_id)
       values ('${clubId}', 'Entrenamiento', 'party', '19:00', 'MSAC', 'all',
               '{2}', '2026-03-01', '2026-06-30', '${authorId}')`,
    );

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/event_series_event_type_check/);
  });
});

describeConPostgres("esquema de eventos: la audiencia de grupos", () => {
  it("acepta un grupo del club del evento", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const groupId = await seedGroup(database, "Senior Squad");
    const eventId = await seedEvent(database, {
      authorId,
      audience: "'groups'",
    });

    const insercion = await targetGroup(database, eventId, groupId);

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it("rechaza un grupo de otro club en un evento", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const otherGroupId = await seedGroup(
      database,
      "Senior Squad",
      await seedOtherClub(database),
    );
    const eventId = await seedEvent(database, {
      authorId,
      audience: "'groups'",
    });

    // La fila dice ser del club del evento: la clave compuesta contra el grupo
    // es la que la rechaza.
    const insercion = await targetGroup(database, eventId, otherGroupId);

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/event_groups_group_same_club_fkey/);
  });

  it("rechaza un grupo de otro club en una serie", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const otherGroupId = await seedGroup(
      database,
      "Senior Squad",
      await seedOtherClub(database),
    );
    const seriesId = await seedSeries(database, { authorId });

    const insercion = await targetSeriesGroup(database, seriesId, otherGroupId);

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(
      /event_series_groups_group_same_club_fkey/,
    );
  });

  it("rechaza el mismo grupo dos veces en el mismo evento", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const groupId = await seedGroup(database, "Senior Squad");
    const eventId = await seedEvent(database, {
      authorId,
      audience: "'groups'",
    });
    await targetGroup(database, eventId, groupId);

    const repetida = await targetGroup(database, eventId, groupId);

    expect(repetida.code).toBeGreaterThan(0);
    expect(repetida.stderr).toMatch(/event_groups_pkey/);
  });

  it("borrar un grupo quita su fila de audiencia y conserva el evento y la serie", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const groupId = await seedGroup(database, "Senior Squad");
    const seriesId = await seedSeries(database, { authorId });
    const eventId = await seedEvent(database, {
      authorId,
      audience: "'groups'",
      seriesId: `'${seriesId}'`,
    });
    await targetGroup(database, eventId, groupId);
    await targetSeriesGroup(database, seriesId, groupId);

    await database.query(`delete from public.groups where id = '${groupId}'`);

    expect(await count(database, "event_groups")).toBe("0");
    expect(await count(database, "event_series_groups")).toBe("0");
    expect(await count(database, "events")).toBe("1");
    expect(await count(database, "event_series")).toBe("1");
  });
});

describeConPostgres("momento de inicio", () => {
  // Melbourne sale del horario de verano el 5 de abril de 2026 (de +11 a +10)
  // y entra el 4 de octubre (de +10 a +11).
  it.each([
    [
      "el día antes del cambio de abril",
      "2026-04-04",
      "2026-04-04 08:00:00+00",
    ],
    ["el día del cambio de abril", "2026-04-05", "2026-04-05 09:00:00+00"],
    [
      "el día antes del cambio de octubre",
      "2026-10-03",
      "2026-10-03 09:00:00+00",
    ],
    ["el día del cambio de octubre", "2026-10-04", "2026-10-04 08:00:00+00"],
  ])(
    "las 19:00 de %s son las 19:00 de Melbourne",
    async (_caso, startsOn, expectedUtc) => {
      const database = await migratedDatabase();
      const authorId = await seedMember(database);
      const eventId = await seedEvent(database, {
        authorId,
        startsOn: `'${startsOn}'`,
        startTime: "'19:00'",
      });

      const inicio = await database.query(
        `select (starts_at at time zone 'UTC')::text || '+00' || ' ' ||
                (starts_at at time zone 'Australia/Melbourne')::time
           from public.events where id = '${eventId}'`,
      );

      expect(inicio).toBe(`${expectedUtc} 19:00:00`);
    },
  );

  it("sigue a la fecha y la hora cuando cambian", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const eventId = await seedEvent(database, { authorId });

    await database.query(
      `update public.events set starts_on = '2026-07-01', start_time = '06:30'
        where id = '${eventId}'`,
    );

    expect(
      await database.query(
        `select (starts_at at time zone 'UTC')::text
           from public.events where id = '${eventId}'`,
      ),
    ).toBe("2026-06-30 20:30:00");
  });
});

describeConPostgres("quién ve qué evento", () => {
  it("un miembro del club ve un evento dirigido a todo el club", async () => {
    const database = await migratedDatabase();
    const memberId = await seedMember(database);
    await seedEvent(database, { authorId: memberId, title: "'Al club'" });

    expect(await visibleTitles(database, memberId)).toEqual(["Al club"]);
  });

  it("un miembro de Senior Squad ve los del club y los de Senior Squad, y no los de otros grupos (AC-050)", async () => {
    const database = await migratedDatabase();
    const memberId = await seedMember(database);
    const senior = await seedGroup(database, "Senior Squad");
    const junior = await seedGroup(database, "Junior Squad");
    await addToGroup(database, senior, memberId);
    await seedEvent(database, { authorId: memberId, title: "'Al club'" });
    const alSenior = await seedEvent(database, {
      authorId: memberId,
      title: "'Al Senior'",
      audience: "'groups'",
    });
    await targetGroup(database, alSenior, senior);
    const alJunior = await seedEvent(database, {
      authorId: memberId,
      title: "'Al Junior'",
      audience: "'groups'",
    });
    await targetGroup(database, alJunior, junior);

    expect(await visibleTitles(database, memberId)).toEqual([
      "Al Senior",
      "Al club",
    ]);
  });

  it("un miembro ve un evento dirigido a varios grupos si está en uno", async () => {
    const database = await migratedDatabase();
    const memberId = await seedMember(database);
    const senior = await seedGroup(database, "Senior Squad");
    const junior = await seedGroup(database, "Junior Squad");
    await addToGroup(database, junior, memberId);
    const aLosDos = await seedEvent(database, {
      authorId: memberId,
      title: "'A los dos'",
      audience: "'groups'",
    });
    await targetGroup(database, aLosDos, senior);
    await targetGroup(database, aLosDos, junior);

    expect(await visibleTitles(database, memberId)).toEqual(["A los dos"]);
  });

  it("un evento dirigido a cero grupos no lo ve nadie", async () => {
    const database = await migratedDatabase();
    const memberId = await seedMember(database);
    await seedEvent(database, { authorId: memberId, audience: "'groups'" });

    expect(await visibleTitles(database, memberId)).toEqual([]);
  });

  it("un evento cancelado lo sigue viendo su audiencia", async () => {
    const database = await migratedDatabase();
    const memberId = await seedMember(database);
    await seedEvent(database, {
      authorId: memberId,
      title: "'Cancelado'",
      status: "'cancelled'",
      cancelledAt: "now()",
    });

    expect(await visibleTitles(database, memberId)).toEqual(["Cancelado"]);
  });

  it("un evento de otro club no lo ve un miembro de este", async () => {
    const database = await migratedDatabase();
    const otherClubId = await seedOtherClub(database);
    const otherAuthorId = await seedMember(database, { clubId: otherClubId });
    await seedEvent(database, { authorId: otherAuthorId, clubId: otherClubId });
    const memberId = await seedMember(database);

    expect(await visibleTitles(database, memberId)).toEqual([]);
  });

  it("un miembro inactive no ve ni los del club ni los de su grupo", async () => {
    const database = await migratedDatabase();
    const memberId = await seedMember(database, { accountStatus: "inactive" });
    const senior = await seedGroup(database, "Senior Squad");
    await addToGroup(database, senior, memberId);
    await seedEvent(database, { authorId: memberId, title: "'Al club'" });
    const alSenior = await seedEvent(database, {
      authorId: memberId,
      audience: "'groups'",
    });
    await targetGroup(database, alSenior, senior);

    expect(await visibleTitles(database, memberId)).toEqual([]);
  });

  it("una identidad sin socio no ve nada", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    await seedEvent(database, { authorId });
    const strangerId = await database.query(
      "insert into auth.users (id) values (gen_random_uuid()) returning id",
    );

    expect(await visibleTitles(database, strangerId)).toEqual([]);
  });

  it("un miembro ve las series de su audiencia y no las de otros grupos", async () => {
    const database = await migratedDatabase();
    const memberId = await seedMember(database);
    const senior = await seedGroup(database, "Senior Squad");
    const junior = await seedGroup(database, "Junior Squad");
    await addToGroup(database, senior, memberId);
    await seedSeries(database, { authorId: memberId });
    const deOtros = await seedSeries(database, { authorId: memberId });
    await database.query(
      `update public.event_series set audience = 'groups', title = 'Al Junior'
        where id = '${deOtros}'`,
    );
    await targetSeriesGroup(database, deOtros, junior);

    expect(
      await readAs(database, memberId, "select title from public.event_series"),
    ).toEqual(["Entrenamiento"]);
  });

  it("un miembro ve la fila de audiencia de su grupo y no la de otros", async () => {
    const database = await migratedDatabase();
    const memberId = await seedMember(database);
    const senior = await seedGroup(database, "Senior Squad");
    const junior = await seedGroup(database, "Junior Squad");
    await addToGroup(database, senior, memberId);
    const eventId = await seedEvent(database, {
      authorId: memberId,
      audience: "'groups'",
    });
    await targetGroup(database, eventId, senior);
    await targetGroup(database, eventId, junior);

    expect(
      await readAs(
        database,
        memberId,
        "select group_id from public.event_groups",
      ),
    ).toEqual([senior]);
  });
});

const EVENT_TABLES = [
  "events",
  "event_groups",
  "event_series",
  "event_series_groups",
] as const;

describeConPostgres("privilegios de los eventos", () => {
  it.each(EVENT_TABLES)(
    "un miembro no puede insertar, cambiar ni borrar en %s",
    async (table) => {
      const database = await migratedDatabase();
      const memberId = await seedMember(database);

      for (const sql of [
        `insert into public.${table} default values`,
        `update public.${table} set club_id = club_id`,
        `delete from public.${table}`,
      ]) {
        const intento = await database.attempt(
          asApiIdentity({ role: "authenticated", subject: memberId }, sql),
        );
        expect(intento.code, sql).toBeGreaterThan(0);
        expect(intento.stderr).toMatch(/permission denied/);
      }
    },
  );

  it.each(EVENT_TABLES)("un cliente anónimo no lee %s", async (table) => {
    const database = await migratedDatabase();

    const lectura = await database.attempt(
      asApiIdentity({ role: "anon" }, `select * from public.${table}`),
    );

    expect(lectura.code).toBeGreaterThan(0);
    expect(lectura.stderr).toMatch(/permission denied/);
  });

  it.each(EVENT_TABLES)(
    "deja a anon sin privilegios y a authenticated sólo con la lectura de %s",
    async (table) => {
      const database = await migratedDatabase();

      const privilegios = await database.query(
        `select grantee || ' ' || string_agg(privilege_type, ',' order by privilege_type)
           from information_schema.role_table_grants
          where table_schema = 'public' and table_name = '${table}'
            and grantee in ('anon', 'authenticated')
          group by grantee order by grantee`,
      );

      expect(privilegios).toBe("authenticated SELECT");
    },
  );

  it("el servidor crea eventos con la llave de servicio", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const clubId = await seededClubId(database);

    const insercion = await database.attempt(
      `set role service_role; ${insertEventSql({ authorId }, clubId)}`,
    );

    expect(insercion.code, insercion.stderr).toBe(0);
  });
});
