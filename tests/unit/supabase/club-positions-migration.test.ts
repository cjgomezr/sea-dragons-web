import { expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  applyRepositoryMigrations,
  databaseBeforeMigration,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0025_club_positions.sql` contra un Postgres desechable (#298, RF-7 del PRD
 * de E18a). Las posiciones de juego dejan de ser un `check` fijo y pasan a un
 * catálogo por club, con un nombre por idioma, un orden que decide el club y
 * una fecha de archivo en vez de un borrado. Se siembran las tres de hoy y
 * cada miembro que ya tenía posición queda apuntando a la de su club.
 */

const THIS_TICKETS_MIGRATION = "0025";

const SEEDED_CLUB = "victoria-seadragons";

/** Los textos de `position.*` en `src/lib/i18n/messages/{en,es}.ts`, en el
 * orden del SRD que hoy sigue el directorio. */
const TODAYS_POSITIONS = [
  "Goalkeeper|Portería",
  "Defender|Defensa",
  "Forward|Ataque",
] as const;

/** Envuelve `sql` en el `set role` que PostgREST hace antes de cada consulta,
 * con `userId` como el `sub` del JWT cuando hace falta una sesión. */
function asRole(
  role: "anon" | "authenticated" | "service_role",
  sql: string,
  userId?: string,
): string {
  const claims = userId
    ? `set request.jwt.claims = '{"sub":"${userId}"}';`
    : "";
  return `set role ${role}; ${claims} ${sql}`;
}

function clubIdOf(database: TemporaryDatabase, slug: string): Promise<string> {
  return database.query(`select id from public.clubs where slug = '${slug}'`);
}

async function createOtherClub(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `insert into public.clubs (slug, name) values ('otro-club', 'Otro Club')
     returning id`,
  );
}

/** Da de alta una posición con su nombre en inglés en `clubId`. */
async function createPosition(
  database: TemporaryDatabase,
  clubId: string,
  englishName: string,
): Promise<string> {
  const positionId = await database.query(
    `insert into public.club_positions (club_id, sort_order)
     values ('${clubId}', 99) returning id`,
  );
  await database.query(
    `insert into public.club_position_names (position_id, club_id, locale, name)
     values ('${positionId}', '${clubId}', 'en', '${englishName}')`,
  );
  return positionId;
}

function seededPositionId(
  database: TemporaryDatabase,
  englishName: string,
): Promise<string> {
  return database.query(
    `select n.position_id
       from public.club_position_names n
       join public.clubs c on c.id = n.club_id
      where c.slug = '${SEEDED_CLUB}' and n.locale = 'en'
        and n.name = '${englishName}'`,
  );
}

/**
 * Inserta un miembro del club sembrado con la posición `position` (una
 * expresión SQL: `'Forward'` o `null`) y devuelve su `user_id`.
 */
async function insertMember(
  database: TemporaryDatabase,
  position: string,
): Promise<string> {
  const clubId = await clubIdOf(database, SEEDED_CLUB);
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members (club_id, user_id, full_name, email, position)
     values ('${clubId}', '${userId}', 'Nerea Silva',
             '${userId}@example.test', ${position})`,
  );
  return userId;
}

/** La posición a la que apunta el miembro, por su nombre en inglés. */
function memberPositionName(
  database: TemporaryDatabase,
  userId: string,
): Promise<string> {
  return database.query(
    `select coalesce(n.name, 'ninguna')
       from public.members m
       left join public.club_position_names n
         on n.position_id = m.position_id and n.locale = 'en'
      where m.user_id = '${userId}'`,
  );
}

function listSeededPositions(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `select en.name || '|' || es.name
       from public.club_positions p
       join public.clubs c on c.id = p.club_id
       join public.club_position_names en
         on en.position_id = p.id and en.locale = 'en'
       join public.club_position_names es
         on es.position_id = p.id and es.locale = 'es'
      where c.slug = '${SEEDED_CLUB}'
      order by p.sort_order`,
  );
}

function expectRejectedBy(result: RunResult, constraint: string): void {
  expect(result.code).toBeGreaterThan(0);
  expect(result.stderr).toContain(constraint);
}

describeConPostgres("las posiciones sembradas", () => {
  it("son Goalkeeper, Defender y Forward, en el orden de hoy", async () => {
    const database = await migratedDatabase();

    const positions = await listSeededPositions(database);

    expect(positions.split("\n").map((row) => row.split("|")[0])).toEqual([
      "Goalkeeper",
      "Defender",
      "Forward",
    ]);
  });

  it("traen el nombre en inglés y en español de los catálogos", async () => {
    const database = await migratedDatabase();

    const positions = await listSeededPositions(database);

    expect(positions.split("\n")).toEqual([...TODAYS_POSITIONS]);
  });

  it("un club creado después de la migración nace con las tres", async () => {
    const database = await migratedDatabase();

    const otherClub = await createOtherClub(database);
    const positions = await database.query(
      `select n.name from public.club_positions p
         join public.club_position_names n
           on n.position_id = p.id and n.locale = 'en'
        where p.club_id = '${otherClub}'
        order by p.sort_order`,
    );

    expect(positions.split("\n")).toEqual([
      "Goalkeeper",
      "Defender",
      "Forward",
    ]);
  });

  it("dejan insertar un miembro con posición en un club nuevo", async () => {
    const database = await migratedDatabase();
    const otherClub = await createOtherClub(database);

    const saved = await database.query(
      `insert into public.members (user_id, club_id, full_name, position)
       values (gen_random_uuid(), '${otherClub}', 'Nueva Socia', 'Goalkeeper')
       returning position`,
    );

    expect(saved).toBe("Goalkeeper");
  });

  it("nacen activas, con la fecha de archivo nula", async () => {
    const database = await migratedDatabase();

    const archived = await database.query(
      "select count(*) from public.club_positions where archived_at is not null",
    );

    expect(archived).toBe("0");
  });
});

describeConPostgres("el archivo de una posición", () => {
  it("guarda la fecha en que se archivó y deja nulas las activas", async () => {
    const database = await migratedDatabase();
    const forwardId = await seededPositionId(database, "Forward");

    await database.query(
      `update public.club_positions
          set archived_at = '2026-09-24 10:00:00+00'
        where id = '${forwardId}'`,
    );

    expect(
      await database.query(
        `select coalesce(to_char(p.archived_at at time zone 'UTC',
                                 'YYYY-MM-DD HH24:MI'), 'activa')
           from public.club_positions p
          order by p.sort_order`,
      ),
    ).toBe(["activa", "activa", "2026-09-24 10:00"].join("\n"));
  });

  it("no se lleva la posición de quien la tenía", async () => {
    const database = await migratedDatabase();
    const userId = await insertMember(database, "'Forward'");
    const forwardId = await seededPositionId(database, "Forward");

    await database.query(
      `update public.club_positions set archived_at = now()
        where id = '${forwardId}'`,
    );

    expect(await memberPositionName(database, userId)).toBe("Forward");
  });
});

describeConPostgres("las restricciones de las posiciones", () => {
  it("rechaza dos posiciones con el mismo nombre en el mismo club e idioma", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);

    const duplicate = await database.attempt(
      `with p as (
         insert into public.club_positions (club_id, sort_order)
         values ('${clubId}', 4) returning id
       )
       insert into public.club_position_names (position_id, club_id, locale, name)
       select id, '${clubId}', 'es', 'Defensa' from p`,
    );

    expectRejectedBy(duplicate, "club_position_names_club_id_locale_name_key");
  });

  it("rechaza el nombre repetido aunque cambien las mayúsculas y los espacios", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);

    const duplicate = await database.attempt(
      `with p as (
         insert into public.club_positions (club_id, sort_order)
         values ('${clubId}', 4) returning id
       )
       insert into public.club_position_names (position_id, club_id, locale, name)
       select id, '${clubId}', 'en', '  forward ' from p`,
    );

    expectRejectedBy(duplicate, "club_position_names_club_id_locale_name_key");
  });

  it("acepta el mismo nombre en otro club", async () => {
    const database = await migratedDatabase();
    const otherClubId = await createOtherClub(database);

    const other = await database.attempt(
      `with p as (
         insert into public.club_positions (club_id, sort_order)
         values ('${otherClubId}', 1) returning id
       )
       insert into public.club_position_names (position_id, club_id, locale, name)
       select id, '${otherClubId}', 'en', 'Forward' from p`,
    );

    expect(other.code, other.stderr).toBe(0);
  });

  it("rechaza un nombre de una posición de otro club", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    const otherClubId = await createOtherClub(database);
    const utilityId = await createPosition(database, clubId, "Utility");

    const crossed = await database.attempt(
      `insert into public.club_position_names (position_id, club_id, locale, name)
       values ('${utilityId}', '${otherClubId}', 'es', 'Comodin')`,
    );

    expectRejectedBy(crossed, "club_position_names_position_same_club_fkey");
  });

  it("rechaza un idioma que la aplicación no tiene", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    const forwardId = await seededPositionId(database, "Forward");

    const french = await database.attempt(
      `insert into public.club_position_names (position_id, club_id, locale, name)
       values ('${forwardId}', '${clubId}', 'fr', 'Attaquant')`,
    );

    expectRejectedBy(french, "club_position_names_locale_check");
  });

  it("rechaza un nombre hecho sólo de espacios", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    const forwardId = await seededPositionId(database, "Forward");

    const blank = await database.attempt(
      `update public.club_position_names set name = '   '
        where position_id = '${forwardId}' and club_id = '${clubId}'
          and locale = 'es'`,
    );

    expectRejectedBy(blank, "club_position_names_name_length");
  });

  it("rechaza asignar a un miembro una posición de otro club", async () => {
    const database = await migratedDatabase();
    const userId = await insertMember(database, "null");
    const otherClubId = await createOtherClub(database);
    const foreignId = await createPosition(database, otherClubId, "Striker");

    const assignment = await database.attempt(
      `update public.members set position_id = '${foreignId}'
        where user_id = '${userId}'`,
    );

    expectRejectedBy(assignment, "members_position_same_club_fkey");
  });
});

describeConPostgres("los miembros que ya tenían posición", () => {
  it("quedan apuntando a la posición de su club, sin perder el dato", async () => {
    const database = await databaseBeforeMigration(THIS_TICKETS_MIGRATION);
    const goalkeeper = await insertMember(database, "'Goalkeeper'");
    const defender = await insertMember(database, "'Defender'");
    const forward = await insertMember(database, "'Forward'");
    const withoutPosition = await insertMember(database, "null");

    const applied = await applyRepositoryMigrations(database);

    expect(applied.code, applied.stderr).toBe(0);
    expect(await memberPositionName(database, goalkeeper)).toBe("Goalkeeper");
    expect(await memberPositionName(database, defender)).toBe("Defender");
    expect(await memberPositionName(database, forward)).toBe("Forward");
    expect(await memberPositionName(database, withoutPosition)).toBe("ninguna");
  });

  it("siguen apuntando a la correcta cuando la aplicación cambia la posición de texto", async () => {
    // Hasta el #299 la aplicación escribe `members.position`: la referencia al
    // catálogo no puede quedarse con la posición de antes.
    const database = await migratedDatabase();
    const userId = await insertMember(database, "'Goalkeeper'");

    await database.query(
      asRole(
        "service_role",
        `update public.members set position = 'Forward'
          where user_id = '${userId}'`,
      ),
    );

    expect(await memberPositionName(database, userId)).toBe("Forward");
  });

  it("aceptan una posición que el club añadió a su catálogo", async () => {
    // Las tres grafías fijas del `check` de `0016` ya no deciden: el catálogo sí.
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    await createPosition(database, clubId, "Utility");
    const userId = await insertMember(database, "null");

    const assignment = await database.attempt(
      `update public.members set position = 'Utility'
        where user_id = '${userId}'`,
    );

    expect(assignment.code, assignment.stderr).toBe(0);
    expect(await memberPositionName(database, userId)).toBe("Utility");
  });

  it("pierden la referencia cuando la aplicación les quita la posición", async () => {
    const database = await migratedDatabase();
    const userId = await insertMember(database, "'Defender'");

    await database.query(
      `update public.members set position = null where user_id = '${userId}'`,
    );

    expect(await memberPositionName(database, userId)).toBe("ninguna");
  });
});

describeConPostgres("privilegios de las posiciones", () => {
  it("deja a authenticated leer las posiciones de su club", async () => {
    const database = await migratedDatabase();
    const userId = await insertMember(database, "null");

    const reading = await database.attempt(
      asRole(
        "authenticated",
        `select n.name from public.club_positions p
           join public.club_position_names n on n.position_id = p.id
          where n.locale = 'es' order by p.sort_order`,
        userId,
      ),
    );

    expect(reading.code, reading.stderr).toBe(0);
    expect(reading.stdout.trim().split(/\r?\n/)).toEqual([
      "Portería",
      "Defensa",
      "Ataque",
    ]);
  });

  it("no le enseña a authenticated las posiciones de otro club", async () => {
    const database = await migratedDatabase();
    const userId = await insertMember(database, "null");
    const otherClubId = await createOtherClub(database);
    await createPosition(database, otherClubId, "Striker");

    const reading = await database.attempt(
      asRole(
        "authenticated",
        `select count(*) from public.club_positions
          where club_id = '${otherClubId}';
         select count(*) from public.club_position_names
          where club_id = '${otherClubId}'`,
        userId,
      ),
    );

    expect(reading.code, reading.stderr).toBe(0);
    expect(reading.stdout.trim().split(/\r?\n/)).toEqual(["0", "0"]);
  });

  it.each([
    [
      "crear una posición",
      "insert into public.club_positions (club_id, sort_order) select club_id, 4 from public.club_positions limit 1",
    ],
    [
      "archivar una posición",
      "update public.club_positions set archived_at = now()",
    ],
    ["borrar una posición", "delete from public.club_positions"],
    [
      "renombrar una posición",
      "update public.club_position_names set name = 'Portero'",
    ],
    ["borrar un nombre", "delete from public.club_position_names"],
  ])("no deja a authenticated %s", async (_case, sql) => {
    const database = await migratedDatabase();
    const userId = await insertMember(database, "null");

    const writing = await database.attempt(
      asRole("authenticated", sql, userId),
    );

    expect(writing.code).toBeGreaterThan(0);
    expect(writing.stderr).toMatch(/permission denied for table club_position/);
  });

  it("no deja a anon leer las posiciones", async () => {
    const database = await migratedDatabase();

    const reading = await database.attempt(
      asRole("anon", "select count(*) from public.club_positions"),
    );

    expect(reading.code).toBeGreaterThan(0);
    expect(reading.stderr).toMatch(
      /permission denied for table club_positions/,
    );
  });

  it("deja a service_role crear, renombrar y archivar posiciones", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);

    const writing = await database.attempt(
      asRole(
        "service_role",
        `with p as (
           insert into public.club_positions (club_id, sort_order)
           values ('${clubId}', 4) returning id
         )
         insert into public.club_position_names (position_id, club_id, locale, name)
         select id, '${clubId}', 'en', 'Utility' from p;
         update public.club_position_names set name = 'Portero'
          where locale = 'es' and position_id in (
             select id from public.club_positions where sort_order = 1);
         update public.club_positions set archived_at = now()
          where sort_order = 3`,
      ),
    );

    expect(writing.code, writing.stderr).toBe(0);
    expect(
      await database.query(
        "select count(*) from public.club_positions where archived_at is null",
      ),
    ).toBe("3");
  });
});

describeConPostgres("la migración de las posiciones repetida", () => {
  it("no falla ni duplica nada, ni pisa lo que el club cambió", async () => {
    const database = await migratedDatabase();
    const userId = await insertMember(database, "'Defender'");
    await database.query(
      `update public.club_position_names set name = 'Zaguero'
        where locale = 'es' and name = 'Defensa'`,
    );
    const afterFirst = await database.snapshot();

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    // La comparación sólo vale si la descripción trae las tablas nuevas: dos
    // cadenas vacías también son iguales.
    expect(afterFirst).toMatch(/columna club_positions\.archived_at/);
    expect(await database.snapshot()).toBe(afterFirst);
    expect(
      await database.query("select count(*) from public.club_positions"),
    ).toBe("3");
    expect(
      await database.query("select count(*) from public.club_position_names"),
    ).toBe("6");
    expect(
      await database.query(
        "select count(*) from public.club_position_names where name = 'Zaguero'",
      ),
    ).toBe("1");
    expect(await memberPositionName(database, userId)).toBe("Defender");
  });

  it("no falla con un miembro en una posición que el club añadió", async () => {
    // El `check` fijo de `0016` no puede volver al repetirse el histórico: una
    // posición fuera de las tres de siempre lo violaría y tumbaría el
    // despliegue de migraciones.
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database, SEEDED_CLUB);
    await createPosition(database, clubId, "Utility");
    const userId = await insertMember(database, "'Utility'");

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(await memberPositionName(database, userId)).toBe("Utility");
  });
});
