import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0033_manage_evaluation_categories.sql` contra un Postgres desechable (#320,
 * RF-3 y RF-4 del PRD de E9). El club añade, renombra, reordena, desactiva y
 * reactiva sus categorías sin tocar ninguna evaluación guardada, y una
 * evaluación vieja se pone al día sólo cuando alguien lo pide.
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
): Promise<string> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status)
     values ('${clubId}', '${userId}', 'Nerea Silva',
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

/** Los nombres del catálogo en el orden del club, `(off)` si desactivada. */
async function catalogOf(
  database: TemporaryDatabase,
  clubId: string,
): Promise<string[]> {
  const rows = await database.query(
    `select name || case when deactivated_at is null then '' else ' (off)' end
       from public.evaluation_categories
      where club_id = '${clubId}'
      order by sort_order, name`,
  );
  return rows === "" ? [] : rows.split("\n");
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
      order by c.sort_order, c.name`,
  );
  return rows === "" ? [] : rows.split("\n");
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

function createCategory(
  database: TemporaryDatabase,
  clubId: string,
  name: string,
): Promise<Outcome> {
  return callFunction(
    database,
    `create_evaluation_category('${clubId}', '${name}')`,
  );
}

function setActive(
  database: TemporaryDatabase,
  target: { readonly clubId: string; readonly categoryId: string },
  isActive: boolean,
): Promise<Outcome> {
  return callFunction(
    database,
    `set_evaluation_category_active('${target.clubId}', '${target.categoryId}', ${isActive})`,
  );
}

function refreshEvaluation(
  database: TemporaryDatabase,
  clubId: string,
  userId: string,
): Promise<Outcome> {
  return callFunction(
    database,
    `refresh_member_evaluation('${clubId}', '${userId}')`,
  );
}

async function evaluatedMember(database: TemporaryDatabase): Promise<{
  readonly clubId: string;
  readonly userId: string;
}> {
  const clubId = await seededClubId(database);
  const userId = await seedMember(database, clubId);
  expect(
    await callFunction(
      database,
      `create_member_evaluation('${clubId}', '${userId}')`,
    ),
  ).toEqual({ outcome: "created" });
  return { clubId, userId };
}

describeConPostgres("añadir una categoría", () => {
  it("la guarda recortada al final del catálogo", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);

    const outcome = await createCategory(database, clubId, "  Breath hold ");

    expect(outcome).toEqual({
      outcome: "created",
      category_id: await categoryIdOf(database, clubId, "Breath hold"),
    });
    const catalog = await catalogOf(database, clubId);
    expect(catalog).toHaveLength(DEFAULT_CATEGORY_COUNT + 1);
    expect(catalog.at(-1)).toBe("Breath hold");
  });

  it("rechaza un nombre que ya usa otra, sin distinguir mayúsculas", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);

    const outcome = await createCategory(database, clubId, " fitness ");

    expect(outcome).toEqual({ outcome: "name_taken" });
    expect(await catalogOf(database, clubId)).toHaveLength(
      DEFAULT_CATEGORY_COUNT,
    );
  });

  it("cuenta como repetido el nombre de una desactivada", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const categoryId = await categoryIdOf(database, clubId, "Teamwork");
    await setActive(database, { clubId, categoryId }, false);

    const outcome = await createCategory(database, clubId, "Teamwork");

    expect(outcome).toEqual({ outcome: "name_taken" });
  });

  it("deja el mismo nombre libre en otro club", async () => {
    const database = await migratedDatabase();
    const otherClubId = await createOtherClub(database);

    const outcome = await createCategory(database, otherClubId, "Breath hold");

    expect(outcome.outcome).toBe("created");
  });

  it("no toca ninguna evaluación guardada", async () => {
    const database = await migratedDatabase();
    const { clubId, userId } = await evaluatedMember(database);
    const updatedAt = await updatedAtOf(database, userId);

    await createCategory(database, clubId, "Breath hold");

    expect(await ratingsOf(database, userId)).toHaveLength(
      DEFAULT_CATEGORY_COUNT,
    );
    expect(await updatedAtOf(database, userId)).toBe(updatedAt);
  });
});

describeConPostgres("renombrar una categoría", () => {
  it("cambia el nombre que ven las evaluaciones que la usan", async () => {
    const database = await migratedDatabase();
    const { clubId, userId } = await evaluatedMember(database);
    const categoryId = await categoryIdOf(database, clubId, "Fitness");

    const outcome = await callFunction(
      database,
      `rename_evaluation_category('${clubId}', '${categoryId}', ' Stamina ')`,
    );

    expect(outcome).toEqual({ outcome: "renamed" });
    expect((await ratingsOf(database, userId))[0]).toBe("Stamina=5");
  });

  it("deja cambiar sólo las mayúsculas de su propio nombre", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const categoryId = await categoryIdOf(database, clubId, "Teamwork");

    const outcome = await callFunction(
      database,
      `rename_evaluation_category('${clubId}', '${categoryId}', 'TEAMWORK')`,
    );

    expect(outcome).toEqual({ outcome: "renamed" });
  });

  it("rechaza el nombre de otra categoría del club", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const categoryId = await categoryIdOf(database, clubId, "Teamwork");

    const outcome = await callFunction(
      database,
      `rename_evaluation_category('${clubId}', '${categoryId}', 'Speed')`,
    );

    expect(outcome).toEqual({ outcome: "name_taken" });
    expect(await catalogOf(database, clubId)).toContain("Teamwork");
  });

  it("no alcanza una categoría de otro club", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const categoryId = await categoryIdOf(database, clubId, "Teamwork");
    const otherClubId = await createOtherClub(database);

    const outcome = await callFunction(
      database,
      `rename_evaluation_category('${otherClubId}', '${categoryId}', 'Stamina')`,
    );

    expect(outcome).toEqual({ outcome: "not_found" });
  });
});

describeConPostgres("desactivar y reactivar una categoría", () => {
  it("desactivarla no la quita de las evaluaciones guardadas", async () => {
    const database = await migratedDatabase();
    const { clubId, userId } = await evaluatedMember(database);
    const categoryId = await categoryIdOf(database, clubId, "Teamwork");

    const outcome = await setActive(database, { clubId, categoryId }, false);

    expect(outcome).toEqual({ outcome: "changed" });
    expect(await catalogOf(database, clubId)).toContain("Teamwork (off)");
    expect(await ratingsOf(database, userId)).toContain("Teamwork=5");
  });

  it("dice que no cambió nada si ya estaba así", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const categoryId = await categoryIdOf(database, clubId, "Teamwork");

    const outcome = await setActive(database, { clubId, categoryId }, true);

    expect(outcome).toEqual({ outcome: "unchanged" });
  });

  it("reactivada vuelve al final del catálogo", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const categoryId = await categoryIdOf(database, clubId, "Fitness");
    await setActive(database, { clubId, categoryId }, false);

    const outcome = await setActive(database, { clubId, categoryId }, true);

    expect(outcome).toEqual({ outcome: "changed" });
    expect((await catalogOf(database, clubId)).at(-1)).toBe("Fitness");
  });

  it("no alcanza una categoría de otro club", async () => {
    const database = await migratedDatabase();
    const categoryId = await categoryIdOf(
      database,
      await seededClubId(database),
      "Fitness",
    );
    const otherClubId = await createOtherClub(database);

    const outcome = await setActive(
      database,
      { clubId: otherClubId, categoryId },
      false,
    );

    expect(outcome).toEqual({ outcome: "not_found" });
  });
});

describeConPostgres("reordenar las categorías", () => {
  async function activeIdsReversed(
    database: TemporaryDatabase,
    clubId: string,
  ): Promise<string> {
    return database.query(
      `select string_agg(id::text, ',' order by sort_order desc)
         from public.evaluation_categories
        where club_id = '${clubId}' and deactivated_at is null`,
    );
  }

  it("aplica el orden nuevo de las activas", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const ids = await activeIdsReversed(database, clubId);

    const outcome = await callFunction(
      database,
      `reorder_evaluation_categories('${clubId}', '{${ids}}'::uuid[])`,
    );

    expect(outcome).toEqual({ outcome: "reordered" });
    const catalog = await catalogOf(database, clubId);
    expect(catalog[0]).toBe("Teamwork");
    expect(catalog.at(-1)).toBe("Fitness");
  });

  it("no aplica un orden al que le falta una activa", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const ids = (await activeIdsReversed(database, clubId))
      .split(",")
      .slice(1)
      .join(",");

    const outcome = await callFunction(
      database,
      `reorder_evaluation_categories('${clubId}', '{${ids}}'::uuid[])`,
    );

    expect(outcome).toEqual({ outcome: "categories_changed" });
    expect((await catalogOf(database, clubId))[0]).toBe("Fitness");
  });
});

describeConPostgres("poner al día una evaluación", () => {
  it("entran las nuevas en 5, salen las desactivadas y mueve la fecha", async () => {
    const database = await migratedDatabase();
    const { clubId, userId } = await evaluatedMember(database);
    const updatedAt = await updatedAtOf(database, userId);
    await createCategory(database, clubId, "Breath hold");
    const teamworkId = await categoryIdOf(database, clubId, "Teamwork");
    await setActive(database, { clubId, categoryId: teamworkId }, false);

    const outcome = await refreshEvaluation(database, clubId, userId);

    expect(outcome).toEqual({
      outcome: "refreshed",
      added_count: 1,
      removed_count: 1,
    });
    const ratings = await ratingsOf(database, userId);
    expect(ratings).toHaveLength(DEFAULT_CATEGORY_COUNT);
    expect(ratings).toContain("Breath hold=5");
    expect(ratings).not.toContain("Teamwork=5");
    expect(await updatedAtOf(database, userId)).not.toBe(updatedAt);
  });

  it("conserva las valoraciones de las categorías que siguen", async () => {
    const database = await migratedDatabase();
    const { clubId, userId } = await evaluatedMember(database);
    await database.query(
      `update public.member_evaluation_ratings set rating = 9
        where category_id = '${await categoryIdOf(database, clubId, "Fitness")}'`,
    );
    await createCategory(database, clubId, "Breath hold");

    await refreshEvaluation(database, clubId, userId);

    expect(await ratingsOf(database, userId)).toContain("Fitness=9");
  });

  it("dice que ya estaba al día y no toca la fecha", async () => {
    const database = await migratedDatabase();
    const { clubId, userId } = await evaluatedMember(database);
    const updatedAt = await updatedAtOf(database, userId);

    const outcome = await refreshEvaluation(database, clubId, userId);

    expect(outcome).toEqual({ outcome: "already_current" });
    expect(await updatedAtOf(database, userId)).toBe(updatedAt);
  });

  it("no vacía una evaluación si el club no tiene categorías activas", async () => {
    const database = await migratedDatabase();
    const { clubId, userId } = await evaluatedMember(database);
    await database.query(
      `update public.evaluation_categories set deactivated_at = now()
        where club_id = '${clubId}'`,
    );

    const outcome = await refreshEvaluation(database, clubId, userId);

    expect(outcome).toEqual({ outcome: "no_active_categories" });
    expect(await ratingsOf(database, userId)).toHaveLength(
      DEFAULT_CATEGORY_COUNT,
    );
  });

  it("dice que no hay evaluación si el miembro no tiene", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const userId = await seedMember(database, clubId);

    const outcome = await refreshEvaluation(database, clubId, userId);

    expect(outcome).toEqual({ outcome: "evaluation_not_found" });
  });

  it("no pone al día la de un miembro dado de baja", async () => {
    const database = await migratedDatabase();
    const { clubId, userId } = await evaluatedMember(database);
    await createCategory(database, clubId, "Breath hold");
    await database.query(
      `update public.members set account_status = 'inactive'
        where user_id = '${userId}'`,
    );

    const outcome = await refreshEvaluation(database, clubId, userId);

    expect(outcome).toEqual({ outcome: "member_inactive" });
    expect(await ratingsOf(database, userId)).toHaveLength(
      DEFAULT_CATEGORY_COUNT,
    );
  });

  it("no alcanza la evaluación de un miembro de otro club", async () => {
    const database = await migratedDatabase();
    const { userId } = await evaluatedMember(database);
    const otherClubId = await createOtherClub(database);

    const outcome = await refreshEvaluation(database, otherClubId, userId);

    expect(outcome).toEqual({ outcome: "member_not_found" });
  });
});

describeConPostgres("quién puede llamar a las funciones", () => {
  it.each([
    "create_evaluation_category(uuid, text)",
    "rename_evaluation_category(uuid, uuid, text)",
    "reorder_evaluation_categories(uuid, uuid[])",
    "set_evaluation_category_active(uuid, uuid, boolean)",
    "refresh_member_evaluation(uuid, uuid)",
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
