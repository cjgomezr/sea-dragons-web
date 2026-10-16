import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  databaseBeforeMigration,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0072_event_covers.sql` contra un Postgres desechable (#644, RF-3 y D7 del
 * PRD de E24). Cada imagen subida es una fila de `event_cover_uploads`, que
 * eventos y series apuntan con `cover_upload_id`. Crear la copia en la serie
 * y en cada sesión; editar la serie la pasa a las sesiones futuras salvo a
 * las que se editaron solas con otra imagen o sin imagen.
 */

const SEEDED_CLUB = "victoria-seadragons";

const NO_COVER = "-";

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

function insertCover(
  database: TemporaryDatabase,
  author: Author,
): Promise<string> {
  return database.query(
    `insert into public.event_cover_uploads (id, club_id, uploaded_by)
     values (gen_random_uuid(), '${author.clubId}', '${author.userId}')
     returning id`,
  );
}

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

function describeCover(
  database: TemporaryDatabase,
  table: "events" | "event_series",
  id: string,
): Promise<string> {
  return database.query(
    `select coalesce(cover_upload_id::text, '-') from public.${table}
      where id = '${id}'`,
  );
}

function describeSessionCovers(
  database: TemporaryDatabase,
  seriesId: string,
): Promise<string> {
  return database.query(
    `select string_agg(coalesce(cover_upload_id::text, '-'), ','
                       order by starts_on)
       from public.events where series_id = '${seriesId}'`,
  );
}

function updateEvent(
  database: TemporaryDatabase,
  author: Author,
  eventId: string,
  changes: object,
): Promise<string> {
  return database.query(
    `select public.update_event('${author.clubId}', '${eventId}', '${JSON.stringify(changes)}'::jsonb)`,
  );
}

function updateSeries(
  database: TemporaryDatabase,
  author: Author,
  seriesId: string,
  changes: object,
): Promise<string> {
  return database.query(
    `select public.update_series('${author.clubId}', '${seriesId}', '${JSON.stringify(changes)}'::jsonb)`,
  );
}

function firstId(saved: Saved): string {
  const [id] = saved.event_ids;
  if (id === undefined) {
    throw new Error("create_events no devolvió ninguna ocurrencia");
  }
  return id;
}

function seriesIdOf(saved: Saved): string {
  if (saved.series_id === null) {
    throw new Error("create_events no devolvió la serie");
  }
  return saved.series_id;
}

const WEEKLY = {
  occurrence_dates: ["2099-07-07", "2099-07-14", "2099-07-21"],
  series: { weekdays: [2], starts_on: "2099-07-07", ends_on: "2099-07-21" },
};

describeConPostgres("la imagen de los eventos en la base", () => {
  it("deja sin imagen los eventos y las series que ya existían", async () => {
    const database = await databaseBeforeMigration("0072");
    const author = await seededAuthor(database);
    const single = await createEvents(database, author, {});
    const weekly = await createEvents(database, author, WEEKLY);

    const applied = await applyRepositoryMigrations(database);

    expect(applied.code, applied.stderr).toBe(0);
    await expect(
      describeCover(database, "events", firstId(single)),
    ).resolves.toBe(NO_COVER);
    await expect(
      describeCover(database, "event_series", seriesIdOf(weekly)),
    ).resolves.toBe(NO_COVER);
  });

  it("aplica dos veces sin fallar", async () => {
    const database = await migratedDatabase();

    const again = await applyRepositoryMigrations(database);

    expect(again.code, again.stderr).toBe(0);
  });

  it("crea el bucket privado event-covers sólo para WebP", async () => {
    const database = await migratedDatabase();

    const bucket = await database.query(
      `select public::text || '|' || array_to_string(allowed_mime_types, ',')
         from storage.buckets where id = 'event-covers'`,
    );

    expect(bucket).toBe("false|image/webp");
  });

  it("no deja a authenticated ni a anon leer las subidas", async () => {
    const database = await migratedDatabase();

    const privileges = await database.query(
      `select count(*) from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name = 'event_cover_uploads'
          and grantee in ('anon', 'authenticated')`,
    );
    const rls = await database.query(
      `select relrowsecurity from pg_class
        where oid = 'public.event_cover_uploads'::regclass`,
    );

    expect(privileges).toBe("0");
    expect(rls).toBe("t");
  });

  it("guarda la imagen de un evento suelto", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const coverId = await insertCover(database, author);

    const saved = await createEvents(database, author, {
      cover_upload_id: coverId,
    });

    await expect(
      describeCover(database, "events", firstId(saved)),
    ).resolves.toBe(coverId);
  });

  it("rechaza una imagen que no está entre las subidas del club", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);

    const attempt = createEvents(database, author, {
      cover_upload_id: "00000000-0000-4000-8000-000000000000",
    });

    await expect(attempt).rejects.toThrow(/events_cover_same_club_fkey/);
  });

  it("da a la serie y a cada sesión la imagen de la serie", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const coverId = await insertCover(database, author);

    const saved = await createEvents(database, author, {
      ...WEEKLY,
      cover_upload_id: coverId,
    });

    await expect(
      describeCover(database, "event_series", seriesIdOf(saved)),
    ).resolves.toBe(coverId);
    await expect(
      describeSessionCovers(database, seriesIdOf(saved)),
    ).resolves.toBe([coverId, coverId, coverId].join(","));
  });

  it("cambia la imagen al editar un evento, la quita con null y no la toca sin la clave", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const coverId = await insertCover(database, author);
    const eventId = firstId(await createEvents(database, author, {}));

    await updateEvent(database, author, eventId, { cover_upload_id: coverId });
    await updateEvent(database, author, eventId, { title: "Partido" });
    const kept = await describeCover(database, "events", eventId);
    await updateEvent(database, author, eventId, { cover_upload_id: null });

    expect(kept).toBe(coverId);
    await expect(describeCover(database, "events", eventId)).resolves.toBe(
      NO_COVER,
    );
  });

  it("pasa la imagen nueva de la serie a sus sesiones salvo a las editadas solas", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const seriesCover = await insertCover(database, author);
    const ownCover = await insertCover(database, author);
    const newCover = await insertCover(database, author);
    const saved = await createEvents(database, author, {
      ...WEEKLY,
      cover_upload_id: seriesCover,
    });
    const [withOwn, withNone] = saved.event_ids;
    await updateEvent(database, author, withOwn ?? "", {
      cover_upload_id: ownCover,
    });
    await updateEvent(database, author, withNone ?? "", {
      cover_upload_id: null,
    });

    await updateSeries(database, author, seriesIdOf(saved), {
      cover_upload_id: newCover,
    });

    await expect(
      describeCover(database, "event_series", seriesIdOf(saved)),
    ).resolves.toBe(newCover);
    await expect(
      describeSessionCovers(database, seriesIdOf(saved)),
    ).resolves.toBe([ownCover, NO_COVER, newCover].join(","));
  });

  it("no separa de la serie una sesión a la que se le manda la misma imagen", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const seriesCover = await insertCover(database, author);
    const newCover = await insertCover(database, author);
    const saved = await createEvents(database, author, {
      ...WEEKLY,
      cover_upload_id: seriesCover,
    });
    await updateEvent(database, author, firstId(saved), {
      cover_upload_id: seriesCover,
    });

    await updateSeries(database, author, seriesIdOf(saved), {
      cover_upload_id: newCover,
    });

    await expect(
      describeSessionCovers(database, seriesIdOf(saved)),
    ).resolves.toBe([newCover, newCover, newCover].join(","));
  });

  it("deja la imagen de la serie y sus sesiones al editar otra cosa", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const coverId = await insertCover(database, author);
    const saved = await createEvents(database, author, {
      ...WEEKLY,
      cover_upload_id: coverId,
    });

    await updateSeries(database, author, seriesIdOf(saved), {
      title: "Partido",
    });

    await expect(
      describeSessionCovers(database, seriesIdOf(saved)),
    ).resolves.toBe([coverId, coverId, coverId].join(","));
  });

  it("no deja borrar una subida que un evento apunta", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const coverId = await insertCover(database, author);
    await createEvents(database, author, { cover_upload_id: coverId });

    const attempt = database.attempt(
      `delete from public.event_cover_uploads where id = '${coverId}'`,
    );

    await expect(attempt).resolves.toMatchObject({
      stderr: expect.stringMatching(/events_cover_same_club_fkey/),
    });
  });

  it("conserva la imagen cuando se borra la ficha de quien la subió", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const uploader = await seededAuthor(database);
    const coverId = await insertCover(database, uploader);
    const eventId = firstId(
      await createEvents(database, author, { cover_upload_id: coverId }),
    );

    const removed = await database.attempt(
      `delete from public.members where user_id = '${uploader.userId}'`,
    );

    expect(removed.code, removed.stderr).toBe(0);
    await expect(describeCover(database, "events", eventId)).resolves.toBe(
      coverId,
    );
  });
});
