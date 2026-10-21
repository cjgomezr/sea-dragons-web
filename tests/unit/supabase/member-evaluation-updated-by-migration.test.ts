import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  databaseBeforeMigration,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0078_member_evaluation_updated_by.sql` contra un Postgres desechable (#817,
 * RF-1 y D6 del PRD de E31). Cada evaluación guarda quién hizo su última
 * edición: la crean, la guardan y la ponen al día las mismas funciones de
 * `0032` y `0033`, que ahora reciben a quien llama.
 */

const THIS_TICKETS_MIGRATION = "0078";
const SEEDED_CLUB = "victoria-seadragons";

type Outcome = Record<string, unknown>;

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
): Promise<string> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status)
     values ('${clubId}', '${userId}', '${fullName}',
             '${userId}@example.test', 'active')`,
  );
  return userId;
}

async function callFunction(
  database: TemporaryDatabase,
  call: string,
): Promise<Outcome> {
  return JSON.parse(await database.query(`select public.${call}`)) as Outcome;
}

function updatedByOf(
  database: TemporaryDatabase,
  userId: string,
): Promise<string> {
  return database.query(
    `select coalesce(updated_by::text, 'nadie')
       from public.member_evaluations where user_id = '${userId}'`,
  );
}

type Scene = {
  readonly clubId: string;
  readonly playerId: string;
  readonly coachId: string;
  readonly otherCoachId: string;
};

async function seedScene(database: TemporaryDatabase): Promise<Scene> {
  const clubId = await seededClubId(database);
  return {
    clubId,
    playerId: await seedMember(database, clubId, "Nerea Silva"),
    coachId: await seedMember(database, clubId, "Carla Coach"),
    otherCoachId: await seedMember(database, clubId, "Oscar Otro"),
  };
}

function createEvaluation(
  database: TemporaryDatabase,
  scene: Pick<Scene, "clubId" | "playerId">,
  actingUserId: string,
): Promise<Outcome> {
  return callFunction(
    database,
    `create_member_evaluation('${scene.clubId}', '${actingUserId}', '${scene.playerId}')`,
  );
}

describeConPostgres("quién hizo la última edición de una evaluación", () => {
  it("es una columna uuid que puede ser nula", async () => {
    const database = await migratedDatabase();

    const column = await database.query(
      `select data_type || ' null=' || is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'member_evaluations'
          and column_name = 'updated_by'`,
    );

    expect(column).toBe("uuid null=YES");
  });

  it("apunta a un miembro del mismo club que la evaluación", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);
    const outsiderId = await seedMember(
      database,
      await createOtherClub(database),
      "Fuera Fuera",
    );
    await createEvaluation(database, scene, scene.coachId);

    const change = await database.attempt(
      `update public.member_evaluations set updated_by = '${outsiderId}'
        where user_id = '${scene.playerId}'`,
    );

    expect(change.code).toBeGreaterThan(0);
    expect(change.stderr).toMatch(
      /violates foreign key constraint "member_evaluations_updated_by_same_club_fkey"/,
    );
  });

  it("queda vacía, sin borrar la evaluación, si se borra quien la editó", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);
    await createEvaluation(database, scene, scene.coachId);

    await database.query(
      `delete from auth.users where id = '${scene.coachId}'`,
    );

    await expect(updatedByOf(database, scene.playerId)).resolves.toBe("nadie");
  });

  it("crear la evaluación la apunta a quien llama", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);

    await expect(
      createEvaluation(database, scene, scene.coachId),
    ).resolves.toEqual({ outcome: "created" });

    await expect(updatedByOf(database, scene.playerId)).resolves.toBe(
      scene.coachId,
    );
  });

  it("guardar las notas la pasa a quien guarda", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);
    await createEvaluation(database, scene, scene.coachId);
    const updatedAt = await database.query(
      `select updated_at from public.member_evaluations
        where user_id = '${scene.playerId}'`,
    );
    const fitnessId = await database.query(
      `select id from public.evaluation_categories
        where club_id = '${scene.clubId}' and name = 'Fitness'`,
    );
    const ratings = JSON.stringify([{ category_id: fitnessId, rating: 9 }]);

    const saved = await callFunction(
      database,
      `save_member_evaluation_ratings('${scene.clubId}', '${scene.otherCoachId}', '${scene.playerId}', '${updatedAt}', '${ratings}'::jsonb)`,
    );

    expect(saved).toEqual({ outcome: "saved" });
    await expect(updatedByOf(database, scene.playerId)).resolves.toBe(
      scene.otherCoachId,
    );
  });

  it("ponerla al día la pasa a quien la pone al día, y si ya lo estaba no", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);
    await createEvaluation(database, scene, scene.coachId);
    const refreshCall = `refresh_member_evaluation('${scene.clubId}', '${scene.otherCoachId}', '${scene.playerId}')`;

    await expect(callFunction(database, refreshCall)).resolves.toEqual({
      outcome: "already_current",
    });
    await expect(updatedByOf(database, scene.playerId)).resolves.toBe(
      scene.coachId,
    );

    await database.query(
      `insert into public.evaluation_categories (club_id, name, sort_order)
       values ('${scene.clubId}', 'Breath hold', 11)`,
    );
    await expect(callFunction(database, refreshCall)).resolves.toMatchObject({
      outcome: "refreshed",
    });
    await expect(updatedByOf(database, scene.playerId)).resolves.toBe(
      scene.otherCoachId,
    );
  });

  it("no deja las funciones de antes, sin quien llama", async () => {
    const database = await migratedDatabase();

    const remaining = await database.query(
      `select count(*) from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('create_member_evaluation',
                            'save_member_evaluation_ratings',
                            'refresh_member_evaluation')
          and not ('acting_user_id' = any (p.proargnames))`,
    );

    expect(remaining).toBe("0");
  });

  it("sólo service_role ejecuta las funciones nuevas", async () => {
    const database = await migratedDatabase();

    const grants = await database.query(
      `select string_agg(fn || ' ' || r, ', ' order by fn, r)
         from (values
                ('public.create_member_evaluation(uuid, uuid, uuid)'),
                ('public.save_member_evaluation_ratings(uuid, uuid, uuid, timestamptz, jsonb)'),
                ('public.refresh_member_evaluation(uuid, uuid, uuid)')
              ) as f (fn)
        cross join (values ('anon'), ('authenticated'), ('service_role'))
              as roles (r)
        where has_function_privilege(r, fn, 'execute')`,
    );

    expect(grants).toBe(
      [
        "public.create_member_evaluation(uuid, uuid, uuid) service_role",
        "public.refresh_member_evaluation(uuid, uuid, uuid) service_role",
        "public.save_member_evaluation_ratings(uuid, uuid, uuid, timestamptz, jsonb) service_role",
      ].join(", "),
    );
  });

  it("deja vacía la de una evaluación anterior a la migración", async () => {
    const database = await databaseBeforeMigration(THIS_TICKETS_MIGRATION);
    const clubId = await seededClubId(database);
    const playerId = await seedMember(database, clubId, "Nerea Silva");
    await callFunction(
      database,
      `create_member_evaluation('${clubId}', '${playerId}')`,
    );

    const applied = await applyRepositoryMigrations(database);

    expect(applied.code, applied.stderr).toBe(0);
    await expect(updatedByOf(database, playerId)).resolves.toBe("nadie");
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
