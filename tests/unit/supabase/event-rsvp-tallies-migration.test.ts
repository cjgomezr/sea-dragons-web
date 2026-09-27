import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0039_event_rsvp_tallies.sql` contra un Postgres desechable (#309, RF-6 del
 * PRD de E7). Quién cuenta como "va" o "quizás": sólo quien sigue en la
 * audiencia viva del evento y no está dado de baja, y nadie en un evento
 * cancelado. Los conteos de muchos eventos salen de una sola llamada.
 */

const SEEDED_CLUB = "victoria-seadragons";

type Member = { readonly clubId: string; readonly userId: string };

function seededClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
}

async function seedMember(
  database: TemporaryDatabase,
  options: { readonly clubId: string; readonly fullName: string },
): Promise<Member> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status)
     values ('${options.clubId}', '${userId}', '${options.fullName}',
             '${userId}@example.test', 'active')`,
  );
  return { clubId: options.clubId, userId };
}

function seedEvent(
  database: TemporaryDatabase,
  author: Member,
  audience: "all" | "groups",
): Promise<string> {
  return database.query(
    `insert into public.events
       (club_id, title, event_type, starts_on, start_time, location,
        audience, author_id)
     values ('${author.clubId}', 'Entrenamiento', 'training', '2027-07-06',
             '19:00', 'MSAC', '${audience}', '${author.userId}')
     returning id`,
  );
}

async function seedGroupEvent(
  database: TemporaryDatabase,
  author: Member,
): Promise<{ readonly eventId: string; readonly groupId: string }> {
  const groupId = await database.query(
    `insert into public.groups (club_id, name)
     values ('${author.clubId}', 'Senior Squad') returning id`,
  );
  const eventId = await seedEvent(database, author, "groups");
  await database.query(
    `insert into public.event_groups (event_id, group_id, club_id)
     values ('${eventId}', '${groupId}', '${author.clubId}')`,
  );
  return { eventId, groupId };
}

function joinGroup(
  database: TemporaryDatabase,
  member: Member,
  groupId: string,
): Promise<string> {
  return database.query(
    `insert into public.group_memberships (group_id, user_id, club_id)
     values ('${groupId}', '${member.userId}', '${member.clubId}')`,
  );
}

function respond(
  database: TemporaryDatabase,
  eventId: string,
  member: Member,
  response: "yes" | "maybe" | "no",
): Promise<string> {
  return database.query(
    `insert into public.event_rsvps (event_id, user_id, club_id, response)
     values ('${eventId}', '${member.userId}', '${member.clubId}',
             '${response}')`,
  );
}

function tallies(
  database: TemporaryDatabase,
  eventIds: readonly string[],
): Promise<string> {
  const ids = eventIds.map((id) => `'${id}'`).join(", ");
  return database.query(
    `select coalesce(string_agg(
              t.event_id || ' ' || t.going_count || ' ' || t.maybe_count,
              ',' order by t.event_id), '')
       from public.event_rsvp_tallies(array[${ids}]::uuid[]) t`,
  );
}

function responders(
  database: TemporaryDatabase,
  eventId: string,
): Promise<string> {
  return database.query(
    `select coalesce(string_agg(r.full_name || ':' || r.response, ','
                                order by r.full_name), '')
       from public.live_event_rsvps(array['${eventId}']::uuid[]) r`,
  );
}

async function clubWithAuthor(database: TemporaryDatabase): Promise<Member> {
  return seedMember(database, {
    clubId: await seededClubId(database),
    fullName: "Ana Autora",
  });
}

describeConPostgres("conteos de respuestas en la base", () => {
  it("cuenta van y quizás de varios eventos en una sola llamada, sin los no", async () => {
    const database = await migratedDatabase();
    const author = await clubWithAuthor(database);
    const first = await seedEvent(database, author, "all");
    const second = await seedEvent(database, author, "all");
    const bea = await seedMember(database, {
      clubId: author.clubId,
      fullName: "Bea",
    });
    await respond(database, first, author, "yes");
    await respond(database, first, bea, "maybe");
    await respond(database, second, author, "no");
    await respond(database, second, bea, "yes");

    const result = await tallies(database, [first, second]);

    expect(result.split(",").sort()).toEqual(
      [`${first} 1 1`, `${second} 1 0`].sort(),
    );
  });

  it("lista el nombre y la respuesta de quien va o quizás, nunca los no", async () => {
    const database = await migratedDatabase();
    const author = await clubWithAuthor(database);
    const eventId = await seedEvent(database, author, "all");
    const bea = await seedMember(database, {
      clubId: author.clubId,
      fullName: "Bea",
    });
    const carla = await seedMember(database, {
      clubId: author.clubId,
      fullName: "Carla",
    });
    await respond(database, eventId, author, "yes");
    await respond(database, eventId, bea, "maybe");
    await respond(database, eventId, carla, "no");

    await expect(responders(database, eventId)).resolves.toBe(
      "Ana Autora:yes,Bea:maybe",
    );
  });

  it("no cuenta a quien ya no está en ningún grupo de la audiencia", async () => {
    const database = await migratedDatabase();
    const author = await clubWithAuthor(database);
    const { eventId, groupId } = await seedGroupEvent(database, author);
    const inside = await seedMember(database, {
      clubId: author.clubId,
      fullName: "Dentro",
    });
    const left = await seedMember(database, {
      clubId: author.clubId,
      fullName: "Fuera",
    });
    await joinGroup(database, inside, groupId);
    await respond(database, eventId, inside, "yes");
    await respond(database, eventId, left, "yes");

    await expect(tallies(database, [eventId])).resolves.toBe(`${eventId} 1 0`);
    await expect(responders(database, eventId)).resolves.toBe("Dentro:yes");
  });

  it("no cuenta a quien está dado de baja", async () => {
    const database = await migratedDatabase();
    const author = await clubWithAuthor(database);
    const eventId = await seedEvent(database, author, "all");
    const gone = await seedMember(database, {
      clubId: author.clubId,
      fullName: "Baja",
    });
    await respond(database, eventId, author, "maybe");
    await respond(database, eventId, gone, "yes");
    await database.query(
      `update public.members set account_status = 'inactive'
        where user_id = '${gone.userId}'`,
    );

    await expect(tallies(database, [eventId])).resolves.toBe(`${eventId} 0 1`);
    await expect(responders(database, eventId)).resolves.toBe(
      "Ana Autora:maybe",
    );
  });

  it("no cuenta nada de un evento cancelado", async () => {
    const database = await migratedDatabase();
    const author = await clubWithAuthor(database);
    const eventId = await seedEvent(database, author, "all");
    await respond(database, eventId, author, "yes");
    await database.query(
      `update public.events set status = 'cancelled', cancelled_at = now()
        where id = '${eventId}'`,
    );

    await expect(tallies(database, [eventId])).resolves.toBe("");
    await expect(responders(database, eventId)).resolves.toBe("");
  });

  it("sólo las ejecuta el servidor", async () => {
    const database = await migratedDatabase();

    const ejecutables = await database.query(
      `select string_agg(
                p.proname || ' ' || r.rolname,
                ',' order by p.proname, r.rolname)
         from pg_proc p
         cross join (values ('anon'), ('authenticated'), ('service_role'))
           as r (rolname)
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('live_event_rsvps', 'event_rsvp_tallies')
          and has_function_privilege(r.rolname, p.oid, 'execute')`,
    );

    expect(ejecutables).toBe(
      "event_rsvp_tallies service_role,live_event_rsvps service_role",
    );
  });
});
