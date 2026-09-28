import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0044_save_attendance_sheet.sql` contra un Postgres desechable (#393, RF-3
 * del PRD de E8). La hoja se guarda entera o nada, y la función vuelve a
 * mirar el evento con su fila bloqueada antes de escribir.
 */

const SEEDED_CLUB = "victoria-seadragons";
const STARTED_ON = "2020-01-07";
const FUTURE_ON = "2099-01-06";

type Member = { readonly clubId: string; readonly userId: string };

type SheetRow = { readonly user_id: string; readonly status: string };

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
): Promise<Member> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status)
     values ('${clubId}', '${userId}', 'Pablo Player',
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
     values ('${author.clubId}', 'Sesión', '${change.eventType ?? "training"}',
             '${change.startsOn ?? STARTED_ON}', '19:00', 'MSAC', 'all',
             '${author.userId}')
     returning id`,
  );
}

function saveSheet(
  database: TemporaryDatabase,
  request: {
    readonly coach: Member;
    readonly eventId: string;
    readonly rows: readonly SheetRow[];
  },
): Promise<string> {
  return database.query(
    `select public.save_attendance_sheet(
       '${request.coach.clubId}', '${request.coach.userId}',
       '${request.eventId}', '${JSON.stringify(request.rows)}'::jsonb)`,
  );
}

function readSheet(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `select coalesce(string_agg(m.full_name || ':' || a.status, ','
                                order by m.full_name), '')
       from public.attendance_records a
       join public.members m using (user_id)`,
  );
}

async function renamed(
  database: TemporaryDatabase,
  member: Member,
  fullName: string,
): Promise<Member> {
  await database.query(
    `update public.members set full_name = '${fullName}'
      where user_id = '${member.userId}'`,
  );
  return member;
}

async function seededSheet(database: TemporaryDatabase): Promise<{
  readonly coach: Member;
  readonly ana: Member;
  readonly bruno: Member;
  readonly eventId: string;
}> {
  const clubId = await seededClubId(database);
  const coach = await renamed(
    database,
    await seedMember(database, clubId),
    "Carla",
  );
  const ana = await renamed(
    database,
    await seedMember(database, clubId),
    "Ana",
  );
  const bruno = await renamed(
    database,
    await seedMember(database, clubId),
    "Bruno",
  );
  return { coach, ana, bruno, eventId: await seedEvent(database, coach) };
}

describeConPostgres("guardar la hoja de asistencia en la base", () => {
  it("guarda cada fila con su estado, quién la guardó y la hora", async () => {
    const database = await migratedDatabase();
    const { coach, ana, bruno, eventId } = await seededSheet(database);

    const outcome = await saveSheet(database, {
      coach,
      eventId,
      rows: [
        { user_id: ana.userId, status: "late" },
        { user_id: bruno.userId, status: "absent" },
      ],
    });

    expect(outcome).toBe("saved");
    await expect(readSheet(database)).resolves.toBe("Ana:late,Bruno:absent");
    await expect(
      database.query(
        `select count(*) from public.attendance_records
          where recorded_by = '${coach.userId}' and recorded_at is not null`,
      ),
    ).resolves.toBe("2");
  });

  it("sustituye la hoja entera: quien no viene en la lista nueva sale", async () => {
    const database = await migratedDatabase();
    const { coach, ana, bruno, eventId } = await seededSheet(database);
    await saveSheet(database, {
      coach,
      eventId,
      rows: [
        { user_id: ana.userId, status: "late" },
        { user_id: bruno.userId, status: "absent" },
      ],
    });

    await saveSheet(database, {
      coach,
      eventId,
      rows: [{ user_id: ana.userId, status: "present" }],
    });

    await expect(readSheet(database)).resolves.toBe("Ana:present");
  });

  it("no toca la hoja de otra sesión", async () => {
    const database = await migratedDatabase();
    const { coach, ana, eventId } = await seededSheet(database);
    const otherEventId = await seedEvent(database, coach);
    await saveSheet(database, {
      coach,
      eventId: otherEventId,
      rows: [{ user_id: ana.userId, status: "absent" }],
    });

    await saveSheet(database, {
      coach,
      eventId,
      rows: [{ user_id: ana.userId, status: "late" }],
    });

    await expect(
      database.query("select count(*) from public.attendance_records"),
    ).resolves.toBe("2");
  });

  it("no escribe nada si una fila falla", async () => {
    const database = await migratedDatabase();
    const { coach, ana, bruno, eventId } = await seededSheet(database);
    await saveSheet(database, {
      coach,
      eventId,
      rows: [{ user_id: ana.userId, status: "late" }],
    });
    const outsider = await seedMember(
      database,
      await createOtherClub(database),
    );

    const intento = await database.attempt(
      `select public.save_attendance_sheet(
         '${coach.clubId}', '${coach.userId}', '${eventId}',
         '${JSON.stringify([
           { user_id: bruno.userId, status: "present" },
           { user_id: outsider.userId, status: "present" },
         ])}'::jsonb)`,
    );

    expect(intento.code).toBeGreaterThan(0);
    await expect(readSheet(database)).resolves.toBe("Ana:late");
  });

  it.each([
    ["not_started", { startsOn: FUTURE_ON }],
    ["not_found", { eventType: "social" }],
  ] as const)("responde %s y no escribe nada", async (expected, change) => {
    const database = await migratedDatabase();
    const { coach, ana } = await seededSheet(database);
    const eventId = await seedEvent(database, coach, change);

    const outcome = await saveSheet(database, {
      coach,
      eventId,
      rows: [{ user_id: ana.userId, status: "present" }],
    });

    expect(outcome).toBe(expected);
    await expect(readSheet(database)).resolves.toBe("");
  });

  it("responde cancelled con un entrenamiento cancelado", async () => {
    const database = await migratedDatabase();
    const { coach, ana, eventId } = await seededSheet(database);
    await database.query(
      `update public.events set status = 'cancelled', cancelled_at = now()
        where id = '${eventId}'`,
    );

    const outcome = await saveSheet(database, {
      coach,
      eventId,
      rows: [{ user_id: ana.userId, status: "present" }],
    });

    expect(outcome).toBe("cancelled");
    await expect(readSheet(database)).resolves.toBe("");
  });

  it("responde not_found con un entrenamiento de otro club", async () => {
    const database = await migratedDatabase();
    const { ana, eventId } = await seededSheet(database);
    const stranger = await seedMember(
      database,
      await createOtherClub(database),
    );

    const outcome = await saveSheet(database, {
      coach: stranger,
      eventId,
      rows: [{ user_id: ana.userId, status: "present" }],
    });

    expect(outcome).toBe("not_found");
  });

  it("sólo service_role ejecuta save_attendance_sheet", async () => {
    const database = await migratedDatabase();

    const grantees = await database.query(
      `select string_agg(r.rolname, ',' order by r.rolname)
         from pg_roles r
        where r.rolname in ('anon', 'authenticated', 'service_role')
          and has_function_privilege(
                r.rolname,
                'public.save_attendance_sheet(uuid, uuid, uuid, jsonb)',
                'execute')`,
    );

    expect(grantees).toBe("service_role");
  });
});
