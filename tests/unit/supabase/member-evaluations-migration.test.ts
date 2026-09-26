import { expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `public.evaluation_categories`, `public.member_evaluations` y
 * `public.member_evaluation_ratings` contra un Postgres desechable (#321, RF-1
 * y RF-3 del PRD de E9). La regla que manda es FR-055: ningún miembro lee una
 * nota por la base, ni la suya. Y una evaluación guardada conserva su propio
 * conjunto de categorías (RF-4): son sus valoraciones, no el catálogo actual.
 */

const SEEDED_CLUB = "victoria-seadragons";

/** Las diez categorías por defecto del SRD, en su orden. */
const DEFAULT_CATEGORIES = [
  "Fitness",
  "Speed",
  "Endurance",
  "Experience",
  "Game awareness",
  "Tactical",
  "Passing",
  "Ball control",
  "Defense",
  "Teamwork",
] as const;

const EVALUATION_TABLES = [
  "member_evaluations",
  "member_evaluation_ratings",
] as const;

const ALL_TABLES = ["evaluation_categories", ...EVALUATION_TABLES] as const;

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

/** Crea una identidad y su miembro en `clubId`, y devuelve su `user_id`. */
async function seedMember(
  database: TemporaryDatabase,
  clubId: string,
): Promise<string> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members (club_id, user_id, full_name, email)
     values ('${clubId}', '${userId}', 'Nerea Silva',
             '${userId}@example.test')`,
  );
  return userId;
}

function insertEvaluation(
  database: TemporaryDatabase,
  userId: string,
): Promise<RunResult> {
  return database.attempt(
    `insert into public.member_evaluations (user_id, club_id)
     select user_id, club_id from public.members where user_id = '${userId}'`,
  );
}

function seedEvaluation(
  database: TemporaryDatabase,
  userId: string,
): Promise<string> {
  return database.query(
    `insert into public.member_evaluations (user_id, club_id)
     select user_id, club_id from public.members where user_id = '${userId}'
     returning id`,
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

/** Guarda la valoración `rating` (una expresión SQL) de una categoría. */
function insertRating(
  database: TemporaryDatabase,
  evaluationId: string,
  categoryId: string,
  rating: string,
): Promise<RunResult> {
  return database.attempt(
    `insert into public.member_evaluation_ratings
       (evaluation_id, category_id, club_id, rating)
     select id, '${categoryId}', club_id, ${rating}
       from public.member_evaluations where id = '${evaluationId}'`,
  );
}

/** Un miembro evaluado en Fitness, con su evaluación y su categoría. */
async function seedEvaluatedMember(database: TemporaryDatabase): Promise<{
  readonly clubId: string;
  readonly userId: string;
  readonly evaluationId: string;
  readonly categoryId: string;
}> {
  const clubId = await seededClubId(database);
  const userId = await seedMember(database, clubId);
  const evaluationId = await seedEvaluation(database, userId);
  const categoryId = await categoryIdOf(database, clubId, "Fitness");
  const rating = await insertRating(database, evaluationId, categoryId, "7");
  expect(rating.code, rating.stderr).toBe(0);
  return { clubId, userId, evaluationId, categoryId };
}

function listCategories(
  database: TemporaryDatabase,
  clubId: string,
): Promise<string> {
  return database.query(
    `select name || ' activa=' || (deactivated_at is null)
       from public.evaluation_categories
      where club_id = '${clubId}'
      order by sort_order`,
  );
}

function count(database: TemporaryDatabase, table: string): Promise<string> {
  return database.query(`select count(*) from public.${table}`);
}

function columnsOf(
  database: TemporaryDatabase,
  table: string,
): Promise<string> {
  return database.query(
    `select column_name || ' ' || data_type || ' null=' || is_nullable
       from information_schema.columns
      where table_schema = 'public' and table_name = '${table}'
      order by column_name`,
  );
}

function expectRejectedBy(result: RunResult, constraint: string): void {
  expect(result.code).toBeGreaterThan(0);
  expect(result.stderr).toContain(constraint);
}

/** Lo que PostgREST monta antes de cada consulta de un usuario con sesión. */
function asAuthenticated(userId: string, sql: string): string {
  return `set role authenticated;
          set request.jwt.claims = '{"sub":"${userId}"}'; ${sql}`;
}

describeConPostgres("migración de las evaluaciones", () => {
  it("guarda de cada categoría su club, nombre, orden y fecha de desactivación", async () => {
    const database = await migratedDatabase();

    const columns = await columnsOf(database, "evaluation_categories");

    expect(columns.split("\n")).toEqual([
      "club_id uuid null=NO",
      "created_at timestamp with time zone null=NO",
      "deactivated_at timestamp with time zone null=YES",
      "id uuid null=NO",
      "name text null=NO",
      "sort_order integer null=NO",
    ]);
  });

  it("guarda de cada evaluación su miembro, su club y sus fechas", async () => {
    const database = await migratedDatabase();

    const columns = await columnsOf(database, "member_evaluations");

    expect(columns.split("\n")).toEqual([
      "club_id uuid null=NO",
      "created_at timestamp with time zone null=NO",
      "id uuid null=NO",
      "updated_at timestamp with time zone null=NO",
      "user_id uuid null=NO",
    ]);
  });

  it("guarda de cada valoración su evaluación, su categoría, su club y la nota", async () => {
    const database = await migratedDatabase();

    const columns = await columnsOf(database, "member_evaluation_ratings");

    expect(columns.split("\n")).toEqual([
      "category_id uuid null=NO",
      "club_id uuid null=NO",
      "evaluation_id uuid null=NO",
      "rating numeric null=NO",
    ]);
  });

  it("es idempotente: aplicada dos veces no falla ni duplica nada", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const despuesDeLaPrimera = await database.snapshot();

    const segunda = await applyRepositoryMigrations(database);

    expect(segunda.code, segunda.stderr).toBe(0);
    for (const table of ALL_TABLES) {
      expect(despuesDeLaPrimera).toMatch(new RegExp(`tabla ${table} rls=t`));
    }
    expect(await database.snapshot()).toBe(despuesDeLaPrimera);
    expect(await listCategories(database, clubId)).toBe(
      DEFAULT_CATEGORIES.map((name) => `${name} activa=true`).join("\n"),
    );
  });

  it("al repetirse no resucita una categoría que el club desactivó", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    await database.query(
      `update public.evaluation_categories set deactivated_at = now()
        where club_id = '${clubId}' and name = 'Tactical'`,
    );

    await applyRepositoryMigrations(database);

    expect(await listCategories(database, clubId)).toContain(
      "Tactical activa=false",
    );
  });
});

describeConPostgres("las categorías sembradas", () => {
  it("son las diez del SRD, activas y en su orden", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);

    const categories = await listCategories(database, clubId);

    expect(categories.split("\n")).toEqual(
      DEFAULT_CATEGORIES.map((name) => `${name} activa=true`),
    );
  });

  it("un club creado después de la migración nace con las diez", async () => {
    const database = await migratedDatabase();
    const otherClubId = await createOtherClub(database);

    const categories = await listCategories(database, otherClubId);

    expect(categories.split("\n")).toEqual(
      DEFAULT_CATEGORIES.map((name) => `${name} activa=true`),
    );
  });
});

describeConPostgres("las reglas de una categoría", () => {
  it("una desactivada trae su fecha y las activas la traen nula", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    await database.query(
      `update public.evaluation_categories
          set deactivated_at = '2026-09-01T10:00:00Z'
        where club_id = '${clubId}' and name = 'Speed'`,
    );

    const dates = await database.query(
      `select name || ' ' || coalesce(deactivated_at::date::text, 'nula')
         from public.evaluation_categories
        where club_id = '${clubId}' and name in ('Fitness', 'Speed')
        order by sort_order`,
    );

    expect(dates.split("\n")).toEqual(["Fitness nula", "Speed 2026-09-01"]);
  });

  it.each([
    ["igual", "Passing"],
    ["con otras mayúsculas", "PASSING"],
    ["con espacios alrededor", "  passing "],
  ])(
    "rechaza un nombre repetido dentro del club %s",
    async (_caso, repeated) => {
      const database = await migratedDatabase();
      const clubId = await seededClubId(database);

      const insercion = await database.attempt(
        `insert into public.evaluation_categories (club_id, name, sort_order)
         values ('${clubId}', '${repeated}', 11)`,
      );

      expectRejectedBy(insercion, "evaluation_categories_club_id_name_key");
    },
  );

  it("deja repetir un nombre en otro club", async () => {
    const database = await migratedDatabase();
    const otherClubId = await createOtherClub(database);

    const insercion = await database.attempt(
      `insert into public.evaluation_categories (club_id, name, sort_order)
       values ('${otherClubId}', 'Strength', 11),
              ('${await seededClubId(database)}', 'Strength', 11)`,
    );

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it.each([
    ["vacío", "''"],
    ["de solo espacios", "'   '"],
    ["de más de 40 caracteres", "repeat('x', 41)"],
  ])("rechaza un nombre %s", async (_caso, name) => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);

    const insercion = await database.attempt(
      `insert into public.evaluation_categories (club_id, name, sort_order)
       values ('${clubId}', ${name}, 11)`,
    );

    expectRejectedBy(insercion, "evaluation_categories_name_length");
  });

  it("no deja borrar una categoría que usa una evaluación guardada", async () => {
    // RF-4: una evaluación conserva sus categorías aunque el catálogo cambie.
    // Retirar una categoría es desactivarla, no borrarla.
    const database = await migratedDatabase();
    const { categoryId } = await seedEvaluatedMember(database);

    const borrado = await database.attempt(
      `delete from public.evaluation_categories where id = '${categoryId}'`,
    );

    expectRejectedBy(
      borrado,
      "member_evaluation_ratings_category_same_club_fkey",
    );
  });

  it("desactivar una categoría no toca las valoraciones que la usan", async () => {
    const database = await migratedDatabase();
    const { categoryId, evaluationId } = await seedEvaluatedMember(database);

    await database.query(
      `update public.evaluation_categories set deactivated_at = now()
        where id = '${categoryId}'`,
    );

    expect(
      await database.query(
        `select rating from public.member_evaluation_ratings
          where evaluation_id = '${evaluationId}'`,
      ),
    ).toBe("7");
  });
});

describeConPostgres("las reglas de una evaluación", () => {
  it("queda atada a un miembro de un club, con su valoración por categoría", async () => {
    const database = await migratedDatabase();
    const { userId, clubId } = await seedEvaluatedMember(database);

    const saved = await database.query(
      `select e.user_id || ' ' || e.club_id || ' ' || c.name || '=' || r.rating
         from public.member_evaluations e
         join public.member_evaluation_ratings r on r.evaluation_id = e.id
         join public.evaluation_categories c on c.id = r.category_id`,
    );

    expect(saved).toBe(`${userId} ${clubId} Fitness=7`);
  });

  it("rechaza la segunda evaluación de un miembro", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const userId = await seedMember(database, clubId);
    await seedEvaluation(database, userId);

    const segunda = await insertEvaluation(database, userId);

    expectRejectedBy(segunda, "member_evaluations_user_id_key");
  });

  it("rechaza una evaluación de un miembro con el club cambiado", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database, await seededClubId(database));
    const otherClubId = await createOtherClub(database);

    const insercion = await database.attempt(
      `insert into public.member_evaluations (user_id, club_id)
       values ('${userId}', '${otherClubId}')`,
    );

    expectRejectedBy(insercion, "member_evaluations_member_same_club_fkey");
  });

  it.each(["1", "10"])("acepta la valoración %s", async (rating) => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const evaluationId = await seedEvaluation(
      database,
      await seedMember(database, clubId),
    );
    const categoryId = await categoryIdOf(database, clubId, "Speed");

    const insercion = await insertRating(
      database,
      evaluationId,
      categoryId,
      rating,
    );

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it.each([
    ["por debajo de 1", "0"],
    ["por encima de 10", "11"],
    ["negativa", "-3"],
    ["con decimales", "5.5"],
    ["con decimales escrita como texto", "'7.25'"],
  ])("rechaza una valoración %s", async (_caso, rating) => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const evaluationId = await seedEvaluation(
      database,
      await seedMember(database, clubId),
    );
    const categoryId = await categoryIdOf(database, clubId, "Speed");

    const insercion = await insertRating(
      database,
      evaluationId,
      categoryId,
      rating,
    );

    expectRejectedBy(insercion, "member_evaluation_ratings_rating_check");
  });

  it("rechaza una categoría de otro club", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const evaluationId = await seedEvaluation(
      database,
      await seedMember(database, clubId),
    );
    const foreignCategoryId = await categoryIdOf(
      database,
      await createOtherClub(database),
      "Speed",
    );

    const insercion = await insertRating(
      database,
      evaluationId,
      foreignCategoryId,
      "6",
    );

    expectRejectedBy(
      insercion,
      "member_evaluation_ratings_category_same_club_fkey",
    );
  });

  it("rechaza valorar dos veces la misma categoría en una evaluación", async () => {
    const database = await migratedDatabase();
    const { evaluationId, categoryId } = await seedEvaluatedMember(database);

    const segunda = await insertRating(database, evaluationId, categoryId, "4");

    expectRejectedBy(segunda, "member_evaluation_ratings_pkey");
  });

  it("se borra con el miembro, y sus valoraciones con ella", async () => {
    const database = await migratedDatabase();
    const { userId } = await seedEvaluatedMember(database);

    await database.query(`delete from auth.users where id = '${userId}'`);

    expect(await count(database, "member_evaluations")).toBe("0");
    expect(await count(database, "member_evaluation_ratings")).toBe("0");
  });

  it("borrar un club sin miembros se lleva sus categorías", async () => {
    // La limpieza de los clubes desechables de las pruebas de integración
    // borra el club al final (#348).
    const database = await migratedDatabase();
    const otherClubId = await createOtherClub(database);

    await database.query(
      `delete from public.clubs where id = '${otherClubId}'`,
    );

    expect(
      await database.query(
        `select count(*) from public.evaluation_categories
          where club_id = '${otherClubId}'`,
      ),
    ).toBe("0");
  });
});

describeConPostgres("privilegios de las evaluaciones", () => {
  it.each(EVALUATION_TABLES)(
    "un usuario authenticated no lee ninguna fila de %s, ni la suya",
    async (table) => {
      const database = await migratedDatabase();
      const { userId } = await seedEvaluatedMember(database);

      const lectura = await database.attempt(
        asAuthenticated(userId, `select * from public.${table}`),
      );

      expect(lectura.code).toBeGreaterThan(0);
      expect(lectura.stderr).toContain(`permission denied for table ${table}`);
    },
  );

  it.each(EVALUATION_TABLES)(
    "aunque alguien le concediera leer %s, RLS no le devuelve ninguna fila",
    async (table) => {
      // La segunda capa de FR-055: si un `grant` futuro abriera la tabla por
      // descuido, que no haya ninguna policy sigue negándolo todo.
      const database = await migratedDatabase();
      const { userId } = await seedEvaluatedMember(database);
      await database.query(`grant select on public.${table} to authenticated`);

      const filas = await database.query(
        asAuthenticated(userId, `select count(*) from public.${table}`),
      );

      expect(filas.split("\n").at(-1)).toBe("0");
    },
  );

  it.each([
    [
      "crear una evaluación",
      "member_evaluations",
      "insert into public.member_evaluations (user_id, club_id) select user_id, club_id from public.members",
    ],
    [
      "cambiar una nota",
      "member_evaluation_ratings",
      "update public.member_evaluation_ratings set rating = 10",
    ],
    [
      "borrar una evaluación",
      "member_evaluations",
      "delete from public.member_evaluations",
    ],
    [
      "crear una categoría",
      "evaluation_categories",
      "insert into public.evaluation_categories (club_id, name, sort_order) select id, 'Strength', 11 from public.clubs",
    ],
  ] as const)(
    "no deja a un usuario authenticated %s",
    async (_accion, table, sql) => {
      const database = await migratedDatabase();
      const { userId } = await seedEvaluatedMember(database);

      const intento = await database.attempt(asAuthenticated(userId, sql));

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toContain(`permission denied for table ${table}`);
    },
  );

  it.each(ALL_TABLES)("anon no recibe nada de %s", async (table) => {
    const database = await migratedDatabase();
    await seedEvaluatedMember(database);

    const lectura = await database.attempt(
      `set role anon; select * from public.${table}`,
    );

    expect(lectura.code).toBeGreaterThan(0);
    expect(lectura.stderr).toContain(`permission denied for table ${table}`);
  });

  it("deja a anon y authenticated sin ningún privilegio", async () => {
    const database = await migratedDatabase();

    const privilegios = await database.query(
      `select count(*) from information_schema.table_privileges
        where table_schema = 'public'
          and table_name in ('${ALL_TABLES.join("', '")}')
          and grantee in ('anon', 'authenticated')`,
    );

    expect(privilegios).toBe("0");
  });

  it("service_role escribe y lee las tres tablas", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const userId = await seedMember(database, clubId);

    const escritura = await database.attempt(
      `set role service_role;
       insert into public.evaluation_categories (club_id, name, sort_order)
       values ('${clubId}', 'Strength', 11);
       with evaluation as (
         insert into public.member_evaluations (user_id, club_id)
         values ('${userId}', '${clubId}')
         returning id, club_id
       )
       insert into public.member_evaluation_ratings
         (evaluation_id, category_id, club_id, rating)
       select e.id, c.id, e.club_id, 8
         from evaluation e
         join public.evaluation_categories c
           on c.club_id = e.club_id and c.name = 'Strength';
       select count(*) from public.member_evaluation_ratings r
         join public.member_evaluations e on e.id = r.evaluation_id
        where e.user_id = '${userId}';`,
    );

    expect(escritura.code, escritura.stderr).toBe(0);
    expect(escritura.stdout).toMatch(/^\s*1\s*$/m);
  });
});
