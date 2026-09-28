import { describe, expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0045_team_splits.sql` contra un Postgres desechable (#399, RF-1 del PRD de
 * E10). Lo que la base afirma sola: un reparto por evento con sus dos equipos,
 * una fila por jugador, que todo sea del mismo club, las cascadas, quién lee
 * un reparto publicado y que sólo el servidor escribe.
 */

const SEEDED_CLUB = "victoria-seadragons";

const COMMAND_TAGS = new Set(["SET"]);

type Member = { readonly clubId: string; readonly userId: string };

type SplitWorld = {
  readonly coach: Member;
  readonly player: Member;
  readonly eventId: string;
  readonly splitId: string;
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

/** `audience` es SQL literal: `'all'` o `'groups'`. */
function seedEvent(
  database: TemporaryDatabase,
  author: Member,
  audience = "'all'",
): Promise<string> {
  return database.query(
    `insert into public.events
       (club_id, title, event_type, starts_on, start_time, location,
        audience, author_id)
     values ('${author.clubId}', 'Partido', 'training', '2027-07-06',
             '19:00', 'MSAC', ${audience}, '${author.userId}')
     returning id`,
  );
}

/** `publishedAt` es SQL literal: `null` o `now()`. */
function insertSplitSql(
  eventId: string,
  clubId: string,
  publishedAt = "null",
): string {
  return `insert into public.team_splits
            (event_id, club_id, team_a_name, team_a_color, team_b_name,
             team_b_color, mode, published_at)
          values ('${eventId}', '${clubId}', 'Team Kelp', '#1d4ed8',
                  'Team Tide', '#facc15', 'manual', ${publishedAt})`;
}

function seedSplit(
  database: TemporaryDatabase,
  eventId: string,
  clubId: string,
  publishedAt = "null",
): Promise<string> {
  return database.query(
    `${insertSplitSql(eventId, clubId, publishedAt)} returning id`,
  );
}

function assignSql(splitId: string, member: Member, team: string): string {
  return `insert into public.team_split_members
            (split_id, user_id, club_id, team)
          values ('${splitId}', '${member.userId}', '${member.clubId}',
                  '${team}')
          on conflict (split_id, user_id) do update set team = excluded.team`;
}

async function seededSplit(
  database: TemporaryDatabase,
  publishedAt = "null",
): Promise<SplitWorld> {
  const clubId = await seededClubId(database);
  const coach = await seedMember(database, clubId);
  const player = await seedMember(database, clubId);
  const eventId = await seedEvent(database, coach);
  const splitId = await seedSplit(database, eventId, clubId, publishedAt);
  return { coach, player, eventId, splitId };
}

function count(database: TemporaryDatabase, table: string): Promise<string> {
  return database.query(`select count(*) from public.${table}`);
}

function asMember(member: Member, sql: string): string {
  return `set role authenticated;
    set request.jwt.claims = '{"sub":"${member.userId}"}'; ${sql}`;
}

function rowsOf(result: string): string[] {
  return result
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !COMMAND_TAGS.has(line));
}

/** Lo que `member` ve con su sesión: repartos y filas de equipo, contados. */
async function visibleTo(
  database: TemporaryDatabase,
  member: Member,
): Promise<string[]> {
  return rowsOf(
    await database.query(
      asMember(
        member,
        `select (select count(*) from public.team_splits) || '|' ||
                (select count(*) from public.team_split_members)`,
      ),
    ),
  );
}

function expectRejectedBy(result: RunResult, constraint: string): void {
  expect(result.code).toBeGreaterThan(0);
  expect(result.stderr).toContain(constraint);
}

describeConPostgres("los repartos de equipos en la base", () => {
  it("guarda el reparto con sus dos equipos, el modo y el borrador nulo", async () => {
    const database = await migratedDatabase();
    const { splitId } = await seededSplit(database);

    const saved = await database.query(
      `select concat_ws('|', team_a_name, team_a_color, team_b_name,
                        team_b_color, mode,
                        coalesce(published_at::text, 'null'))
         from public.team_splits where id = '${splitId}'`,
    );

    expect(saved).toBe("Team Kelp|#1d4ed8|Team Tide|#facc15|manual|null");
  });

  it("deja un solo reparto por evento", async () => {
    const database = await migratedDatabase();
    const { eventId, coach } = await seededSplit(database);

    const second = await database.attempt(
      insertSplitSql(eventId, coach.clubId),
    );

    expectRejectedBy(second, "team_splits_event_id_key");
  });

  it("acepta el modo auto y rechaza cualquier otro", async () => {
    const database = await migratedDatabase();
    const { splitId } = await seededSplit(database);

    const auto = await database.attempt(
      `update public.team_splits set mode = 'auto' where id = '${splitId}'`,
    );
    const other = await database.attempt(
      `update public.team_splits set mode = 'random' where id = '${splitId}'`,
    );

    expect(auto.code, auto.stderr).toBe(0);
    expectRejectedBy(other, "team_splits_mode_check");
  });

  it("asignar otra vez al mismo jugador lo mueve de equipo", async () => {
    const database = await migratedDatabase();
    const { splitId, player } = await seededSplit(database);
    await database.query(assignSql(splitId, player, "a"));

    await database.query(assignSql(splitId, player, "b"));

    await expect(
      database.query("select team from public.team_split_members"),
    ).resolves.toBe("b");
  });

  it("rechaza un equipo que no es a ni b", async () => {
    const database = await migratedDatabase();
    const { splitId, player } = await seededSplit(database);

    const intento = await database.attempt(assignSql(splitId, player, "c"));

    expectRejectedBy(intento, "team_split_members_team_check");
  });

  it("rechaza un reparto de un evento de otro club", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const foreignCoach = await seedMember(
      database,
      await createOtherClub(database),
    );
    const foreignEventId = await seedEvent(database, foreignCoach);

    const intento = await database.attempt(
      insertSplitSql(foreignEventId, clubId),
    );

    expectRejectedBy(intento, "team_splits_event_same_club_fkey");
  });

  it("rechaza asignar a un jugador de otro club", async () => {
    const database = await migratedDatabase();
    const { splitId } = await seededSplit(database);
    const foreignPlayer = await seedMember(
      database,
      await createOtherClub(database),
    );

    const intento = await database.attempt(
      assignSql(splitId, foreignPlayer, "a"),
    );

    expectRejectedBy(intento, "team_split_members_split_same_club_fkey");
  });

  it("borrar la identidad de un jugador se lleva su fila y deja el reparto", async () => {
    const database = await migratedDatabase();
    const { splitId, player, coach } = await seededSplit(database);
    await database.query(assignSql(splitId, player, "a"));
    await database.query(assignSql(splitId, coach, "b"));

    await database.query(
      `delete from auth.users where id = '${player.userId}'`,
    );

    await expect(
      database.query("select user_id from public.team_split_members"),
    ).resolves.toBe(coach.userId);
    await expect(count(database, "team_splits")).resolves.toBe("1");
  });

  it("borrar el evento se lleva el reparto entero", async () => {
    const database = await migratedDatabase();
    const { splitId, player, eventId } = await seededSplit(database);
    await database.query(assignSql(splitId, player, "a"));

    await database.query(`delete from public.events where id = '${eventId}'`);

    await expect(count(database, "team_splits")).resolves.toBe("0");
    await expect(count(database, "team_split_members")).resolves.toBe("0");
  });

  it("si quien lo creó se va, el reparto se queda sin su nombre", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const author = await seedMember(database, clubId);
    const coach = await seedMember(database, clubId);
    const eventId = await seedEvent(database, author);
    const splitId = await seedSplit(database, eventId, clubId);
    await database.query(
      `update public.team_splits set created_by = '${coach.userId}'
        where id = '${splitId}'`,
    );

    await database.query(`delete from auth.users where id = '${coach.userId}'`);

    await expect(
      database.query(
        `select club_id || '|' || coalesce(created_by::text, 'null')
           from public.team_splits`,
      ),
    ).resolves.toBe(`${clubId}|null`);
  });

  it("es idempotente: aplicada dos veces no falla ni cambia nada", async () => {
    const database = await migratedDatabase();
    const despuesDeLaPrimera = await database.snapshot();

    const segunda = await applyRepositoryMigrations(database);

    expect(segunda.code, segunda.stderr).toBe(0);
    expect(despuesDeLaPrimera).toMatch(/tabla team_splits rls=t/);
    expect(despuesDeLaPrimera).toMatch(/tabla team_split_members rls=t/);
    expect(await database.snapshot()).toBe(despuesDeLaPrimera);
  });

  describe("quién lee el reparto", () => {
    it("un jugador asignado lee el reparto publicado y los dos equipos", async () => {
      const database = await migratedDatabase();
      const { splitId, player, coach } = await seededSplit(database, "now()");
      await database.query(assignSql(splitId, player, "a"));
      await database.query(assignSql(splitId, coach, "b"));

      await expect(visibleTo(database, player)).resolves.toEqual(["1|2"]);
    });

    it("un jugador asignado lee el publicado aunque haya salido de la audiencia", async () => {
      const database = await migratedDatabase();
      const clubId = await seededClubId(database);
      const coach = await seedMember(database, clubId);
      const player = await seedMember(database, clubId);
      const eventId = await seedEvent(database, coach, "'groups'");
      const splitId = await seedSplit(database, eventId, clubId, "now()");
      await database.query(assignSql(splitId, player, "a"));

      await expect(visibleTo(database, player)).resolves.toEqual(["1|1"]);
    });

    it("nadie lee un borrador, ni el jugador asignado", async () => {
      const database = await migratedDatabase();
      const { splitId, player } = await seededSplit(database);
      await database.query(assignSql(splitId, player, "a"));

      await expect(visibleTo(database, player)).resolves.toEqual(["0|0"]);
    });

    it("la audiencia sin asignar lee el reparto publicado de su evento", async () => {
      const database = await migratedDatabase();
      const { splitId, player, coach } = await seededSplit(database, "now()");
      await database.query(assignSql(splitId, player, "a"));

      await expect(visibleTo(database, coach)).resolves.toEqual(["1|1"]);
    });

    it("un miembro del club fuera de la audiencia no lee el publicado", async () => {
      const database = await migratedDatabase();
      const clubId = await seededClubId(database);
      const coach = await seedMember(database, clubId);
      const player = await seedMember(database, clubId);
      const outsider = await seedMember(database, clubId);
      const group = await database.query(
        `insert into public.groups (club_id, name)
         values ('${clubId}', 'Senior Squad') returning id`,
      );
      const eventId = await seedEvent(database, coach, "'groups'");
      await database.query(
        `insert into public.event_groups (event_id, group_id, club_id)
         values ('${eventId}', '${group}', '${clubId}')`,
      );
      const splitId = await seedSplit(database, eventId, clubId, "now()");
      await database.query(assignSql(splitId, player, "a"));

      await expect(visibleTo(database, outsider)).resolves.toEqual(["0|0"]);
    });

    it("un miembro de otro club no lee el publicado", async () => {
      const database = await migratedDatabase();
      const { splitId, player } = await seededSplit(database, "now()");
      await database.query(assignSql(splitId, player, "a"));
      const foreigner = await seedMember(
        database,
        await createOtherClub(database),
      );

      await expect(visibleTo(database, foreigner)).resolves.toEqual(["0|0"]);
    });

    it("anon no lee nada", async () => {
      const database = await migratedDatabase();
      await seededSplit(database, "now()");

      const lecturas = await Promise.all([
        database.attempt(
          "set role anon; select count(*) from public.team_splits",
        ),
        database.attempt(
          "set role anon; select count(*) from public.team_split_members",
        ),
      ]);

      for (const lectura of lecturas) {
        expectRejectedBy(lectura, "permission denied");
      }
    });
  });

  describe("privilegios", () => {
    it.each(["team_splits", "team_split_members"])(
      "deja a anon sin privilegios y a authenticated sólo con la lectura de %s",
      async (table) => {
        const database = await migratedDatabase();

        const privilegios = await database.query(
          `select grantee || ' ' || string_agg(privilege_type, ',' order by privilege_type)
             from information_schema.role_table_grants
            where table_schema = 'public' and table_name = '${table}'
              and grantee in ('anon', 'authenticated')
            group by grantee order by grantee`,
        );

        expect(privilegios).toBe("authenticated SELECT");
      },
    );

    it.each(["team_splits", "team_split_members"])(
      "da a service_role la lectura y la escritura de %s",
      async (table) => {
        const database = await migratedDatabase();

        const privilegios = await database.query(
          `select string_agg(privilege_type, ',' order by privilege_type)
             from information_schema.role_table_grants
            where table_schema = 'public' and table_name = '${table}'
              and grantee = 'service_role'
              and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')`,
        );

        expect(privilegios).toBe("DELETE,INSERT,SELECT,UPDATE");
      },
    );

    it("un jugador asignado no puede escribir el reparto ni su equipo", async () => {
      const database = await migratedDatabase();
      const { splitId, player, eventId } = await seededSplit(database, "now()");
      await database.query(assignSql(splitId, player, "a"));

      const escrituras = await Promise.all([
        database.attempt(
          asMember(player, insertSplitSql(eventId, player.clubId)),
        ),
        database.attempt(
          asMember(player, "update public.team_splits set mode = 'auto'"),
        ),
        database.attempt(asMember(player, "delete from public.team_splits")),
        database.attempt(asMember(player, assignSql(splitId, player, "b"))),
        database.attempt(
          asMember(player, "update public.team_split_members set team = 'b'"),
        ),
        database.attempt(
          asMember(player, "delete from public.team_split_members"),
        ),
      ]);

      for (const escritura of escrituras) {
        expectRejectedBy(escritura, "permission denied");
      }
    });

    it("la función que mira la asignación no la llama anon", async () => {
      const database = await migratedDatabase();
      const { splitId } = await seededSplit(database, "now()");

      const llamada = await database.attempt(
        `set role anon; select public.is_assigned_to_team_split('${splitId}')`,
      );

      expectRejectedBy(llamada, "permission denied");
    });
  });
});
