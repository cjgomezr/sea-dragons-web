import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  databaseBeforeMigration,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0079_team_split_publisher.sql` contra un Postgres desechable (#838). Cada
 * reparto guarda quién lo publicó, para avisarle cuando uno de sus jugadores
 * deja de ir o vuelve. Lo escribe la función de publicar de `0047`, que ahora
 * recibe a quien llama, y lo vacía la de guardar, que vuelve a borrador.
 */

const THIS_TICKETS_MIGRATION = "0079";
const SEEDED_CLUB = "victoria-seadragons";
const FUTURE_ON = "2099-01-06";

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
  fullName: string,
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
): Promise<string> {
  return database.query(
    `insert into public.events
       (club_id, title, event_type, starts_on, start_time, location,
        audience, author_id)
     values ('${author.clubId}', 'Scrimmage', 'training', '${FUTURE_ON}',
             '19:00', 'MSAC', 'all', '${author.userId}')
     returning id`,
  );
}

function saveSplit(
  database: TemporaryDatabase,
  request: {
    readonly coach: Member;
    readonly eventId: string;
    readonly player: Member;
  },
): Promise<string> {
  const split = JSON.stringify({
    mode: "manual",
    team_a_name: "Team Kelp",
    team_a_color: "#1C6EA4",
    team_b_name: "Team Tide",
    team_b_color: "#C99A3E",
    assignments: [{ user_id: request.player.userId, team: "a" }],
  });
  return database.query(
    `select public.save_team_split('${request.coach.clubId}',
       '${request.coach.userId}', '${request.eventId}', '${split}'::jsonb)`,
  );
}

function publishSplit(
  database: TemporaryDatabase,
  publisher: Member,
  eventId: string,
): Promise<string> {
  return database.query(
    `select public.publish_team_split('${publisher.clubId}',
       '${publisher.userId}', '${eventId}') ->> 'outcome'`,
  );
}

function publishedByOf(
  database: TemporaryDatabase,
  eventId: string,
): Promise<string> {
  return database.query(
    `select coalesce(published_by::text, 'nadie')
       from public.team_splits where event_id = '${eventId}'`,
  );
}

type Scene = {
  readonly coach: Member;
  readonly otherCoach: Member;
  readonly player: Member;
  readonly eventId: string;
};

async function seedScene(database: TemporaryDatabase): Promise<Scene> {
  const clubId = await seededClubId(database);
  const coach = await seedMember(database, clubId, "Carla Coach");
  const otherCoach = await seedMember(database, clubId, "Oscar Otro");
  const player = await seedMember(database, clubId, "Nerea Silva");
  const eventId = await seedEvent(database, coach);
  await saveSplit(database, { coach, eventId, player });
  return { coach, otherCoach, player, eventId };
}

describeConPostgres("quién publicó el reparto", () => {
  it("es una columna uuid que puede ser nula", async () => {
    const database = await migratedDatabase();

    const column = await database.query(
      `select data_type || ' null=' || is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'team_splits'
          and column_name = 'published_by'`,
    );

    expect(column).toBe("uuid null=YES");
  });

  it("apunta a un miembro del mismo club que el reparto", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);
    const outsider = await seedMember(
      database,
      await createOtherClub(database),
      "Fuera Fuera",
    );

    const change = await database.attempt(
      `update public.team_splits set published_by = '${outsider.userId}'
        where event_id = '${scene.eventId}'`,
    );

    expect(change.code).toBeGreaterThan(0);
    expect(change.stderr).toMatch(
      /violates foreign key constraint "team_splits_publisher_same_club_fkey"/,
    );
  });

  it("queda vacía, sin borrar el reparto, si se borra quien lo publicó", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);
    await publishSplit(database, scene.otherCoach, scene.eventId);

    await database.query(
      `delete from auth.users where id = '${scene.otherCoach.userId}'`,
    );

    await expect(publishedByOf(database, scene.eventId)).resolves.toBe("nadie");
  });

  it("publicar la apunta a quien publica", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);

    await expect(
      publishSplit(database, scene.coach, scene.eventId),
    ).resolves.toBe("published");

    await expect(publishedByOf(database, scene.eventId)).resolves.toBe(
      scene.coach.userId,
    );
  });

  it("volver a publicar la pasa a quien publica la segunda vez", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);
    await publishSplit(database, scene.coach, scene.eventId);

    await publishSplit(database, scene.otherCoach, scene.eventId);

    await expect(publishedByOf(database, scene.eventId)).resolves.toBe(
      scene.otherCoach.userId,
    );
  });

  it("guardar el reparto, que vuelve a borrador, la vacía", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);
    await publishSplit(database, scene.coach, scene.eventId);

    await saveSplit(database, {
      coach: scene.otherCoach,
      eventId: scene.eventId,
      player: scene.player,
    });

    await expect(publishedByOf(database, scene.eventId)).resolves.toBe("nadie");
  });

  it("no deja la función de publicar de antes, sin quien llama", async () => {
    const database = await migratedDatabase();

    const remaining = await database.query(
      `select count(*) from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'publish_team_split'
          and not ('acting_user_id' = any (p.proargnames))`,
    );

    expect(remaining).toBe("0");
  });

  it("sólo service_role ejecuta la función de publicar nueva", async () => {
    const database = await migratedDatabase();

    const grantees = await database.query(
      `select string_agg(r.rolname, ',' order by r.rolname)
         from pg_roles r
        where r.rolname in ('anon', 'authenticated', 'service_role')
          and has_function_privilege(r.rolname,
                'public.publish_team_split(uuid, uuid, uuid)', 'execute')`,
    );

    expect(grantees).toBe("service_role");
  });

  it("admite los avisos team_player_dropped y team_player_returned", async () => {
    const database = await migratedDatabase();
    const { coach } = await seedScene(database);

    await database.query(
      `insert into public.notifications (user_id, club_id, type)
       values ('${coach.userId}', '${coach.clubId}', 'team_player_dropped'),
              ('${coach.userId}', '${coach.clubId}', 'team_player_returned')`,
    );

    await expect(
      database.query("select count(*) from public.notifications"),
    ).resolves.toBe("2");
  });

  it("deja vacía la de un reparto publicado antes de la migración", async () => {
    const database = await databaseBeforeMigration(THIS_TICKETS_MIGRATION);
    const clubId = await seededClubId(database);
    const coach = await seedMember(database, clubId, "Carla Coach");
    const player = await seedMember(database, clubId, "Nerea Silva");
    const eventId = await seedEvent(database, coach);
    await saveSplit(database, { coach, eventId, player });
    await database.query(
      `select public.publish_team_split('${clubId}', '${eventId}')`,
    );

    const applied = await applyRepositoryMigrations(database);

    expect(applied.code, applied.stderr).toBe(0);
    await expect(publishedByOf(database, eventId)).resolves.toBe("nadie");
  });

  it("es idempotente: aplicada dos veces no falla ni cambia nada", async () => {
    const database = await migratedDatabase();
    const firstSnapshot = await database.snapshot();

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(await database.snapshot()).toBe(firstSnapshot);
  });

  it("schema-expected.txt declara lo que la migración deja", async () => {
    const database = await migratedDatabase();

    const check = await database.checkSchema();

    expect(check.code, check.stdout + check.stderr).toBe(0);
  });
});
