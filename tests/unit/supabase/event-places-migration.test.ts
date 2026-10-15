import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  databaseBeforeMigration,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0069_event_places.sql` contra un Postgres desechable (#645, RF-4 del PRD
 * de E24). Eventos y series guardan el lugar elegido (nombre, dirección y
 * coordenadas) y "dónde exactamente"; las cinco columnas son nulas en lo
 * anterior a E24 y en lo que sólo trae texto libre. Crear, editar un evento y
 * editar una serie las escriben, y las sesiones de una serie heredan el lugar
 * de la serie.
 */

const SEEDED_CLUB = "victoria-seadragons";

const PLACE_COLUMNS =
  "coalesce(place_name, '-') || '|' || coalesce(place_address, '-') || '|' || coalesce(place_lat::text, '-') || '|' || coalesce(place_lng::text, '-') || '|' || coalesce(place_detail, '-')";

const NO_PLACE = "-|-|-|-|-";

const MSAC = {
  place_name: "MSAC",
  place_address: "Aughtie Dr, Albert Park VIC 3206",
  place_lat: -37.8423,
  place_lng: 144.9601,
  place_detail: "Piscina de buceo",
};

const MSAC_DESCRIBED =
  "MSAC|Aughtie Dr, Albert Park VIC 3206|-37.8423|144.9601|Piscina de buceo";

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

function describePlace(
  database: TemporaryDatabase,
  table: "events" | "event_series",
  id: string,
): Promise<string> {
  return database.query(
    `select ${PLACE_COLUMNS} from public.${table} where id = '${id}'`,
  );
}

function describeSessionPlaces(
  database: TemporaryDatabase,
  seriesId: string,
): Promise<string> {
  return database.query(
    `select string_agg(${PLACE_COLUMNS}, ',' order by starts_on)
       from public.events where series_id = '${seriesId}'`,
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

describeConPostgres("el lugar estructurado de un evento en la base", () => {
  it("deja nulas las columnas nuevas en los eventos y las series que ya existían", async () => {
    const database = await databaseBeforeMigration("0069");
    const author = await seededAuthor(database);
    const single = await createEvents(database, author, {});
    const weekly = await createEvents(database, author, WEEKLY);

    const applied = await applyRepositoryMigrations(database);

    expect(applied.code, applied.stderr).toBe(0);
    await expect(
      describePlace(database, "events", firstId(single)),
    ).resolves.toBe(NO_PLACE);
    await expect(
      describePlace(database, "event_series", seriesIdOf(weekly)),
    ).resolves.toBe(NO_PLACE);
  });

  it("aplica dos veces sin fallar", async () => {
    const database = await migratedDatabase();

    const again = await applyRepositoryMigrations(database);

    expect(again.code, again.stderr).toBe(0);
  });

  it("guarda el lugar y dónde exactamente de un evento suelto", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);

    const saved = await createEvents(database, author, MSAC);

    await expect(
      describePlace(database, "events", firstId(saved)),
    ).resolves.toBe(MSAC_DESCRIBED);
  });

  it("deja el lugar nulo cuando sólo llega el texto libre", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);

    const saved = await createEvents(database, author, {
      location: "Piscina de Box Hill",
    });

    await expect(
      describePlace(database, "events", firstId(saved)),
    ).resolves.toBe(NO_PLACE);
  });

  it("da a la serie y a cada sesión el lugar de la serie", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);

    const saved = await createEvents(database, author, { ...WEEKLY, ...MSAC });

    await expect(
      describePlace(database, "event_series", seriesIdOf(saved)),
    ).resolves.toBe(MSAC_DESCRIBED);
    await expect(
      describeSessionPlaces(database, seriesIdOf(saved)),
    ).resolves.toBe(`${MSAC_DESCRIBED},${MSAC_DESCRIBED}`);
  });

  it("cambia el lugar al editar un evento y lo vacía con null", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const eventId = firstId(await createEvents(database, author, {}));
    const update = (changes: object): Promise<string> =>
      database.query(
        `select public.update_event('${author.clubId}', '${eventId}', '${JSON.stringify(changes)}'::jsonb)`,
      );

    await update(MSAC);
    const withPlace = await describePlace(database, "events", eventId);
    await update({
      place_name: null,
      place_address: null,
      place_lat: null,
      place_lng: null,
      place_detail: null,
    });

    expect(withPlace).toBe(MSAC_DESCRIBED);
    await expect(describePlace(database, "events", eventId)).resolves.toBe(
      NO_PLACE,
    );
  });

  it("deja el lugar como estaba al editar otra cosa de un evento", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const eventId = firstId(await createEvents(database, author, MSAC));

    await database.query(
      `select public.update_event('${author.clubId}', '${eventId}', '{"title":"Partido"}'::jsonb)`,
    );

    await expect(describePlace(database, "events", eventId)).resolves.toBe(
      MSAC_DESCRIBED,
    );
  });

  it("pasa el lugar nuevo de una serie a la serie y a sus sesiones futuras", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const seriesId = seriesIdOf(await createEvents(database, author, WEEKLY));

    await database.query(
      `select public.update_series('${author.clubId}', '${seriesId}', '${JSON.stringify(MSAC)}'::jsonb)`,
    );

    await expect(
      describePlace(database, "event_series", seriesId),
    ).resolves.toBe(MSAC_DESCRIBED);
    await expect(describeSessionPlaces(database, seriesId)).resolves.toBe(
      `${MSAC_DESCRIBED},${MSAC_DESCRIBED}`,
    );
  });

  it.each([
    ["una latitud fuera de rango", { ...MSAC, place_lat: 90.5 }],
    ["una longitud fuera de rango", { ...MSAC, place_lng: -180.5 }],
    ["una latitud sin longitud", { ...MSAC, place_lng: null }],
    ["un nombre de más de 120", { ...MSAC, place_name: "x".repeat(121) }],
    [
      "una dirección de más de 200",
      { ...MSAC, place_address: "x".repeat(201) },
    ],
    ["un detalle de más de 120", { ...MSAC, place_detail: "x".repeat(121) }],
  ])("rechaza %s", async (_case, place) => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);

    const attempt = createEvents(database, author, place);

    await expect(attempt).rejects.toThrow(/violates check constraint/);
  });
});
