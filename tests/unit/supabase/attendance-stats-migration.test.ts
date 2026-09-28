import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0045_attendance_stats.sql` contra un Postgres desechable (#394, RF-5 y RF-7
 * del PRD de E8). La fórmula de FR-042 la cuenta la base: sólo los
 * entrenamientos no cancelados con hoja guardada, con el miembro en la
 * audiencia y desde su fecha de alta (AC-017, D3). Los de toda una página
 * salen de una sola llamada.
 */

const SEEDED_CLUB = "victoria-seadragons";
const JOINED_ON = "2027-05-01";

type Member = { readonly clubId: string; readonly userId: string };

type Status = "present" | "late" | "absent";

type TrainingOptions = {
  readonly startsOn?: string;
  readonly eventType?: string;
  readonly groupId?: string;
};

function seededClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
}

async function seedMember(
  database: TemporaryDatabase,
  clubId: string,
  joinedOn = JOINED_ON,
): Promise<Member> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status, joined_on)
     values ('${clubId}', '${userId}', 'Pablo Player',
             '${userId}@example.test', 'active', '${joinedOn}')`,
  );
  return { clubId, userId };
}

async function seedEvent(
  database: TemporaryDatabase,
  author: Member,
  options: TrainingOptions = {},
): Promise<string> {
  const audience = options.groupId === undefined ? "all" : "groups";
  const eventId = await database.query(
    `insert into public.events
       (club_id, title, event_type, starts_on, start_time, location,
        audience, author_id)
     values ('${author.clubId}', 'Sesión',
             '${options.eventType ?? "training"}',
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

async function seedGroup(
  database: TemporaryDatabase,
  clubId: string,
): Promise<string> {
  return database.query(
    `insert into public.groups (club_id, name)
     values ('${clubId}', 'Senior Squad') returning id`,
  );
}

/** Una línea por miembro: `eligible attended percent`, con el porcentaje en
 * blanco cuando no hay sesiones elegibles. */
function stats(
  database: TemporaryDatabase,
  clubId: string,
  members: readonly Member[],
): Promise<string> {
  const ids = members.map((member) => `'${member.userId}'`).join(", ");
  return database.query(
    `select coalesce(string_agg(
              s.eligible_sessions || ' ' || s.attended_sessions || ' ' ||
              coalesce(s.attendance_percent::text, '-'),
              ',' order by array_position(array[${ids}]::uuid[], s.user_id)),
            '')
       from public.attendance_stats('${clubId}', array[${ids}]::uuid[]) s`,
  );
}

type RateWindow = { readonly since: string; readonly until: string };

const WHOLE_YEAR: RateWindow = { since: "2027-01-01", until: "2027-12-31" };

function clubRate(
  database: TemporaryDatabase,
  clubId: string,
  { since, until }: RateWindow,
): Promise<string> {
  return database.query(
    `select r.total_records || ' ' || r.attended_records || ' ' ||
            coalesce(r.attendance_percent::text, '-')
       from public.club_attendance_rate('${clubId}', '${since}', '${until}') r`,
  );
}

/** Un entrenamiento con hoja guardada: el Coach también tiene su fila, así la
 * hoja existe aunque el miembro no esté en ella. */
async function trainingWithSheet(
  database: TemporaryDatabase,
  coach: Member,
  options: TrainingOptions = {},
): Promise<string> {
  const eventId = await seedEvent(database, coach, options);
  await record(database, eventId, coach, "present");
  return eventId;
}

async function seededCoachAndPlayer(database: TemporaryDatabase): Promise<{
  readonly coach: Member;
  readonly player: Member;
}> {
  const clubId = await seededClubId(database);
  return {
    coach: await seedMember(database, clubId, "2027-01-01"),
    player: await seedMember(database, clubId),
  };
}

describeConPostgres("el porcentaje de asistencia en la base", () => {
  it("da 90 a quien vino a nueve de diez entrenamientos desde su alta (AC-017)", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    for (let day = 1; day <= 10; day += 1) {
      const eventId = await trainingWithSheet(database, coach, {
        startsOn: `2027-05-${String(day).padStart(2, "0")}`,
      });
      await record(
        database,
        eventId,
        player,
        day <= 5 ? "present" : day < 10 ? "late" : "absent",
      );
    }

    await expect(stats(database, coach.clubId, [player])).resolves.toBe(
      "10 9 90",
    );
  });

  it("no cuenta entrenamientos de antes del alta, fuera de su audiencia ni otros tipos de sesión (AC-017)", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    const counted = await trainingWithSheet(database, coach);
    await record(database, counted, player, "present");
    const april = await trainingWithSheet(database, coach, {
      startsOn: "2027-04-30",
    });
    await record(database, april, player, "absent");
    const groupId = await seedGroup(database, coach.clubId);
    await trainingWithSheet(database, coach, { groupId });
    const meeting = await seedEvent(database, coach, { eventType: "meeting" });
    await database.query(
      `insert into public.event_rsvps (event_id, user_id, club_id, response)
       values ('${meeting}', '${player.userId}', '${player.clubId}', 'no')`,
    );

    await expect(stats(database, coach.clubId, [player])).resolves.toBe(
      "1 1 100",
    );
  });

  it("cuenta el entrenamiento de un grupo en el que está", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    const groupId = await seedGroup(database, coach.clubId);
    await database.query(
      `insert into public.group_memberships (group_id, user_id, club_id)
       values ('${groupId}', '${player.userId}', '${player.clubId}')`,
    );
    await trainingWithSheet(database, coach, { groupId });

    await expect(stats(database, coach.clubId, [player])).resolves.toBe(
      "1 0 0",
    );
  });

  it("no cuenta un entrenamiento del que nadie guardó hoja (D3)", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    await seedEvent(database, coach);
    const saved = await trainingWithSheet(database, coach);
    await record(database, saved, player, "late");

    await expect(stats(database, coach.clubId, [player])).resolves.toBe(
      "1 1 100",
    );
  });

  it("no cuenta un entrenamiento cancelado aunque tenga hoja", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    const cancelled = await trainingWithSheet(database, coach);
    await record(database, cancelled, player, "absent");
    await database.query(
      `update public.events set status = 'cancelled', cancelled_at = now()
        where id = '${cancelled}'`,
    );
    const counted = await trainingWithSheet(database, coach);
    await record(database, counted, player, "present");

    await expect(stats(database, coach.clubId, [player])).resolves.toBe(
      "1 1 100",
    );
  });

  it("no cuenta una fila guardada en una sesión anterior a su alta", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    const before = await trainingWithSheet(database, coach, {
      startsOn: "2027-04-15",
    });
    await record(database, before, player, "present");

    await expect(stats(database, coach.clubId, [player])).resolves.toBe(
      "0 0 -",
    );
  });

  it("devuelve una fila sin porcentaje para quien no tiene sesiones elegibles (AC-017b)", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);

    await expect(stats(database, coach.clubId, [player])).resolves.toBe(
      "0 0 -",
    );
  });

  it.each([
    [1, 8, "13"],
    [3, 8, "38"],
    [1, 2, "50"],
    [2, 3, "67"],
    [1, 3, "33"],
  ])(
    "redondea %i de %i a %s, con la mitad hacia arriba",
    async (attended, eligible, expected) => {
      const database = await migratedDatabase();
      const { coach, player } = await seededCoachAndPlayer(database);
      for (let session = 0; session < eligible; session += 1) {
        const eventId = await trainingWithSheet(database, coach);
        await record(
          database,
          eventId,
          player,
          session < attended ? "present" : "absent",
        );
      }

      await expect(stats(database, coach.clubId, [player])).resolves.toBe(
        `${eligible} ${attended} ${expected}`,
      );
    },
  );

  it("cuenta a varios miembros en una sola llamada y sólo del club pedido", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    const eventId = await trainingWithSheet(database, coach);
    await record(database, eventId, player, "absent");
    const otherClub = await database.query(
      `insert into public.clubs (name, slug)
       values ('Otro club', 'otro-club-' || gen_random_uuid())
       returning id`,
    );

    await expect(stats(database, coach.clubId, [coach, player])).resolves.toBe(
      "1 1 100,1 0 0",
    );
    await expect(stats(database, otherClub, [coach, player])).resolves.toBe("");
  });
});

describeConPostgres("la tasa de asistencia del club en la base", () => {
  it("es present y late sobre todas las filas de los entrenamientos del periodo, con los dos extremos (RF-7)", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    const recent = await trainingWithSheet(database, coach, {
      startsOn: "2027-06-10",
    });
    await record(database, recent, player, "late");
    const other = await trainingWithSheet(database, coach, {
      startsOn: "2027-06-20",
    });
    await record(database, other, player, "absent");
    const before = await trainingWithSheet(database, coach, {
      startsOn: "2027-06-09",
    });
    await record(database, before, player, "absent");
    // Una hoja de un entrenamiento que después se movió a otra fecha.
    const after = await trainingWithSheet(database, coach, {
      startsOn: "2027-06-21",
    });
    await record(database, after, player, "absent");

    await expect(
      clubRate(database, coach.clubId, {
        since: "2027-06-10",
        until: "2027-06-20",
      }),
    ).resolves.toBe("4 3 75");
  });

  it("no cuenta las filas de un entrenamiento cancelado", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndPlayer(database);
    const cancelled = await trainingWithSheet(database, coach);
    await record(database, cancelled, player, "absent");
    await database.query(
      `update public.events set status = 'cancelled', cancelled_at = now()
        where id = '${cancelled}'`,
    );

    await expect(clubRate(database, coach.clubId, WHOLE_YEAR)).resolves.toBe(
      "0 0 -",
    );
  });

  it("no tiene porcentaje sin ninguna hoja en el periodo", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);

    await expect(clubRate(database, clubId, WHOLE_YEAR)).resolves.toBe("0 0 -");
  });
});

describeConPostgres("privilegios de las cuentas de asistencia", () => {
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
          and p.proname in ('attendance_stats', 'club_attendance_rate')
          and has_function_privilege(r.rolname, p.oid, 'execute')`,
    );

    expect(ejecutables).toBe(
      "attendance_stats service_role,club_attendance_rate service_role",
    );
  });
});
