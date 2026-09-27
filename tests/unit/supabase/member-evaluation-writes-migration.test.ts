import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0032_member_evaluation_writes.sql` contra un Postgres desechable (#319,
 * RF-1 del PRD de E9). Crear una evaluación siembra todas sus valoraciones, y
 * guardar toca varias a la vez contra la fecha que se leyó: las dos cosas van
 * en una función para que un fallo a medias no deje una evaluación partida.
 */

const SEEDED_CLUB = "victoria-seadragons";
const DEFAULT_CATEGORY_COUNT = 10;

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
  accountStatus = "active",
): Promise<string> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status)
     values ('${clubId}', '${userId}', 'Nerea Silva',
             '${userId}@example.test', '${accountStatus}')`,
  );
  return userId;
}

async function callFunction(
  database: TemporaryDatabase,
  call: string,
): Promise<Outcome> {
  return JSON.parse(await database.query(`select public.${call}`)) as Outcome;
}

function createEvaluation(
  database: TemporaryDatabase,
  clubId: string,
  userId: string,
): Promise<Outcome> {
  return callFunction(
    database,
    `create_member_evaluation('${clubId}', '${userId}')`,
  );
}

type RatingInput = { readonly categoryId: string; readonly rating: number };

function saveRatingsCall(
  target: { readonly clubId: string; readonly userId: string },
  expectedUpdatedAt: string,
  ratings: readonly RatingInput[],
): string {
  const json = JSON.stringify(
    ratings.map(({ categoryId, rating }) => ({
      category_id: categoryId,
      rating,
    })),
  );
  return `save_member_evaluation_ratings('${target.clubId}', '${target.userId}', '${expectedUpdatedAt}', '${json}'::jsonb)`;
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

/** `nombre=valoración` en el orden del catálogo. */
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
      order by c.sort_order`,
  );
  return rows === "" ? [] : rows.split("\n");
}

function countEvaluations(
  database: TemporaryDatabase,
  userId: string,
): Promise<string> {
  return database.query(
    `select count(*) from public.member_evaluations
      where user_id = '${userId}'`,
  );
}

async function evaluatedMember(database: TemporaryDatabase): Promise<{
  readonly clubId: string;
  readonly userId: string;
  readonly fitnessId: string;
  readonly speedId: string;
}> {
  const clubId = await seededClubId(database);
  const userId = await seedMember(database, clubId);
  expect(await createEvaluation(database, clubId, userId)).toEqual({
    outcome: "created",
  });
  return {
    clubId,
    userId,
    fitnessId: await categoryIdOf(database, clubId, "Fitness"),
    speedId: await categoryIdOf(database, clubId, "Speed"),
  };
}

describeConPostgres("crear una evaluación", () => {
  it("nace con todas las categorías activas del club en 5", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const userId = await seedMember(database, clubId);
    await database.query(
      `update public.evaluation_categories set deactivated_at = now()
        where club_id = '${clubId}' and name = 'Teamwork'`,
    );

    const outcome = await createEvaluation(database, clubId, userId);

    expect(outcome).toEqual({ outcome: "created" });
    const ratings = await ratingsOf(database, userId);
    expect(ratings).toHaveLength(DEFAULT_CATEGORY_COUNT - 1);
    expect(ratings.every((entry) => entry.endsWith("=5"))).toBe(true);
    expect(ratings).not.toContain("Teamwork=5");
  });

  it("no crea nada si el club no tiene categorías activas", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const userId = await seedMember(database, clubId);
    await database.query(
      `update public.evaluation_categories set deactivated_at = now()
        where club_id = '${clubId}'`,
    );

    const outcome = await createEvaluation(database, clubId, userId);

    expect(outcome).toEqual({ outcome: "no_active_categories" });
    expect(await countEvaluations(database, userId)).toBe("0");
  });

  it("no evalúa a un miembro dado de baja", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const userId = await seedMember(database, clubId, "inactive");

    const outcome = await createEvaluation(database, clubId, userId);

    expect(outcome).toEqual({ outcome: "member_inactive" });
    expect(await countEvaluations(database, userId)).toBe("0");
  });

  it("no alcanza a un miembro de otro club", async () => {
    const database = await migratedDatabase();
    const otherClubId = await createOtherClub(database);
    const userId = await seedMember(database, otherClubId);

    const outcome = await createEvaluation(
      database,
      await seededClubId(database),
      userId,
    );

    expect(outcome).toEqual({ outcome: "member_not_found" });
    expect(await countEvaluations(database, userId)).toBe("0");
  });

  it("no crea una segunda evaluación del mismo miembro", async () => {
    const database = await migratedDatabase();
    const { clubId, userId } = await evaluatedMember(database);

    const outcome = await createEvaluation(database, clubId, userId);

    expect(outcome).toEqual({ outcome: "already_exists" });
    expect(await countEvaluations(database, userId)).toBe("1");
  });
});

describeConPostgres("guardar valoraciones", () => {
  it("guarda las que llegan, deja las demás y mueve la fecha", async () => {
    const database = await migratedDatabase();
    const member = await evaluatedMember(database);
    const readAt = await updatedAtOf(database, member.userId);

    const outcome = await callFunction(
      database,
      saveRatingsCall(member, readAt, [
        { categoryId: member.fitnessId, rating: 9 },
        { categoryId: member.speedId, rating: 2 },
      ]),
    );

    expect(outcome).toEqual({ outcome: "saved" });
    const ratings = await ratingsOf(database, member.userId);
    expect(ratings.slice(0, 3)).toEqual([
      "Fitness=9",
      "Speed=2",
      "Endurance=5",
    ]);
    expect(await updatedAtOf(database, member.userId)).not.toBe(readAt);
  });

  it("no pisa un cambio hecho desde que se leyó", async () => {
    const database = await migratedDatabase();
    const member = await evaluatedMember(database);
    const readAt = await updatedAtOf(database, member.userId);
    await callFunction(
      database,
      saveRatingsCall(member, readAt, [
        { categoryId: member.fitnessId, rating: 8 },
      ]),
    );

    const outcome = await callFunction(
      database,
      saveRatingsCall(member, readAt, [
        { categoryId: member.fitnessId, rating: 3 },
      ]),
    );

    expect(outcome).toEqual({ outcome: "evaluation_changed" });
    expect(await ratingsOf(database, member.userId)).toContain("Fitness=8");
  });

  it("rechaza una categoría que no es de la evaluación sin escribir nada", async () => {
    const database = await migratedDatabase();
    const member = await evaluatedMember(database);
    const readAt = await updatedAtOf(database, member.userId);
    const lateCategoryId = await database.query(
      `insert into public.evaluation_categories (club_id, name, sort_order)
       values ('${member.clubId}', 'Breath hold', 11) returning id`,
    );

    const outcome = await callFunction(
      database,
      saveRatingsCall(member, readAt, [
        { categoryId: member.fitnessId, rating: 9 },
        { categoryId: lateCategoryId, rating: 7 },
      ]),
    );

    expect(outcome).toEqual({
      outcome: "unknown_category",
      category_id: lateCategoryId,
    });
    expect(await ratingsOf(database, member.userId)).toContain("Fitness=5");
    expect(await updatedAtOf(database, member.userId)).toBe(readAt);
  });

  it("rechaza una valoración fuera de rango sin escribir nada", async () => {
    const database = await migratedDatabase();
    const member = await evaluatedMember(database);
    const readAt = await updatedAtOf(database, member.userId);

    const attempt = await database.attempt(
      `select public.${saveRatingsCall(member, readAt, [
        { categoryId: member.fitnessId, rating: 9 },
        { categoryId: member.speedId, rating: 11 },
      ])}`,
    );

    expect(attempt.code).not.toBe(0);
    expect(await ratingsOf(database, member.userId)).toContain("Fitness=5");
  });

  it("dice que no hay evaluación si el miembro no tiene", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const userId = await seedMember(database, clubId);

    const outcome = await callFunction(
      database,
      saveRatingsCall({ clubId, userId }, "2026-09-27T00:00:00Z", []),
    );

    expect(outcome).toEqual({ outcome: "evaluation_not_found" });
  });

  it("no guarda la evaluación de un miembro dado de baja", async () => {
    const database = await migratedDatabase();
    const member = await evaluatedMember(database);
    const readAt = await updatedAtOf(database, member.userId);
    await database.query(
      `update public.members set account_status = 'inactive'
        where user_id = '${member.userId}'`,
    );

    const outcome = await callFunction(
      database,
      saveRatingsCall(member, readAt, [
        { categoryId: member.fitnessId, rating: 9 },
      ]),
    );

    expect(outcome).toEqual({ outcome: "member_inactive" });
    expect(await ratingsOf(database, member.userId)).toContain("Fitness=5");
  });

  it("no alcanza la evaluación de un miembro de otro club", async () => {
    const database = await migratedDatabase();
    const member = await evaluatedMember(database);
    const readAt = await updatedAtOf(database, member.userId);
    const otherClubId = await createOtherClub(database);

    const outcome = await callFunction(
      database,
      saveRatingsCall({ clubId: otherClubId, userId: member.userId }, readAt, [
        { categoryId: member.fitnessId, rating: 9 },
      ]),
    );

    expect(outcome).toEqual({ outcome: "member_not_found" });
  });
});

describeConPostgres("quién puede llamar a las funciones", () => {
  it.each([
    "create_member_evaluation(uuid, uuid)",
    "save_member_evaluation_ratings(uuid, uuid, timestamptz, jsonb)",
  ])("sólo service_role ejecuta %s", async (signature) => {
    const database = await migratedDatabase();

    const grantees = await database.query(
      `select string_agg(r.rolname, ',' order by r.rolname)
         from pg_roles r
        where r.rolname in ('anon', 'authenticated', 'service_role')
          and has_function_privilege(r.rolname, 'public.${signature}', 'execute')`,
    );

    expect(grantees).toBe("service_role");
  });
});
