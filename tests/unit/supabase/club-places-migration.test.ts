import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0071_club_places.sql` contra un Postgres desechable (#646, RF-5 del PRD
 * de E24). Los lugares que el club ya usó salen de sus eventos y sus series
 * con lugar estructurado, contados por eventos, y nunca de otro club.
 */

const SEEDED_CLUB = "victoria-seadragons";

type Author = { readonly clubId: string; readonly userId: string };

type Place = {
  readonly name: string;
  readonly address: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
};

const MSAC: Place = {
  name: "MSAC",
  address: "Aughtie Dr, Albert Park",
  lat: -37.8423,
  lng: 144.9601,
};
const BOX_HILL: Place = {
  name: "Box Hill Aquatic Centre",
  address: null,
  lat: -37.8189,
  lng: 145.1223,
};
const CLUBHOUSE: Place = {
  name: "Clubhouse",
  address: "1 Club St",
  lat: null,
  lng: null,
};

function sqlText(value: string | null): string {
  return value === null ? "null" : `'${value}'`;
}

function sqlNumber(value: number | null): string {
  return value === null ? "null" : String(value);
}

function placeValues(place: Place | null): string {
  if (place === null) {
    return "null, null, null, null";
  }
  return [
    sqlText(place.name),
    sqlText(place.address),
    sqlNumber(place.lat),
    sqlNumber(place.lng),
  ].join(", ");
}

async function seedAuthor(
  database: TemporaryDatabase,
  clubId: string,
): Promise<Author> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status)
     values ('${clubId}', '${userId}', 'Olga', '${userId}@example.test',
             'active')`,
  );
  return { clubId, userId };
}

async function seededAuthor(database: TemporaryDatabase): Promise<Author> {
  const clubId = await database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
  return seedAuthor(database, clubId);
}

async function otherClubAuthor(database: TemporaryDatabase): Promise<Author> {
  const clubId = await database.query(
    `insert into public.clubs (slug, name)
     values ('otro-club', 'Otro club') returning id`,
  );
  return seedAuthor(database, clubId);
}

async function seedEvents(
  database: TemporaryDatabase,
  author: Author,
  place: Place | null,
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await database.query(
      `insert into public.events
         (club_id, title, event_type, starts_on, start_time, location,
          audience, author_id, place_name, place_address, place_lat,
          place_lng)
       values ('${author.clubId}', 'Entrenamiento', 'training', '2027-07-06',
               '19:00', 'Texto libre', 'all', '${author.userId}',
               ${placeValues(place)})`,
    );
  }
}

function seedSeries(
  database: TemporaryDatabase,
  author: Author,
  place: Place,
): Promise<string> {
  return database.query(
    `insert into public.event_series
       (club_id, title, event_type, start_time, location, audience,
        weekdays, starts_on, ends_on, author_id, place_name, place_address,
        place_lat, place_lng)
     values ('${author.clubId}', 'Serie', 'training', '19:00', 'Texto libre',
             'all', array[2]::smallint[], '2027-07-06', '2027-07-20',
             '${author.userId}', ${placeValues(place)})
     returning id`,
  );
}

function clubPlaces(database: TemporaryDatabase, clubId: string) {
  return database.query(
    `select coalesce(string_agg(
              p.place_name || '|' || coalesce(p.place_address, '-') || '|' ||
              coalesce(p.place_lat::text, '-') || '|' ||
              coalesce(p.place_lng::text, '-') || '|' || p.event_count,
              ',' order by p.ordinality), '')
       from public.club_places('${clubId}') with ordinality p`,
  );
}

describeConPostgres("lugares del club en la base", () => {
  it("lista los lugares del club ordenados por número de eventos", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    await seedEvents(database, author, BOX_HILL, 1);
    await seedEvents(database, author, MSAC, 3);
    await seedEvents(database, author, CLUBHOUSE, 2);

    await expect(clubPlaces(database, author.clubId)).resolves.toBe(
      [
        "MSAC|Aughtie Dr, Albert Park|-37.8423|144.9601|3",
        "Clubhouse|1 Club St|-|-|2",
        "Box Hill Aquatic Centre|-|-37.8189|145.1223|1",
      ].join(","),
    );
  });

  it("no cuenta los eventos de texto libre", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    await seedEvents(database, author, null, 4);
    await seedEvents(database, author, MSAC, 1);

    await expect(clubPlaces(database, author.clubId)).resolves.toBe(
      "MSAC|Aughtie Dr, Albert Park|-37.8423|144.9601|1",
    );
  });

  it("incluye el lugar de una serie aunque ningún evento lo tenga", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    await seedEvents(database, author, MSAC, 1);
    await seedSeries(database, author, BOX_HILL);

    await expect(clubPlaces(database, author.clubId)).resolves.toBe(
      [
        "MSAC|Aughtie Dr, Albert Park|-37.8423|144.9601|1",
        "Box Hill Aquatic Centre|-|-37.8189|145.1223|0",
      ].join(","),
    );
  });

  it("no suma la serie a la cuenta de eventos de su lugar", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    await seedSeries(database, author, MSAC);
    await seedEvents(database, author, MSAC, 2);

    await expect(clubPlaces(database, author.clubId)).resolves.toBe(
      "MSAC|Aughtie Dr, Albert Park|-37.8423|144.9601|2",
    );
  });

  it("nunca devuelve los lugares de otro club", async () => {
    const database = await migratedDatabase();
    const author = await seededAuthor(database);
    const stranger = await otherClubAuthor(database);
    await seedEvents(database, author, MSAC, 1);
    await seedEvents(database, stranger, BOX_HILL, 5);
    await seedSeries(database, stranger, CLUBHOUSE);

    await expect(clubPlaces(database, author.clubId)).resolves.toBe(
      "MSAC|Aughtie Dr, Albert Park|-37.8423|144.9601|1",
    );
  });

  it("sólo la ejecuta el servidor", async () => {
    const database = await migratedDatabase();

    const ejecutables = await database.query(
      `select string_agg(r.rolname, ',' order by r.rolname)
         from pg_proc p
         cross join (values ('anon'), ('authenticated'), ('service_role'))
           as r (rolname)
        where p.pronamespace = 'public'::regnamespace
          and p.proname = 'club_places'
          and has_function_privilege(r.rolname, p.oid, 'execute')`,
    );

    expect(ejecutables).toBe("service_role");
  });
});
