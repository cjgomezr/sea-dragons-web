import { describe, expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0043_attendance_records.sql` contra un Postgres desechable (#392, RF-1 del
 * PRD de E8). Lo que la base afirma sola: el estado, una fila por sesión y
 * miembro, que sólo cuelga de entrenamientos del mismo club, las cascadas y
 * que sólo el servidor escribe.
 */

const SEEDED_CLUB = "victoria-seadragons";

type Member = { readonly clubId: string; readonly userId: string };

type AttendanceRow = {
  readonly eventId: string;
  readonly member: Member;
  readonly status: string;
  readonly recordedBy: string;
};

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
  eventType = "training",
): Promise<string> {
  return database.query(
    `insert into public.events
       (club_id, title, event_type, starts_on, start_time, location,
        audience, author_id)
     values ('${author.clubId}', 'Sesión', '${eventType}', '2027-07-06',
             '19:00', 'MSAC', 'all', '${author.userId}')
     returning id`,
  );
}

function upsertSql(row: AttendanceRow): string {
  return `insert into public.attendance_records
            (event_id, user_id, club_id, status, recorded_by, recorded_at)
          values ('${row.eventId}', '${row.member.userId}',
                  '${row.member.clubId}', '${row.status}',
                  '${row.recordedBy}', clock_timestamp())
          on conflict (event_id, user_id)
          do update set status = excluded.status,
                        recorded_by = excluded.recorded_by,
                        recorded_at = excluded.recorded_at`;
}

function countRecords(database: TemporaryDatabase): Promise<string> {
  return database.query("select count(*) from public.attendance_records");
}

async function seededCoachAndTraining(database: TemporaryDatabase): Promise<{
  readonly coach: Member;
  readonly player: Member;
  readonly eventId: string;
}> {
  const clubId = await seededClubId(database);
  const coach = await seedMember(database, clubId);
  const player = await seedMember(database, clubId);
  return { coach, player, eventId: await seedEvent(database, coach) };
}

describeConPostgres("asistencia en la base", () => {
  it("guardar otra vez reescribe la misma fila con su estado, quién y cuándo", async () => {
    const database = await migratedDatabase();
    const { coach, player, eventId } = await seededCoachAndTraining(database);
    const otherCoach = await seedMember(database, coach.clubId);
    await database.query(
      upsertSql({
        eventId,
        member: player,
        status: "present",
        recordedBy: coach.userId,
      }),
    );
    const firstAt = await database.query(
      "select recorded_at from public.attendance_records",
    );

    await database.query(
      upsertSql({
        eventId,
        member: player,
        status: "late",
        recordedBy: otherCoach.userId,
      }),
    );

    await expect(countRecords(database)).resolves.toBe("1");
    await expect(
      database.query(
        `select status || '|' || recorded_by || '|' ||
                (recorded_at > '${firstAt}')
           from public.attendance_records`,
      ),
    ).resolves.toBe(`late|${otherCoach.userId}|true`);
  });

  it.each(["present", "late", "absent"])(
    "acepta el estado %s",
    async (status) => {
      const database = await migratedDatabase();
      const { coach, player, eventId } = await seededCoachAndTraining(database);

      const intento = await database.attempt(
        upsertSql({
          eventId,
          member: player,
          status,
          recordedBy: coach.userId,
        }),
      );

      expect(intento.code, intento.stderr).toBe(0);
    },
  );

  it("rechaza un estado fuera de present, late y absent", async () => {
    const database = await migratedDatabase();
    const { coach, player, eventId } = await seededCoachAndTraining(database);

    const intento = await database.attempt(
      upsertSql({
        eventId,
        member: player,
        status: "excused",
        recordedBy: coach.userId,
      }),
    );

    expect(intento.code).toBeGreaterThan(0);
    expect(intento.stderr).toMatch(/attendance_records_status_check/);
  });

  it.each(["competition", "meeting", "social"])(
    "rechaza asistencia en un evento de tipo %s",
    async (eventType) => {
      const database = await migratedDatabase();
      const { coach, player } = await seededCoachAndTraining(database);
      const eventId = await seedEvent(database, coach, eventType);

      const intento = await database.attempt(
        upsertSql({
          eventId,
          member: player,
          status: "present",
          recordedBy: coach.userId,
        }),
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/attendance_records_training_fkey/);
    },
  );

  it("no deja cambiar de tipo un entrenamiento que ya tiene asistencia", async () => {
    const database = await migratedDatabase();
    const { coach, player, eventId } = await seededCoachAndTraining(database);
    await database.query(
      upsertSql({
        eventId,
        member: player,
        status: "present",
        recordedBy: coach.userId,
      }),
    );

    const intento = await database.attempt(
      `update public.events set event_type = 'meeting' where id = '${eventId}'`,
    );

    expect(intento.code).toBeGreaterThan(0);
    expect(intento.stderr).toMatch(/attendance_records_training_fkey/);
  });

  it("rechaza la asistencia de un miembro a un entrenamiento de otro club", async () => {
    const database = await migratedDatabase();
    const { coach, player } = await seededCoachAndTraining(database);
    const foreignCoach = await seedMember(
      database,
      await createOtherClub(database),
    );
    const foreignEventId = await seedEvent(database, foreignCoach);

    const intento = await database.attempt(
      upsertSql({
        eventId: foreignEventId,
        member: player,
        status: "present",
        recordedBy: coach.userId,
      }),
    );

    expect(intento.code).toBeGreaterThan(0);
    expect(intento.stderr).toMatch(/attendance_records_training_fkey/);
  });

  it("rechaza que la registre alguien de otro club", async () => {
    const database = await migratedDatabase();
    const { player, eventId } = await seededCoachAndTraining(database);
    const foreignCoach = await seedMember(
      database,
      await createOtherClub(database),
    );

    const intento = await database.attempt(
      upsertSql({
        eventId,
        member: player,
        status: "present",
        recordedBy: foreignCoach.userId,
      }),
    );

    expect(intento.code).toBeGreaterThan(0);
    expect(intento.stderr).toMatch(
      /attendance_records_recorder_same_club_fkey/,
    );
  });

  it("borrar la identidad del miembro se lleva sus filas", async () => {
    const database = await migratedDatabase();
    const { coach, player, eventId } = await seededCoachAndTraining(database);
    await database.query(
      upsertSql({
        eventId,
        member: player,
        status: "absent",
        recordedBy: coach.userId,
      }),
    );

    await database.query(
      `delete from auth.users where id = '${player.userId}'`,
    );

    await expect(countRecords(database)).resolves.toBe("0");
  });

  it("borrar el evento se lleva sus filas", async () => {
    const database = await migratedDatabase();
    const { coach, player, eventId } = await seededCoachAndTraining(database);
    await database.query(
      upsertSql({
        eventId,
        member: player,
        status: "present",
        recordedBy: coach.userId,
      }),
    );

    await database.query(`delete from public.events where id = '${eventId}'`);

    await expect(countRecords(database)).resolves.toBe("0");
  });

  it("si quien la registró se va, la fila se queda sin su nombre", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const author = await seedMember(database, clubId);
    const coach = await seedMember(database, clubId);
    const player = await seedMember(database, clubId);
    const eventId = await seedEvent(database, author);
    await database.query(
      upsertSql({
        eventId,
        member: player,
        status: "present",
        recordedBy: coach.userId,
      }),
    );

    await database.query(`delete from auth.users where id = '${coach.userId}'`);

    await expect(
      database.query(
        `select status || '|' || club_id || '|' ||
                coalesce(recorded_by::text, 'null')
           from public.attendance_records`,
      ),
    ).resolves.toBe(`present|${coach.clubId}|null`);
  });

  it("cancelar el evento deja sus filas como estaban", async () => {
    const database = await migratedDatabase();
    const { coach, player, eventId } = await seededCoachAndTraining(database);
    await database.query(
      upsertSql({
        eventId,
        member: player,
        status: "late",
        recordedBy: coach.userId,
      }),
    );
    const before = await database.query(
      "select row_to_json(a)::text from public.attendance_records a",
    );

    await database.query(
      `update public.events set status = 'cancelled', cancelled_at = now()
        where id = '${eventId}'`,
    );

    await expect(
      database.query(
        "select row_to_json(a)::text from public.attendance_records a",
      ),
    ).resolves.toBe(before);
  });

  it("es idempotente: aplicada dos veces no falla ni cambia nada", async () => {
    const database = await migratedDatabase();
    const despuesDeLaPrimera = await database.snapshot();

    const segunda = await applyRepositoryMigrations(database);

    expect(segunda.code, segunda.stderr).toBe(0);
    expect(despuesDeLaPrimera).toMatch(/tabla attendance_records rls=t/);
    expect(await database.snapshot()).toBe(despuesDeLaPrimera);
  });

  describe("privilegios de la asistencia", () => {
    it("deja a anon sin privilegios y a authenticated sólo con la lectura", async () => {
      const database = await migratedDatabase();

      const privilegios = await database.query(
        `select grantee || ' ' || string_agg(privilege_type, ',' order by privilege_type)
           from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'attendance_records'
            and grantee in ('anon', 'authenticated')
          group by grantee order by grantee`,
      );

      expect(privilegios).toBe("authenticated SELECT");
    });

    it("da a service_role la lectura y la escritura", async () => {
      const database = await migratedDatabase();

      const privilegios = await database.query(
        `select string_agg(privilege_type, ',' order by privilege_type)
           from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'attendance_records'
            and grantee = 'service_role'
            and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')`,
      );

      expect(privilegios).toBe("DELETE,INSERT,SELECT,UPDATE");
    });

    it("un miembro lee sólo sus filas y no puede escribir ninguna", async () => {
      const database = await migratedDatabase();
      const { coach, player, eventId } = await seededCoachAndTraining(database);
      await database.query(
        upsertSql({
          eventId,
          member: player,
          status: "late",
          recordedBy: coach.userId,
        }),
      );
      await database.query(
        upsertSql({
          eventId,
          member: coach,
          status: "absent",
          recordedBy: coach.userId,
        }),
      );
      const asPlayer = `set role authenticated;
        set request.jwt.claims = '{"sub":"${player.userId}"}';`;

      const lectura = await database.query(
        `${asPlayer} select status from public.attendance_records`,
      );
      const escrituras = await Promise.all([
        database.attempt(
          `${asPlayer} ${upsertSql({ eventId, member: player, status: "present", recordedBy: player.userId })}`,
        ),
        database.attempt(
          `${asPlayer} update public.attendance_records set status = 'present'`,
        ),
        database.attempt(`${asPlayer} delete from public.attendance_records`),
      ]);

      expect(lectura.split("\n").filter((line) => /^\w+$/.test(line))).toEqual([
        "late",
      ]);
      for (const escritura of escrituras) {
        expect(escritura.code).toBeGreaterThan(0);
        expect(escritura.stderr).toMatch(/permission denied/);
      }
    });

    it("anon no lee ninguna fila", async () => {
      const database = await migratedDatabase();
      const { coach, player, eventId } = await seededCoachAndTraining(database);
      await database.query(
        upsertSql({
          eventId,
          member: player,
          status: "present",
          recordedBy: coach.userId,
        }),
      );

      const lectura = await database.attempt(
        "set role anon; select count(*) from public.attendance_records",
      );

      expect(lectura.code).toBeGreaterThan(0);
      expect(lectura.stderr).toMatch(/permission denied/);
    });
  });
});
