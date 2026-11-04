import { expect, it } from "vitest";
import {
  NOTIFICATION_TYPES,
  type NotificationType,
} from "@/lib/notifications/notify-member";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0093_event_video_notice.sql` contra un Postgres desechable (#966, RF-6 y
 * D10 del PRD de E37). `set_event_video` guarda el vídeo de una sesión y
 * dice, en la misma sentencia, si la sesión no tenía: sólo entonces se avisa
 * a la audiencia. Y `notifications.type` admite el aviso nuevo.
 */

const SEEDED_CLUB = "victoria-seadragons";
const VIDEO = "https://youtu.be/abc123";
const OTHER_VIDEO = "https://youtu.be/xyz789";

/** Lo que tarda en soltar la sesión la primera escritura de la carrera: de
 * sobra para que la segunda llegue mientras la fila sigue bloqueada. */
const HOLD_SECONDS = 1.5;
const SECOND_WRITER_DELAY_MS = 300;

type Author = { readonly clubId: string; readonly userId: string };

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
     values ('${clubId}', '${userId}', 'Carla Coach',
             '${userId}@example.test', 'active', 'Coach')`,
  );
  return { clubId, userId };
}

function seedEvent(
  database: TemporaryDatabase,
  author: Author,
): Promise<string> {
  return database.query(
    `insert into public.events
       (club_id, title, event_type, starts_on, start_time, location,
        audience, author_id)
     values ('${author.clubId}', 'Entrenamiento', 'training', '2099-07-07',
             '19:00', 'MSAC', 'all', '${author.userId}')
     returning id`,
  );
}

/** `t` si la sesión no tenía vídeo, `f` si ya tenía. */
function setVideo(
  database: TemporaryDatabase,
  request: { readonly clubId: string; readonly eventId: string },
  url: string,
): Promise<string> {
  return database.query(
    `select public.set_event_video('${request.clubId}', '${request.eventId}', '${url}')`,
  );
}

function videoOf(
  database: TemporaryDatabase,
  eventId: string,
): Promise<string> {
  return database.query(
    `select coalesce(video_url, '-') from public.events where id = '${eventId}'`,
  );
}

/** Pone el vídeo y no suelta la fila hasta pasados `HOLD_SECONDS`. */
function setVideoAndHold(
  database: TemporaryDatabase,
  request: { readonly clubId: string; readonly eventId: string },
  url: string,
): Promise<string> {
  return database.query(
    `select was_empty from (
       select public.set_event_video('${request.clubId}', '${request.eventId}', '${url}') as was_empty,
              pg_sleep(${HOLD_SECONDS})
     ) as held`,
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function insertNotification(
  database: TemporaryDatabase,
  author: Author,
  type: NotificationType,
): Promise<void> {
  await database.query(
    `insert into public.notifications (user_id, club_id, type)
     values ('${author.userId}', '${author.clubId}', '${type}')`,
  );
}

describeConPostgres("el vídeo de una sesión y su aviso en la base", () => {
  it("dice que la sesión no tenía vídeo al ponerle el primero", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const eventId = await seedEvent(database, author);

    const wasEmpty = await setVideo(database, { ...author, eventId }, VIDEO);

    expect(wasEmpty).toBe("t");
    await expect(videoOf(database, eventId)).resolves.toBe(VIDEO);
  });

  it("dice que ya tenía al cambiar el enlace", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const eventId = await seedEvent(database, author);
    await setVideo(database, { ...author, eventId }, VIDEO);

    const wasEmpty = await setVideo(
      database,
      { ...author, eventId },
      OTHER_VIDEO,
    );

    expect(wasEmpty).toBe("f");
    await expect(videoOf(database, eventId)).resolves.toBe(OTHER_VIDEO);
  });

  it("vuelve a decir que no tenía después de quitarlo", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const eventId = await seedEvent(database, author);
    await setVideo(database, { ...author, eventId }, VIDEO);
    await database.query(
      `update public.events set video_url = null where id = '${eventId}'`,
    );

    const wasEmpty = await setVideo(
      database,
      { ...author, eventId },
      OTHER_VIDEO,
    );

    expect(wasEmpty).toBe("t");
  });

  it("no toca un evento de otro club", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const eventId = await seedEvent(database, author);
    const otherClubId = await database.query(
      `insert into public.clubs (name, slug)
       values ('Otro club', 'otro-club-' || gen_random_uuid()) returning id`,
    );

    await setVideo(database, { clubId: otherClubId, eventId }, VIDEO);

    await expect(videoOf(database, eventId)).resolves.toBe("-");
  });

  it("con dos escrituras a la vez sobre una sesión vacía, sólo una dice que estaba vacía", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const eventId = await seedEvent(database, author);
    const request = { ...author, eventId };

    const first = setVideoAndHold(database, request, VIDEO);
    await delay(SECOND_WRITER_DELAY_MS);
    const second = setVideo(database, request, OTHER_VIDEO);

    const answers = await Promise.all([first, second]);

    // Sin depender de quién tomó la fila primero: como mucho una dice "t".
    expect([...answers].sort()).toEqual(["f", "t"]);
  });

  it("sólo la puede llamar el servidor", async () => {
    const database = await migratedDatabase();

    const grantees = await database.query(
      `select string_agg(rolname, ',' order by rolname) from pg_roles
        where has_function_privilege(rolname,
                'public.set_event_video(uuid, uuid, text)', 'execute')
          and rolname in ('anon', 'authenticated', 'service_role')`,
    );

    expect(grantees).toBe("service_role");
  });

  it("admite el aviso event_video_added y los tipos de antes", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);

    for (const type of NOTIFICATION_TYPES) {
      await insertNotification(database, author, type);
    }

    await expect(
      database.query("select count(*) from public.notifications"),
    ).resolves.toBe(String(NOTIFICATION_TYPES.length));
  });

  it("es idempotente: aplicada dos veces no falla ni cambia nada", async () => {
    const database = await migratedDatabase();
    const firstSnapshot = await database.snapshot();

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(await database.snapshot()).toBe(firstSnapshot);
  });

  it("schema-expected.txt declara lo que la migración deja", async () => {
    const database = await migratedDatabase();

    const check = await database.checkSchema();

    expect(check.code, check.stdout + check.stderr).toBe(0);
  });
});
