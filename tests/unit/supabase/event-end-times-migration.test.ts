import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  databaseBeforeMigration,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0067_event_end_times.sql` contra un Postgres desechable (#642, RF-2 del
 * PRD de E24). Eventos y series guardan su hora de fin, y un evento suelto su
 * fecha de fin; las tres columnas son nulas en lo anterior a E24. Crear,
 * editar un evento y editar una serie las escriben, y las sesiones de una
 * serie heredan la hora de fin de la serie.
 */

const SEEDED_CLUB = "victoria-seadragons";

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
       (club_id, user_id, full_name, email, account_status)
     values ('${clubId}', '${userId}', 'Carla Committee',
             '${userId}@example.test', 'active')`,
  );
  return { clubId, userId };
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
    location: "MSAC",
    notes: null,
    audience: "all",
    group_ids: [],
    series: null,
    ...schedule,
  });
  return JSON.parse(
    await database.query(
      `select public.create_events('${author.clubId}', '${author.userId}', '${json}'::jsonb)`,
    ),
  ) as Saved;
}

function describeEnd(
  database: TemporaryDatabase,
  table: "events" | "event_series",
  id: string,
): Promise<string> {
  const endsOn = table === "events" ? "coalesce(ends_on::text, '-')" : "'-'";
  return database.query(
    `select coalesce(end_time::text, '-') || '|' || ${endsOn}
       from public.${table} where id = '${id}'`,
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
  occurrence_dates: ["2099-07-07", "2099-07-14"],
  series: { weekdays: [2], starts_on: "2099-07-07", ends_on: "2099-07-14" },
};

describeConPostgres("la hora y la fecha de fin de un evento en la base", () => {
  it("deja nulas las columnas nuevas en los eventos y las series que ya existían", async () => {
    const database = await databaseBeforeMigration("0067");
    const author = await seededAuthor(database);
    const single = await createEvents(database, author, {
      occurrence_dates: ["2099-07-10"],
    });
    const weekly = await createEvents(database, author, WEEKLY);

    const applied = await applyRepositoryMigrations(database);

    expect(applied.code, applied.stderr).toBe(0);
    await expect(
      describeEnd(database, "events", firstId(single)),
    ).resolves.toBe("-|-");
    await expect(
      describeEnd(database, "event_series", seriesIdOf(weekly)),
    ).resolves.toBe("-|-");
  });

  it("aplica dos veces sin fallar", async () => {
    const database = await migratedDatabase();

    const again = await applyRepositoryMigrations(database);

    expect(again.code, again.stderr).toBe(0);
  });

  it("guarda la hora y la fecha de fin de un evento suelto de varios días", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);

    const saved = await createEvents(database, author, {
      start_time: "08:30",
      end_time: "17:00",
      ends_on: "2099-07-11",
      occurrence_dates: ["2099-07-10"],
    });

    await expect(describeEnd(database, "events", firstId(saved))).resolves.toBe(
      "17:00:00|2099-07-11",
    );
  });

  it("da a la serie y a cada sesión la hora de fin de la serie, sin fecha de fin", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);

    const saved = await createEvents(database, author, {
      ...WEEKLY,
      end_time: "20:30",
    });

    await expect(
      describeEnd(database, "event_series", seriesIdOf(saved)),
    ).resolves.toBe("20:30:00|-");
    await expect(
      database.query(
        `select string_agg(coalesce(end_time::text, '-') || '|'
                           || coalesce(ends_on::text, '-'), ',')
           from public.events where series_id = '${seriesIdOf(saved)}'`,
      ),
    ).resolves.toBe("20:30:00|-,20:30:00|-");
  });

  it("cambia la hora y la fecha de fin al editar un evento, y las vacía con null", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const eventId = firstId(
      await createEvents(database, author, {
        end_time: "20:00",
        occurrence_dates: ["2099-07-10"],
      }),
    );
    const update = (changes: object): Promise<string> =>
      database.query(
        `select public.update_event('${author.clubId}', '${eventId}', '${JSON.stringify(changes)}'::jsonb)`,
      );

    await update({ end_time: "12:00", ends_on: "2099-07-12" });
    const multiDay = await describeEnd(database, "events", eventId);
    await update({ ends_on: null });

    expect(multiDay).toBe("12:00:00|2099-07-12");
    await expect(describeEnd(database, "events", eventId)).resolves.toBe(
      "12:00:00|-",
    );
  });

  it("deja la hora de fin como estaba al editar otra cosa de un evento", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const eventId = firstId(
      await createEvents(database, author, {
        end_time: "20:00",
        occurrence_dates: ["2099-07-10"],
      }),
    );

    await database.query(
      `select public.update_event('${author.clubId}', '${eventId}', '{"location":"Otra piscina"}'::jsonb)`,
    );

    await expect(describeEnd(database, "events", eventId)).resolves.toBe(
      "20:00:00|-",
    );
  });

  it("pasa la hora de fin nueva de una serie a la serie y a sus sesiones futuras", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const seriesId = seriesIdOf(
      await createEvents(database, author, { ...WEEKLY, end_time: "20:00" }),
    );

    await database.query(
      `select public.update_series('${author.clubId}', '${seriesId}', '{"end_time":"21:00"}'::jsonb)`,
    );

    await expect(describeEnd(database, "event_series", seriesId)).resolves.toBe(
      "21:00:00|-",
    );
    await expect(
      database.query(
        `select string_agg(end_time::text, ',')
           from public.events where series_id = '${seriesId}'`,
      ),
    ).resolves.toBe("21:00:00,21:00:00");
  });
});
