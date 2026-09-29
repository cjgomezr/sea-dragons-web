import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0047_team_split_writes.sql` contra un Postgres desechable (#401, RF-4,
 * RF-5 y RF-7 del PRD de E10). El reparto se guarda entero o nada, vuelve a
 * borrador al guardarse, y publicar devuelve la foto anterior y la nueva.
 */

const SEEDED_CLUB = "victoria-seadragons";
const FUTURE_ON = "2099-01-06";
const PAST_ON = "2020-01-07";

type Member = { readonly clubId: string; readonly userId: string };

type Assignment = { readonly user_id: string; readonly team: string };

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
  fullName = "Pablo",
): Promise<Member> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status)
     values ('${clubId}', '${userId}', '${fullName}',
             '${userId}@example.test', 'active')`,
  );
  return { clubId, userId };
}

function seedEvent(
  database: TemporaryDatabase,
  author: Member,
  change: { readonly eventType?: string; readonly startsOn?: string } = {},
): Promise<string> {
  return database.query(
    `insert into public.events
       (club_id, title, event_type, starts_on, start_time, location,
        audience, author_id)
     values ('${author.clubId}', 'Scrimmage',
             '${change.eventType ?? "training"}',
             '${change.startsOn ?? FUTURE_ON}', '19:00', 'MSAC', 'all',
             '${author.userId}')
     returning id`,
  );
}

function splitPayload(
  assignments: readonly Assignment[],
  mode = "manual",
): string {
  return JSON.stringify({
    mode,
    team_a_name: "Team Kelp",
    team_a_color: "#1C6EA4",
    team_b_name: "Team Tide",
    team_b_color: "#C99A3E",
    assignments,
  });
}

function saveSplit(
  database: TemporaryDatabase,
  request: {
    readonly coach: Member;
    readonly eventId: string;
    readonly assignments: readonly Assignment[];
    readonly mode?: string;
  },
): Promise<string> {
  return database.query(
    `select public.save_team_split(
       '${request.coach.clubId}', '${request.coach.userId}',
       '${request.eventId}',
       '${splitPayload(request.assignments, request.mode)}'::jsonb)`,
  );
}

function publishSplit(
  database: TemporaryDatabase,
  coach: Member,
  eventId: string,
): Promise<string> {
  return database.query(
    `select public.publish_team_split('${coach.clubId}', '${eventId}')
              ->> 'outcome'`,
  );
}

function readAssignments(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `select coalesce(string_agg(m.full_name || ':' || t.team, ','
                                order by m.full_name), '')
       from public.team_split_members t
       join public.members m using (user_id)`,
  );
}

async function seededSquad(database: TemporaryDatabase): Promise<{
  readonly coach: Member;
  readonly ana: Member;
  readonly bruno: Member;
  readonly eventId: string;
}> {
  const clubId = await seededClubId(database);
  const coach = await seedMember(database, clubId, "Carla");
  const ana = await seedMember(database, clubId, "Ana");
  const bruno = await seedMember(database, clubId, "Bruno");
  return { coach, ana, bruno, eventId: await seedEvent(database, coach) };
}

describeConPostgres("guardar y publicar el reparto en la base", () => {
  it("guarda los equipos, el modo y las asignaciones en borrador", async () => {
    const database = await migratedDatabase();
    const { coach, ana, bruno, eventId } = await seededSquad(database);

    const outcome = await saveSplit(database, {
      coach,
      eventId,
      mode: "auto",
      assignments: [
        { user_id: ana.userId, team: "a" },
        { user_id: bruno.userId, team: "b" },
      ],
    });

    expect(outcome).toBe("saved");
    await expect(readAssignments(database)).resolves.toBe("Ana:a,Bruno:b");
    await expect(
      database.query(
        `select team_a_name || '|' || team_b_color || '|' || mode || '|'
                || (published_at is null) || '|' || created_by
           from public.team_splits where event_id = '${eventId}'`,
      ),
    ).resolves.toBe(`Team Kelp|#C99A3E|auto|true|${coach.userId}`);
  });

  it("sustituye el reparto entero y lo devuelve a borrador", async () => {
    const database = await migratedDatabase();
    const { coach, ana, bruno, eventId } = await seededSquad(database);
    await saveSplit(database, {
      coach,
      eventId,
      assignments: [
        { user_id: ana.userId, team: "a" },
        { user_id: bruno.userId, team: "b" },
      ],
    });
    await publishSplit(database, coach, eventId);

    await saveSplit(database, {
      coach,
      eventId,
      assignments: [{ user_id: ana.userId, team: "b" }],
    });

    await expect(readAssignments(database)).resolves.toBe("Ana:b");
    await expect(
      database.query(
        `select count(*) from public.team_splits
          where published_at is null`,
      ),
    ).resolves.toBe("1");
  });

  it("no escribe nada si una asignación falla", async () => {
    const database = await migratedDatabase();
    const { coach, ana, bruno, eventId } = await seededSquad(database);
    await saveSplit(database, {
      coach,
      eventId,
      assignments: [{ user_id: ana.userId, team: "a" }],
    });
    const outsider = await seedMember(
      database,
      await createOtherClub(database),
    );

    const intento = await database.attempt(
      `select public.save_team_split(
         '${coach.clubId}', '${coach.userId}', '${eventId}',
         '${splitPayload([
           { user_id: bruno.userId, team: "b" },
           { user_id: outsider.userId, team: "a" },
         ])}'::jsonb)`,
    );

    expect(intento.code).toBeGreaterThan(0);
    await expect(readAssignments(database)).resolves.toBe("Ana:a");
  });

  it.each([
    ["past", { startsOn: PAST_ON }],
    ["not_buildable", { eventType: "meeting" }],
    ["not_buildable", { eventType: "social" }],
  ] as const)(
    "guardar responde %s y no escribe nada",
    async (expected, change) => {
      const database = await migratedDatabase();
      const { coach, ana } = await seededSquad(database);
      const eventId = await seedEvent(database, coach, change);

      const outcome = await saveSplit(database, {
        coach,
        eventId,
        assignments: [{ user_id: ana.userId, team: "a" }],
      });

      expect(outcome).toBe(expected);
      await expect(readAssignments(database)).resolves.toBe("");
    },
  );

  it("guardar y publicar responden cancelled con un evento cancelado", async () => {
    const database = await migratedDatabase();
    const { coach, ana, eventId } = await seededSquad(database);
    await saveSplit(database, {
      coach,
      eventId,
      assignments: [{ user_id: ana.userId, team: "a" }],
    });
    await database.query(
      `update public.events set status = 'cancelled', cancelled_at = now()
        where id = '${eventId}'`,
    );

    await expect(
      saveSplit(database, { coach, eventId, assignments: [] }),
    ).resolves.toBe("cancelled");
    await expect(publishSplit(database, coach, eventId)).resolves.toBe(
      "cancelled",
    );
    await expect(readAssignments(database)).resolves.toBe("Ana:a");
  });

  it("responde not_found con un evento de otro club", async () => {
    const database = await migratedDatabase();
    const { ana, eventId } = await seededSquad(database);
    const stranger = await seedMember(
      database,
      await createOtherClub(database),
    );

    await expect(
      saveSplit(database, {
        coach: stranger,
        eventId,
        assignments: [{ user_id: ana.userId, team: "a" }],
      }),
    ).resolves.toBe("not_found");
    await expect(publishSplit(database, stranger, eventId)).resolves.toBe(
      "not_found",
    );
  });

  it("publicar sin reparto o con uno vacío responde empty", async () => {
    const database = await migratedDatabase();
    const { coach, eventId } = await seededSquad(database);

    await expect(publishSplit(database, coach, eventId)).resolves.toBe("empty");
    await saveSplit(database, { coach, eventId, assignments: [] });
    await expect(publishSplit(database, coach, eventId)).resolves.toBe("empty");
  });

  it("publicar fija la fecha y devuelve la foto anterior y la nueva", async () => {
    const database = await migratedDatabase();
    const { coach, ana, bruno, eventId } = await seededSquad(database);
    await saveSplit(database, {
      coach,
      eventId,
      assignments: [{ user_id: ana.userId, team: "a" }],
    });
    await publishSplit(database, coach, eventId);
    await saveSplit(database, {
      coach,
      eventId,
      assignments: [{ user_id: bruno.userId, team: "b" }],
    });

    const previous = JSON.stringify([{ user_id: ana.userId, team: "a" }]);
    const current = JSON.stringify([{ user_id: bruno.userId, team: "b" }]);

    const published = await database.query(
      `select (r -> 'previous' = '${previous}'::jsonb) || '|'
              || (r -> 'current' = '${current}'::jsonb) || '|'
              || ((r ->> 'published_at') is not null) || '|'
              || (r ->> 'team_a_name') || '|' || (r ->> 'team_b_color')
         from public.publish_team_split('${coach.clubId}', '${eventId}') r`,
    );

    expect(published).toBe("true|true|true|Team Kelp|#C99A3E");
    await expect(
      database.query(
        `select count(*) from public.team_splits
          where published_at is not null`,
      ),
    ).resolves.toBe("1");
  });

  it.each([
    "public.save_team_split(uuid, uuid, uuid, jsonb)",
    "public.publish_team_split(uuid, uuid)",
  ])("sólo service_role ejecuta %s", async (signature) => {
    const database = await migratedDatabase();

    const grantees = await database.query(
      `select string_agg(r.rolname, ',' order by r.rolname)
         from pg_roles r
        where r.rolname in ('anon', 'authenticated', 'service_role')
          and has_function_privilege(r.rolname, '${signature}', 'execute')`,
    );

    expect(grantees).toBe("service_role");
  });

  it("admite los avisos team_assigned y team_unassigned", async () => {
    const database = await migratedDatabase();
    const { ana } = await seededSquad(database);

    await database.query(
      `insert into public.notifications (user_id, club_id, type)
       values ('${ana.userId}', '${ana.clubId}', 'team_assigned'),
              ('${ana.userId}', '${ana.clubId}', 'team_unassigned')`,
    );

    await expect(
      database.query("select count(*) from public.notifications"),
    ).resolves.toBe("2");
  });
});
