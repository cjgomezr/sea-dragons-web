import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0092_event_video.sql` contra un Postgres desechable (#965, RF-4 y D5 del
 * PRD de E37). Cada sesión del calendario lleva su propio enlace de YouTube en
 * `events.video_url`, nulo por defecto y de 1 a 300 caracteres. Editar la
 * sesión o partir su serie no lo toca: el vídeo es de esa sesión.
 */

const SEEDED_CLUB = "victoria-seadragons";

const VIDEO = "https://youtu.be/abc123";

const NO_VIDEO = "-";

type Author = { readonly clubId: string; readonly userId: string };

type Saved = {
  readonly series_id: string | null;
  readonly event_ids: readonly string[];
};

async function seededAuthor(database: TemporaryDatabase): Promise<Author> {
  const clubId = await database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status, role)
     values ('${clubId}', '${userId}', 'Carla Committee',
             '${userId}@example.test', 'active', 'Committee')`,
  );
  return { clubId, userId };
}

/** Una sesión suelta o, con `series`, una serie de los martes desde dentro
 * de una semana: sus sesiones tienen que empezar en el futuro para que
 * partirla las mueva. */
async function createEvents(
  database: TemporaryDatabase,
  author: Author,
  schedule: object,
): Promise<Saved> {
  const json = JSON.stringify({
    title: "Entrenamiento",
    event_type: "training",
    start_time: "19:00",
    end_time: "20:30",
    location: "MSAC",
    notes: null,
    audience: "all",
    group_ids: [],
    series: null,
    occurrence_dates: ["2099-07-10"],
    ...schedule,
  });
  return JSON.parse(
    await database.query(
      `select public.create_events('${author.clubId}', '${author.userId}', '${json}'::jsonb)`,
    ),
  ) as Saved;
}

const WEEKLY = {
  occurrence_dates: ["2099-07-07", "2099-07-14", "2099-07-21"],
  series: { weekdays: [2], starts_on: "2099-07-07", ends_on: "2099-07-21" },
};

function idAt(saved: Saved, index: number): string {
  const id = saved.event_ids[index];
  if (id === undefined) {
    throw new Error(`create_events no devolvió la ocurrencia ${index}`);
  }
  return id;
}

function setVideo(
  database: TemporaryDatabase,
  eventId: string,
  url: string,
): Promise<string> {
  return database.query(
    `update public.events set video_url = '${url}' where id = '${eventId}'`,
  );
}

function videoOf(
  database: TemporaryDatabase,
  eventId: string,
): Promise<string> {
  return database.query(
    `select coalesce(video_url, '${NO_VIDEO}') from public.events
      where id = '${eventId}'`,
  );
}

function sessionVideosOf(
  database: TemporaryDatabase,
  saved: Saved,
): Promise<readonly string[]> {
  return Promise.all(saved.event_ids.map((id) => videoOf(database, id)));
}

describeConPostgres("el vídeo de cada sesión en la base", () => {
  it("nace sin vídeo", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);

    const saved = await createEvents(database, author, {});

    await expect(videoOf(database, idAt(saved, 0))).resolves.toBe(NO_VIDEO);
  });

  it("guarda un enlace de hasta 300 caracteres", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const eventId = idAt(await createEvents(database, author, {}), 0);
    const longest = `https://youtu.be/${"a".repeat(300 - 17)}`;

    await setVideo(database, eventId, longest);

    await expect(videoOf(database, eventId)).resolves.toBe(longest);
  });

  it("rechaza un enlace de más de 300 caracteres", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const eventId = idAt(await createEvents(database, author, {}), 0);

    const writing = await database.attempt(
      `update public.events set video_url = '${"a".repeat(301)}'
        where id = '${eventId}'`,
    );

    expect(writing.stderr).toMatch(/events_video_url_length/);
  });

  it("rechaza un enlace vacío o de sólo espacios", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const eventId = idAt(await createEvents(database, author, {}), 0);

    const writing = await database.attempt(
      `update public.events set video_url = '   ' where id = '${eventId}'`,
    );

    expect(writing.stderr).toMatch(/events_video_url_length/);
  });

  it("conserva el vídeo al cambiar la fecha, el lugar y las notas de la sesión", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const eventId = idAt(await createEvents(database, author, {}), 0);
    await setVideo(database, eventId, VIDEO);

    await database.query(
      `select public.update_event('${author.clubId}', '${eventId}', '${JSON.stringify(
        { starts_on: "2099-07-11", location: "Aquatic", notes: "Piscina 2" },
      )}'::jsonb)`,
    );

    await expect(videoOf(database, eventId)).resolves.toBe(VIDEO);
  });

  it("conserva el vídeo de cada sesión al partir su serie", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const saved = await createEvents(database, author, WEEKLY);
    await setVideo(database, idAt(saved, 1), VIDEO);
    await setVideo(database, idAt(saved, 2), `${VIDEO}-2`);

    await database.query(
      `select public.split_series('${author.clubId}', '${String(saved.series_id)}', '${idAt(saved, 1)}', '${JSON.stringify(
        { location: "Aquatic", notes: "Piscina 2" },
      )}'::jsonb)`,
    );

    await expect(sessionVideosOf(database, saved)).resolves.toEqual([
      NO_VIDEO,
      VIDEO,
      `${VIDEO}-2`,
    ]);
  });

  it("conserva el vídeo de las sesiones que siguen al partir la serie con otros días", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const saved = await createEvents(database, author, WEEKLY);
    await setVideo(database, idAt(saved, 1), VIDEO);
    const schedule = {
      weekdays: [2],
      ends_on: "2099-07-28",
      session_dates: ["2099-07-14", "2099-07-21", "2099-07-28"],
      added_dates: ["2099-07-28"],
    };

    await database.query(
      `select public.split_series('${author.clubId}', '${String(saved.series_id)}', '${idAt(saved, 1)}', '{}'::jsonb, '${JSON.stringify(schedule)}'::jsonb)`,
    );

    await expect(sessionVideosOf(database, saved)).resolves.toEqual([
      NO_VIDEO,
      VIDEO,
      NO_VIDEO,
    ]);
  });
});
