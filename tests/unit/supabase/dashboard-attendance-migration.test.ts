import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0076_dashboard_attendance.sql` contra un Postgres desechable (#746, RF-2,
 * D9 y D13 del PRD de E27). "Mi asistencia" del inicio lee las sesiones
 * elegibles de un socio con la regla de `attendance_stats` (`0045`), y la
 * columna de gestión cuenta quién de la audiencia del próximo evento no ha
 * respondido.
 */

const SEEDED_CLUB = "victoria-seadragons";
const JOINED_ON = "2027-01-01";
const RECENT_SESSIONS = 10;

type Member = { readonly clubId: string; readonly userId: string };

type Status = "present" | "late" | "absent";

type EventOptions = {
  readonly startsOn?: string;
  readonly groupId?: string;
};

type SessionWindow = { readonly since: string; readonly until: string };

function seededClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
}

function seedOtherClub(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `insert into public.clubs (name, slug)
     values ('Otro club', 'otro-club-' || gen_random_uuid())
     returning id`,
  );
}

async function seedMember(
  database: TemporaryDatabase,
  clubId: string,
  options: { readonly joinedOn?: string; readonly status?: string } = {},
): Promise<Member> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status, joined_on)
     values ('${clubId}', '${userId}', 'Pablo Player',
             '${userId}@example.test', '${options.status ?? "active"}',
             '${options.joinedOn ?? JOINED_ON}')`,
  );
  return { clubId, userId };
}

async function seedEvent(
  database: TemporaryDatabase,
  author: Member,
  options: EventOptions = {},
): Promise<string> {
  const audience = options.groupId === undefined ? "all" : "groups";
  const eventId = await database.query(
    `insert into public.events
       (club_id, title, event_type, starts_on, start_time, location,
        audience, author_id)
     values ('${author.clubId}', 'Training',
             'training',
             '${options.startsOn ?? "2027-06-01"}', '19:00', 'MSAC',
             '${audience}', '${author.userId}')
     returning id`,
  );
  if (options.groupId !== undefined) {
    await database.query(
      `insert into public.event_groups (event_id, group_id, club_id)
       values ('${eventId}', '${options.groupId}', '${author.clubId}')`,
    );
  }
  return eventId;
}

function record(
  database: TemporaryDatabase,
  eventId: string,
  member: Member,
  status: Status,
): Promise<string> {
  return database.query(
    `insert into public.attendance_records
       (event_id, user_id, club_id, status)
     values ('${eventId}', '${member.userId}', '${member.clubId}',
             '${status}')`,
  );
}

function reply(
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

async function seedGroup(
  database: TemporaryDatabase,
  clubId: string,
  members: readonly Member[] = [],
): Promise<string> {
  const groupId = await database.query(
    `insert into public.groups (club_id, name)
     values ('${clubId}', 'Senior Squad') returning id`,
  );
  for (const member of members) {
    await database.query(
      `insert into public.group_memberships (group_id, user_id, club_id)
       values ('${groupId}', '${member.userId}', '${member.clubId}')`,
    );
  }
  return groupId;
}

/** Un entrenamiento con hoja guardada: el Coach también tiene su fila, así la
 * hoja existe aunque el socio no esté en ella. */
async function trainingWithSheet(
  database: TemporaryDatabase,
  coach: Member,
  options: EventOptions = {},
): Promise<string> {
  const eventId = await seedEvent(database, coach, options);
  await record(database, eventId, coach, "present");
  return eventId;
}

/** Una línea por sesión, de la más vieja a la más nueva: `día estado`. */
function sessions(
  database: TemporaryDatabase,
  member: Member,
  { since, until }: SessionWindow,
  clubId = member.clubId,
): Promise<string> {
  return database.query(
    `select coalesce(string_agg(s.starts_on || ' ' || s.status, ','
                                order by s.ordinal), '')
       from public.member_attendance_sessions(
              '${clubId}', '${member.userId}', '${since}', '${until}',
              ${RECENT_SESSIONS}
            ) with ordinality as s (event_id, starts_on, status, ordinal)`,
  );
}

function unanswered(
  database: TemporaryDatabase,
  clubId: string,
  eventId: string,
): Promise<string> {
  return database.query(
    `select public.event_unanswered_count('${clubId}', '${eventId}')`,
  );
}

function dayOfJune(day: number): string {
  return `2027-06-${String(day).padStart(2, "0")}`;
}

async function seededCoachAndPlayer(
  database: TemporaryDatabase,
  playerJoinedOn = JOINED_ON,
): Promise<{ readonly coach: Member; readonly player: Member }> {
  const clubId = await seededClubId(database);
  return {
    coach: await seedMember(database, clubId),
    player: await seedMember(database, clubId, { joinedOn: playerJoinedOn }),
  };
}

const JUNE: SessionWindow = { since: "2027-06-01", until: "2027-06-30" };

describeConPostgres("las sesiones de un socio para el inicio", () => {
  it("trae las de la temporada con su estado, de la más vieja a la más nueva", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    const statuses: readonly Status[] = ["present", "late", "absent"];
    for (const [index, status] of statuses.entries()) {
      const eventId = await trainingWithSheet(database, coach, {
        startsOn: dayOfJune(index + 1),
      });
      await record(database, eventId, player, status);
    }

    await expect(sessions(database, player, JUNE)).resolves.toBe(
      "2027-06-01 present,2027-06-02 late,2027-06-03 absent",
    );
  });

  it("da ausente una sesión con hoja en la que el socio no tiene fila", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    await trainingWithSheet(database, coach, { startsOn: dayOfJune(5) });

    await expect(sessions(database, player, JUNE)).resolves.toBe(
      "2027-06-05 absent",
    );
  });

  it("añade las anteriores a la temporada hasta completar las 10 más recientes", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    for (let day = 1; day <= 12; day += 1) {
      const eventId = await trainingWithSheet(database, coach, {
        startsOn: `2027-05-${String(day).padStart(2, "0")}`,
      });
      await record(database, eventId, player, "present");
    }
    const june = await trainingWithSheet(database, coach, {
      startsOn: dayOfJune(2),
    });
    await record(database, june, player, "late");

    const lines = (await sessions(database, player, JUNE)).split(",");

    expect(lines).toHaveLength(RECENT_SESSIONS);
    expect(lines[0]).toBe("2027-05-04 present");
    expect(lines.at(-1)).toBe("2027-06-02 late");
  });

  it("trae todas las de la temporada aunque pasen de 10", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    for (let day = 1; day <= 12; day += 1) {
      await trainingWithSheet(database, coach, { startsOn: dayOfJune(day) });
    }

    const lines = (await sessions(database, player, JUNE)).split(",");

    expect(lines).toHaveLength(12);
  });

  it("no trae las de después de hoy aunque tengan hoja", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    await trainingWithSheet(database, coach, { startsOn: dayOfJune(10) });
    await trainingWithSheet(database, coach, { startsOn: dayOfJune(11) });

    await expect(
      sessions(database, player, { since: "2027-06-01", until: dayOfJune(10) }),
    ).resolves.toBe("2027-06-10 absent");
  });

  it("sólo cuenta desde el alta de quien se unió a mitad de temporada", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(
      database,
      dayOfJune(15),
    );
    await trainingWithSheet(database, coach, { startsOn: dayOfJune(14) });
    await trainingWithSheet(database, coach, { startsOn: dayOfJune(15) });

    await expect(sessions(database, player, JUNE)).resolves.toBe(
      "2027-06-15 absent",
    );
  });

  // Otro tipo de evento no puede tener hoja: lo impide
  // `attendance_records_training_fkey` (`0043`).
  it("no trae sesiones sin hoja, canceladas ni de un grupo ajeno", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    await seedEvent(database, coach, { startsOn: dayOfJune(1) });
    const cancelled = await trainingWithSheet(database, coach, {
      startsOn: dayOfJune(2),
    });
    await database.query(
      `update public.events set status = 'cancelled', cancelled_at = now()
        where id = '${cancelled}'`,
    );
    const groupId = await seedGroup(database, coach.clubId);
    await trainingWithSheet(database, coach, {
      startsOn: dayOfJune(4),
      groupId,
    });

    await expect(sessions(database, player, JUNE)).resolves.toBe("");
  });

  it("trae la sesión de un grupo en el que está", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    const groupId = await seedGroup(database, coach.clubId, [player]);
    await trainingWithSheet(database, coach, {
      startsOn: dayOfJune(4),
      groupId,
    });

    await expect(sessions(database, player, JUNE)).resolves.toBe(
      "2027-06-04 absent",
    );
  });

  it("no devuelve nada pedido con otro club", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    await trainingWithSheet(database, coach, { startsOn: dayOfJune(4) });
    const otherClub = await seedOtherClub(database);

    await expect(sessions(database, player, JUNE, otherClub)).resolves.toBe("");
  });
});

describeConPostgres("quién no ha respondido en la base", () => {
  it("cuenta a los socios activos de la audiencia sin respuesta", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    await seedMember(database, coach.clubId);
    await seedMember(database, coach.clubId, { status: "inactive" });
    await seedMember(database, coach.clubId, { status: "incomplete" });
    const eventId = await seedEvent(database, coach);
    await reply(database, eventId, player, "no");
    await reply(database, eventId, coach, "maybe");

    await expect(unanswered(database, coach.clubId, eventId)).resolves.toBe(
      "1",
    );
  });

  it("sólo cuenta a los de los grupos del evento", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    await seedMember(database, coach.clubId);
    const groupId = await seedGroup(database, coach.clubId, [player, coach]);
    const eventId = await seedEvent(database, coach, { groupId });

    await expect(unanswered(database, coach.clubId, eventId)).resolves.toBe(
      "2",
    );
  });

  it("da cero con todos respondidos", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    const eventId = await seedEvent(database, coach);
    await reply(database, eventId, player, "yes");
    await reply(database, eventId, coach, "yes");

    await expect(unanswered(database, coach.clubId, eventId)).resolves.toBe(
      "0",
    );
  });

  it("no cuenta nada de un evento pedido con otro club", async () => {
    const database = await migratedDatabase();
    const { coach } = await seededCoachAndPlayer(database);
    const eventId = await seedEvent(database, coach);
    const otherClub = await seedOtherClub(database);
    await seedMember(database, otherClub);

    await expect(unanswered(database, otherClub, eventId)).resolves.toBe("0");
  });
});

describeConPostgres("privilegios de las lecturas del inicio", () => {
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
          and p.proname in ('member_attendance_sessions',
                            'event_unanswered_count')
          and has_function_privilege(r.rolname, p.oid, 'execute')`,
    );

    expect(ejecutables).toBe(
      "event_unanswered_count service_role,member_attendance_sessions service_role",
    );
  });
});
