import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0080_save_member_evaluation.sql` contra un Postgres desechable (#820, D4
 * del PRD de E31). Guardar una evaluación que no está al día la pone al día
 * y guarda sus notas en la misma escritura, contra la fecha que se leyó: las
 * categorías activas que le faltaban entran con la nota que llega (o en 5),
 * y las desactivadas salen.
 */

const SEEDED_CLUB = "victoria-seadragons";
const SAVE_SIGNATURE =
  "save_member_evaluation(uuid, uuid, uuid, timestamptz, jsonb)";

type Outcome = Record<string, unknown>;

type RatingInput = { readonly categoryId: string; readonly rating: number };

type Scene = {
  readonly clubId: string;
  readonly playerId: string;
  readonly coachId: string;
  readonly fitnessId: string;
  readonly speedId: string;
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

function categoryIdOf(
  database: TemporaryDatabase,
  clubId: string,
  name: string,
): Promise<string> {
  return database.query(
    `select id from public.evaluation_categories
      where club_id = '${clubId}' and name = '${name}'`,
  );
}

function addCategory(
  database: TemporaryDatabase,
  clubId: string,
  name: string,
): Promise<string> {
  return database.query(
    `insert into public.evaluation_categories (club_id, name, sort_order)
     values ('${clubId}', '${name}', 99) returning id`,
  );
}

function deactivateCategory(
  database: TemporaryDatabase,
  categoryId: string,
): Promise<string> {
  return database.query(
    `update public.evaluation_categories set deactivated_at = now()
      where id = '${categoryId}'`,
  );
}

function updatedAtOf(
  database: TemporaryDatabase,
  userId: string,
): Promise<string> {
  return database.query(
    `select updated_at from public.member_evaluations
      where user_id = '${userId}'`,
  );
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

/** `nombre=valoración`, por nombre para no depender del orden. */
async function ratingsOf(
  database: TemporaryDatabase,
  userId: string,
): Promise<string[]> {
  const rows = await database.query(
    `select c.name || '=' || r.rating
       from public.member_evaluation_ratings r
       join public.member_evaluations e on e.id = r.evaluation_id
       join public.evaluation_categories c on c.id = r.category_id
      where e.user_id = '${userId}'
      order by c.name`,
  );
  return rows === "" ? [] : rows.split("\n");
}

function saveCall(
  scene: Pick<Scene, "clubId" | "coachId" | "playerId">,
  expectedUpdatedAt: string,
  ratings: readonly RatingInput[],
): string {
  const json = JSON.stringify(
    ratings.map(({ categoryId, rating }) => ({
      category_id: categoryId,
      rating,
    })),
  );
  return `save_member_evaluation('${scene.clubId}', '${scene.coachId}', '${scene.playerId}', '${expectedUpdatedAt}', '${json}'::jsonb)`;
}

/** Un club con sus categorías de siempre, sólo Fitness y Speed activas, y
 * Nerea evaluada con las dos en 5. */
async function seedScene(database: TemporaryDatabase): Promise<Scene> {
  const clubId = await seededClubId(database);
  const fitnessId = await categoryIdOf(database, clubId, "Fitness");
  const speedId = await categoryIdOf(database, clubId, "Speed");
  await database.query(
    `update public.evaluation_categories set deactivated_at = now()
      where club_id = '${clubId}' and id not in ('${fitnessId}', '${speedId}')`,
  );
  const scene = {
    clubId,
    fitnessId,
    speedId,
    playerId: await seedMember(database, clubId, "Nerea Silva"),
    coachId: await seedMember(database, clubId, "Carla Coach"),
  };
  await callFunction(
    database,
    `create_member_evaluation('${clubId}', '${scene.coachId}', '${scene.playerId}')`,
  );
  return scene;
}

describeConPostgres("guardar una evaluación al día", () => {
  it("guarda las notas, mueve la fecha y la pasa a quien guarda", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);
    const readAt = await updatedAtOf(database, scene.playerId);

    const outcome = await callFunction(
      database,
      saveCall(scene, readAt, [
        { categoryId: scene.fitnessId, rating: 9 },
        { categoryId: scene.speedId, rating: 2 },
      ]),
    );

    expect(outcome).toEqual({ outcome: "saved" });
    expect(await ratingsOf(database, scene.playerId)).toEqual([
      "Fitness=9",
      "Speed=2",
    ]);
    expect(await updatedAtOf(database, scene.playerId)).not.toBe(readAt);
    expect(await updatedByOf(database, scene.playerId)).toBe(scene.coachId);
  });
});

describeConPostgres("guardar una evaluación que no está al día", () => {
  it("la pone al día y guarda las notas en la misma escritura", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);
    const breathHoldId = await addCategory(database, scene.clubId, "Breath");
    await deactivateCategory(database, scene.speedId);
    const readAt = await updatedAtOf(database, scene.playerId);

    const outcome = await callFunction(
      database,
      saveCall(scene, readAt, [
        { categoryId: scene.fitnessId, rating: 8 },
        { categoryId: breathHoldId, rating: 6 },
      ]),
    );

    expect(outcome).toEqual({ outcome: "saved" });
    expect(await ratingsOf(database, scene.playerId)).toEqual([
      "Breath=6",
      "Fitness=8",
    ]);
  });

  it("deja en 5 una categoría activa que le faltaba y no llega", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);
    await addCategory(database, scene.clubId, "Breath");
    const readAt = await updatedAtOf(database, scene.playerId);

    await callFunction(
      database,
      saveCall(scene, readAt, [{ categoryId: scene.fitnessId, rating: 8 }]),
    );

    expect(await ratingsOf(database, scene.playerId)).toEqual([
      "Breath=5",
      "Fitness=8",
      "Speed=5",
    ]);
  });

  it("no pisa un cambio hecho desde que se leyó, ni la pone al día", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);
    const readAt = await updatedAtOf(database, scene.playerId);
    await callFunction(
      database,
      saveCall(scene, readAt, [{ categoryId: scene.fitnessId, rating: 8 }]),
    );
    const breathHoldId = await addCategory(database, scene.clubId, "Breath");

    const outcome = await callFunction(
      database,
      saveCall(scene, readAt, [
        { categoryId: scene.fitnessId, rating: 3 },
        { categoryId: breathHoldId, rating: 6 },
      ]),
    );

    expect(outcome).toEqual({ outcome: "evaluation_changed" });
    expect(await ratingsOf(database, scene.playerId)).toEqual([
      "Fitness=8",
      "Speed=5",
    ]);
  });

  it("rechaza una categoría desactivada sin escribir nada", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);
    await deactivateCategory(database, scene.speedId);
    const readAt = await updatedAtOf(database, scene.playerId);

    const outcome = await callFunction(
      database,
      saveCall(scene, readAt, [
        { categoryId: scene.fitnessId, rating: 9 },
        { categoryId: scene.speedId, rating: 7 },
      ]),
    );

    expect(outcome).toEqual({
      outcome: "unknown_category",
      category_id: scene.speedId,
    });
    expect(await ratingsOf(database, scene.playerId)).toEqual([
      "Fitness=5",
      "Speed=5",
    ]);
    expect(await updatedAtOf(database, scene.playerId)).toBe(readAt);
  });

  it("rechaza una categoría de otro club sin escribir nada", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);
    const foreignId = await addCategory(
      database,
      await createOtherClub(database),
      "Fuera",
    );
    const readAt = await updatedAtOf(database, scene.playerId);

    const outcome = await callFunction(
      database,
      saveCall(scene, readAt, [{ categoryId: foreignId, rating: 7 }]),
    );

    expect(outcome).toEqual({
      outcome: "unknown_category",
      category_id: foreignId,
    });
    expect(await updatedAtOf(database, scene.playerId)).toBe(readAt);
  });

  it("rechaza una nota fuera de rango sin escribir nada", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);
    const breathHoldId = await addCategory(database, scene.clubId, "Breath");
    const readAt = await updatedAtOf(database, scene.playerId);

    const attempt = await database.attempt(
      `select public.${saveCall(scene, readAt, [
        { categoryId: scene.fitnessId, rating: 9 },
        { categoryId: breathHoldId, rating: 11 },
      ])}`,
    );

    expect(attempt.code).not.toBe(0);
    expect(await ratingsOf(database, scene.playerId)).toEqual([
      "Fitness=5",
      "Speed=5",
    ]);
  });
});

describeConPostgres("a quién no alcanza guardar", () => {
  it("dice que no hay evaluación si el miembro no tiene", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);
    const newcomerId = await seedMember(database, scene.clubId, "Nuevo Nuevo");

    const outcome = await callFunction(
      database,
      saveCall({ ...scene, playerId: newcomerId }, "2026-09-27T00:00:00Z", [
        { categoryId: scene.fitnessId, rating: 9 },
      ]),
    );

    expect(outcome).toEqual({ outcome: "evaluation_not_found" });
  });

  it("no guarda la evaluación de un miembro dado de baja", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);
    const readAt = await updatedAtOf(database, scene.playerId);
    await database.query(
      `update public.members set account_status = 'inactive'
        where user_id = '${scene.playerId}'`,
    );

    const outcome = await callFunction(
      database,
      saveCall(scene, readAt, [{ categoryId: scene.fitnessId, rating: 9 }]),
    );

    expect(outcome).toEqual({ outcome: "member_inactive" });
    expect(await ratingsOf(database, scene.playerId)).toContain("Fitness=5");
  });

  it("no alcanza la evaluación de un miembro de otro club", async () => {
    const database = await migratedDatabase();
    const scene = await seedScene(database);
    const readAt = await updatedAtOf(database, scene.playerId);

    const outcome = await callFunction(
      database,
      saveCall({ ...scene, clubId: await createOtherClub(database) }, readAt, [
        { categoryId: scene.fitnessId, rating: 9 },
      ]),
    );

    expect(outcome).toEqual({ outcome: "member_not_found" });
  });
});

describeConPostgres("la migración de guardar al día", () => {
  it("sólo service_role ejecuta la función", async () => {
    const database = await migratedDatabase();

    const grantees = await database.query(
      `select string_agg(r.rolname, ',' order by r.rolname)
         from pg_roles r
        where r.rolname in ('anon', 'authenticated', 'service_role')
          and has_function_privilege(r.rolname, 'public.${SAVE_SIGNATURE}', 'execute')`,
    );

    expect(grantees).toBe("service_role");
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
