import { describe, expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0059_directory_email_sends.sql` contra un Postgres desechable (#501, RF-7
 * del PRD de E19, D8). El registro de los correos del directorio: cuántos
 * caben en la ventana, reservados de una vez para que dos envíos a la vez no
 * pasen juntos del cupo, y una sola vez por petición.
 */

const SEEDED_CLUB = "victoria-seadragons";
const LIMIT = 50;
const WINDOW = "now() - interval '24 hours'";

function seededClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
}

async function seedSender(database: TemporaryDatabase): Promise<string> {
  return database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
}

type Reservation = {
  readonly clubId: string;
  readonly senderId: string;
  readonly requestId?: string;
  readonly count: number;
};

function reserve(
  database: TemporaryDatabase,
  reservation: Reservation,
): Promise<string> {
  const requestId =
    reservation.requestId === undefined
      ? "gen_random_uuid()"
      : `'${reservation.requestId}'`;
  return database.query(
    `select public.reserve_directory_email_quota(
       '${reservation.clubId}', '${reservation.senderId}', ${requestId},
       ${reservation.count}, ${LIMIT}, ${WINDOW})::text`,
  );
}

function sentSince(
  database: TemporaryDatabase,
  windowStart: string = WINDOW,
): Promise<string> {
  return database.query(
    `select public.count_directory_emails_since(${windowStart})`,
  );
}

async function setUp(): Promise<{
  readonly database: TemporaryDatabase;
  readonly clubId: string;
  readonly senderId: string;
}> {
  const database = await migratedDatabase();
  return {
    database,
    clubId: await seededClubId(database),
    senderId: await seedSender(database),
  };
}

function outcomeOf(json: string): unknown {
  return JSON.parse(json);
}

describeConPostgres("el registro de los correos del directorio", () => {
  describe("reservar", () => {
    it("reserva lo que cabe y lo cuenta", async () => {
      const { database, clubId, senderId } = await setUp();

      const reserved = outcomeOf(
        await reserve(database, { clubId, senderId, count: LIMIT }),
      );

      expect(reserved).toMatchObject({ outcome: "reserved" });
      await expect(sentSince(database)).resolves.toBe(String(LIMIT));
    });

    it("con uno más de los que caben no reserva nada y dice cuántos caben", async () => {
      const { database, clubId, senderId } = await setUp();
      await reserve(database, { clubId, senderId, count: 10 });

      const exceeded = outcomeOf(
        await reserve(database, { clubId, senderId, count: LIMIT - 9 }),
      );

      expect(exceeded).toEqual({ outcome: "exceeded", remaining: LIMIT - 10 });
      await expect(sentSince(database)).resolves.toBe("10");
    });

    it("la misma petición dos veces se reserva una sola", async () => {
      const { database, clubId, senderId } = await setUp();
      const requestId = "7e7e7e7e-0000-4000-8000-000000000001";
      await reserve(database, { clubId, senderId, requestId, count: 3 });

      const again = outcomeOf(
        await reserve(database, { clubId, senderId, requestId, count: 3 }),
      );

      expect(again).toEqual({ outcome: "duplicate" });
      await expect(sentSince(database)).resolves.toBe("3");
    });

    it("dos reservas a la vez no pasan juntas del cupo", async () => {
      const { database, clubId, senderId } = await setUp();

      const outcomes = await Promise.all([
        reserve(database, { clubId, senderId, count: 30 }),
        reserve(database, { clubId, senderId, count: 30 }),
      ]);

      const kinds = outcomes
        .map((json) => (outcomeOf(json) as { outcome: string }).outcome)
        .sort();
      expect(kinds).toEqual(["exceeded", "reserved"]);
      await expect(sentSince(database)).resolves.toBe("30");
    });
  });

  describe("contar", () => {
    it("cuenta los que salieron de verdad una vez apuntados", async () => {
      const { database, clubId, senderId } = await setUp();
      const reserved = outcomeOf(
        await reserve(database, { clubId, senderId, count: 10 }),
      ) as { send_id: string };

      await database.query(
        `update public.directory_email_sends set sent_count = 4
          where id = '${reserved.send_id}'`,
      );

      await expect(sentSince(database)).resolves.toBe("4");
    });

    it("no cuenta los envíos de antes de la ventana", async () => {
      const { database, clubId, senderId } = await setUp();
      await database.query(
        `insert into public.directory_email_sends
           (club_id, sender_id, request_id, reserved_count, sent_count, created_at)
         values ('${clubId}', '${senderId}', gen_random_uuid(), 30, 30,
                 now() - interval '25 hours')`,
      );

      await expect(sentSince(database)).resolves.toBe("0");
    });

    it("no deja apuntar más enviados que reservados", async () => {
      const { database, clubId, senderId } = await setUp();
      const reserved = outcomeOf(
        await reserve(database, { clubId, senderId, count: 2 }),
      ) as { send_id: string };

      const result = await database.attempt(
        `update public.directory_email_sends set sent_count = 3
          where id = '${reserved.send_id}'`,
      );

      expect(result.code).not.toBe(0);
    });
  });

  describe("quién llega", () => {
    it("una sesión no puede leer el registro", async () => {
      const { database, clubId, senderId } = await setUp();
      await reserve(database, { clubId, senderId, count: 1 });

      const result = await database.attempt(
        `set role authenticated;
         set request.jwt.claims = '{"sub":"${senderId}"}';
         select count(*) from public.directory_email_sends;`,
      );

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("permission denied");
    });

    it.each(["anon", "authenticated"])(
      "%s no puede reservar cupo",
      async (role) => {
        const { database, clubId, senderId } = await setUp();

        const result = await database.attempt(
          `set role ${role};
           select public.reserve_directory_email_quota(
             '${clubId}', '${senderId}', gen_random_uuid(), 1, ${LIMIT}, ${WINDOW});`,
        );

        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain("permission denied");
      },
    );
  });

  it("los correos del directorio no restan del cupo de los correos de cuenta", async () => {
    const { database, clubId, senderId } = await setUp();
    const accountRequests = () =>
      database.query("select count(*) from public.email_send_requests");
    const before = await accountRequests();
    const reserved = outcomeOf(
      await reserve(database, { clubId, senderId, count: LIMIT }),
    ) as { send_id: string };
    await database.query(
      `update public.directory_email_sends set sent_count = ${LIMIT}
        where id = '${reserved.send_id}'`,
    );

    await expect(accountRequests()).resolves.toBe(before);
  });

  it("volver a aplicarla no toca lo apuntado", async () => {
    const { database, clubId, senderId } = await setUp();
    await reserve(database, { clubId, senderId, count: 7 });

    const again = await applyRepositoryMigrations(database);

    expect(again.code, again.stderr).toBe(0);
    await expect(sentSince(database)).resolves.toBe("7");
  });
});
