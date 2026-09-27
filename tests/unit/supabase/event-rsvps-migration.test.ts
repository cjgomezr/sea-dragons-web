import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0037_event_rsvps.sql` contra un Postgres desechable (#308, RF-5 del PRD de
 * E7). Lo que la base afirma sola: el valor de la respuesta, una fila por
 * miembro y ocurrencia, el club atado al evento y al miembro, las cascadas y
 * que sólo el servidor escribe. Quién puede responder lo prueba el dominio.
 */

const SEEDED_CLUB = "victoria-seadragons";

type Member = { readonly clubId: string; readonly userId: string };

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
): Promise<string> {
  return database.query(
    `insert into public.events
       (club_id, title, event_type, starts_on, start_time, location,
        audience, author_id)
     values ('${author.clubId}', 'Entrenamiento', 'training', '2027-07-06',
             '19:00', 'MSAC', 'all', '${author.userId}')
     returning id`,
  );
}

function upsertSql(eventId: string, member: Member, response: string): string {
  return `insert into public.event_rsvps
            (event_id, user_id, club_id, response, responded_at)
          values ('${eventId}', '${member.userId}', '${member.clubId}',
                  '${response}', now())
          on conflict (event_id, user_id)
          do update set response = excluded.response,
                        responded_at = excluded.responded_at`;
}

function countRsvps(database: TemporaryDatabase): Promise<string> {
  return database.query("select count(*) from public.event_rsvps");
}

async function seededMemberAndEvent(
  database: TemporaryDatabase,
): Promise<{ readonly member: Member; readonly eventId: string }> {
  const member = await seedMember(database, await seededClubId(database));
  return { member, eventId: await seedEvent(database, member) };
}

describeConPostgres("respuestas a eventos en la base", () => {
  it("una segunda respuesta reescribe la misma fila con su valor y su hora", async () => {
    const database = await migratedDatabase();
    const { member, eventId } = await seededMemberAndEvent(database);
    await database.query(upsertSql(eventId, member, "maybe"));
    const firstAt = await database.query(
      "select responded_at from public.event_rsvps",
    );

    await database.query(upsertSql(eventId, member, "yes"));

    await expect(countRsvps(database)).resolves.toBe("1");
    await expect(
      database.query(
        `select response || '|' || (responded_at > '${firstAt}')
           from public.event_rsvps`,
      ),
    ).resolves.toBe("yes|true");
  });

  it("rechaza una respuesta fuera de yes, maybe y no", async () => {
    const database = await migratedDatabase();
    const { member, eventId } = await seededMemberAndEvent(database);

    const intento = await database.attempt(
      upsertSql(eventId, member, "attending"),
    );

    expect(intento.code).toBeGreaterThan(0);
    expect(intento.stderr).toMatch(/event_rsvps_response_check/);
  });

  it("rechaza responder a un evento de otro club", async () => {
    const database = await migratedDatabase();
    const { member } = await seededMemberAndEvent(database);
    const foreignAuthor = await seedMember(
      database,
      await createOtherClub(database),
    );
    const foreignEventId = await seedEvent(database, foreignAuthor);

    const intento = await database.attempt(
      upsertSql(foreignEventId, member, "yes"),
    );

    expect(intento.code).toBeGreaterThan(0);
    expect(intento.stderr).toMatch(/event_rsvps_event_same_club_fkey/);
  });

  it("dos respuestas simultáneas del mismo miembro dejan una sola fila", async () => {
    const database = await migratedDatabase();
    const { member, eventId } = await seededMemberAndEvent(database);

    await Promise.all([
      database.query(upsertSql(eventId, member, "yes")),
      database.query(upsertSql(eventId, member, "yes")),
    ]);

    await expect(countRsvps(database)).resolves.toBe("1");
  });

  it("borrar la identidad del miembro se lleva sus respuestas", async () => {
    const database = await migratedDatabase();
    const { member, eventId } = await seededMemberAndEvent(database);
    const voter = await seedMember(database, member.clubId);
    await database.query(upsertSql(eventId, voter, "yes"));

    await database.query(`delete from auth.users where id = '${voter.userId}'`);

    await expect(countRsvps(database)).resolves.toBe("0");
  });

  it("borrar el evento se lleva sus respuestas", async () => {
    const database = await migratedDatabase();
    const { member, eventId } = await seededMemberAndEvent(database);
    await database.query(upsertSql(eventId, member, "no"));

    await database.query(`delete from public.events where id = '${eventId}'`);

    await expect(countRsvps(database)).resolves.toBe("0");
  });

  it("deja a anon sin privilegios y a authenticated sólo con la lectura", async () => {
    const database = await migratedDatabase();

    const privilegios = await database.query(
      `select grantee || ' ' || string_agg(privilege_type, ',' order by privilege_type)
         from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'event_rsvps'
          and grantee in ('anon', 'authenticated')
        group by grantee order by grantee`,
    );

    expect(privilegios).toBe("authenticated SELECT");
  });

  it("un miembro lee sólo sus respuestas y no puede escribir ninguna", async () => {
    const database = await migratedDatabase();
    const { member, eventId } = await seededMemberAndEvent(database);
    const other = await seedMember(database, member.clubId);
    await database.query(upsertSql(eventId, member, "yes"));
    await database.query(upsertSql(eventId, other, "no"));
    const asMember = `set role authenticated;
      set request.jwt.claims = '{"sub":"${member.userId}"}';`;

    const lectura = await database.query(
      `${asMember} select response from public.event_rsvps`,
    );
    const escritura = await database.attempt(
      `${asMember} ${upsertSql(eventId, member, "maybe")}`,
    );

    expect(lectura.split("\n").filter((line) => /^\w+$/.test(line))).toEqual([
      "yes",
    ]);
    expect(escritura.code).toBeGreaterThan(0);
    expect(escritura.stderr).toMatch(/permission denied/);
  });
});
