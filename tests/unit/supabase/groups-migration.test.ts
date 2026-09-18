import { expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `public.groups` y `public.group_memberships` contra un Postgres desechable
 * (#225, RF-1 y RF-9 del PRD de E4). Las reglas que importan aquí no pueden
 * depender de que la aplicación se porte bien: nombre único por club sin
 * mayúsculas ni espacios, un socio una sola vez por grupo, y nada de grupos y
 * socios de clubes distintos en la misma pertenencia.
 */

/** El límite que la migración nombra para el nombre del grupo. */
const GROUP_NAME_MAX_LENGTH = 60;

/** Etiquetas que psql imprime entre las filas que sí interesan. */
const COMMAND_TAGS: ReadonlySet<string> = new Set(["SET"]);

async function seededClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    "select id from public.clubs where slug = 'victoria-seadragons'",
  );
}

async function seedOtherClub(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `insert into public.clubs (name, slug)
     values ('Otro club', 'otro-club-' || gen_random_uuid())
     returning id`,
  );
}

interface SeedMemberOptions {
  readonly clubId?: string;
  readonly accountStatus?: "incomplete" | "active" | "inactive";
}

/** Crea una identidad y su socio, y devuelve el `user_id` que los une. */
async function seedMember(
  database: TemporaryDatabase,
  options: SeedMemberOptions = {},
): Promise<string> {
  const clubId = options.clubId ?? (await seededClubId(database));
  const accountStatus = options.accountStatus ?? "incomplete";
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members (club_id, user_id, full_name, email, account_status)
     values ('${clubId}', '${userId}', 'Socio de prueba',
             '${userId}@example.test', '${accountStatus}')`,
  );
  return userId;
}

/** Inserta un grupo. `name` es SQL literal: una cadena va entre comillas. */
async function insertGroup(
  database: TemporaryDatabase,
  name: string,
  clubId?: string,
): Promise<RunResult> {
  const club = clubId ?? (await seededClubId(database));
  return database.attempt(
    `insert into public.groups (club_id, name) values ('${club}', ${name})`,
  );
}

async function seedGroup(
  database: TemporaryDatabase,
  name: string,
  clubId?: string,
): Promise<string> {
  const club = clubId ?? (await seededClubId(database));
  return database.query(
    `insert into public.groups (club_id, name) values ('${club}', '${name}')
     returning id`,
  );
}

interface MembershipRow {
  readonly groupId: string;
  readonly userId: string;
  readonly clubId?: string;
}

async function insertMembership(
  database: TemporaryDatabase,
  row: MembershipRow,
): Promise<RunResult> {
  const clubId = row.clubId ?? (await seededClubId(database));
  return database.attempt(
    `insert into public.group_memberships (group_id, user_id, club_id)
     values ('${row.groupId}', '${row.userId}', '${clubId}')`,
  );
}

async function countMemberships(database: TemporaryDatabase): Promise<string> {
  return database.query("select count(*) from public.group_memberships");
}

type ApiIdentity =
  | { readonly role: "anon" }
  | { readonly role: "authenticated"; readonly subject: string };

/** Lo que PostgREST monta antes de cada consulta: el rol de la API y, si hay
 * sesión, el `sub` del JWT que `auth.uid()` lee. */
function asApiIdentity(identity: ApiIdentity, sql: string): string {
  const claims =
    identity.role === "anon"
      ? ""
      : `set request.jwt.claims = '{"sub":"${identity.subject}"}'; `;
  return `set role ${identity.role}; ${claims}${sql}`;
}

function rowsOf(result: RunResult): string[] {
  return result.stdout
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !COMMAND_TAGS.has(line));
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

function callIsMemberInGroups(
  userId: string,
  groupIds: readonly string[],
): string {
  const array = groupIds.map((id) => `'${id}'`).join(", ");
  return `select public.is_member_in_groups('${userId}', array[${array}]::uuid[])`;
}

describeConPostgres("migración de los grupos", () => {
  it("guarda de cada grupo id, club, nombre y creación", async () => {
    const database = await migratedDatabase();

    const columns = await columnsOf(database, "groups");

    expect(columns.split("\n")).toEqual([
      "club_id uuid null=NO",
      "created_at timestamp with time zone null=NO",
      "id uuid null=NO",
      "name text null=NO",
    ]);
  });

  it("guarda de cada pertenencia grupo, socio, club y asignación", async () => {
    const database = await migratedDatabase();

    const columns = await columnsOf(database, "group_memberships");

    expect(columns.split("\n")).toEqual([
      "assigned_at timestamp with time zone null=NO",
      "club_id uuid null=NO",
      "group_id uuid null=NO",
      "user_id uuid null=NO",
    ]);
  });

  it("es idempotente: aplicada dos veces no falla ni duplica nada", async () => {
    const database = await migratedDatabase();
    const despuesDeLaPrimera = await database.snapshot();

    const segunda = await applyRepositoryMigrations(database);

    expect(segunda.code, segunda.stderr).toBe(0);
    // Dos cadenas vacías también son iguales: las tablas tienen que estar ahí.
    expect(despuesDeLaPrimera).toMatch(/tabla groups rls=t/);
    expect(despuesDeLaPrimera).toMatch(/tabla group_memberships rls=t/);
    expect(await database.snapshot()).toBe(despuesDeLaPrimera);
  });
});

describeConPostgres("el nombre de un grupo", () => {
  it.each(["'senior squad'", "' Senior Squad '", "'SENIOR SQUAD  '"])(
    "rechaza %s si el club ya tiene un Senior Squad",
    async (duplicate) => {
      const database = await migratedDatabase();
      await seedGroup(database, "Senior Squad");

      const insercion = await insertGroup(database, duplicate);

      expect(insercion.code).toBeGreaterThan(0);
      expect(insercion.stderr).toMatch(/groups_club_id_name_key/);
    },
  );

  it("acepta el mismo nombre en otro club", async () => {
    const database = await migratedDatabase();
    await seedGroup(database, "Senior Squad");

    const insercion = await insertGroup(
      database,
      "'senior squad'",
      await seedOtherClub(database),
    );

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it.each([
    ["vacío", "''"],
    ["de solo espacios", "'   '"],
    ["más largo que el límite", `repeat('x', ${GROUP_NAME_MAX_LENGTH + 1})`],
  ])("rechaza un nombre %s", async (_caso, name) => {
    const database = await migratedDatabase();

    const insercion = await insertGroup(database, name);

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/groups_name_length/);
  });

  it(`acepta un nombre de ${GROUP_NAME_MAX_LENGTH} caracteres`, async () => {
    const database = await migratedDatabase();

    const insercion = await insertGroup(
      database,
      `repeat('x', ${GROUP_NAME_MAX_LENGTH})`,
    );

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it("rechaza un grupo sin club", async () => {
    // NFR-009: ninguna tabla del proyecto nace sin club.
    const database = await migratedDatabase();

    const insercion = await database.attempt(
      "insert into public.groups (club_id, name) values (null, 'Senior Squad')",
    );

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(
      /null value in column "club_id".*violates not-null constraint/s,
    );
  });
});

describeConPostgres("las pertenencias a un grupo", () => {
  it("rechaza asignar dos veces el mismo socio al mismo grupo", async () => {
    const database = await migratedDatabase();
    const groupId = await seedGroup(database, "Senior Squad");
    const userId = await seedMember(database);
    const primera = await insertMembership(database, { groupId, userId });
    expect(primera.code, primera.stderr).toBe(0);

    const segunda = await insertMembership(database, { groupId, userId });

    expect(segunda.code).toBeGreaterThan(0);
    expect(segunda.stderr).toMatch(/group_memberships_pkey/);
    expect(await countMemberships(database)).toBe("1");
  });

  it("deja a un socio estar en dos grupos distintos", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);
    const senior = await seedGroup(database, "Senior Squad");
    const junior = await seedGroup(database, "Junior Squad");
    const primera = await insertMembership(database, {
      groupId: senior,
      userId,
    });
    expect(primera.code, primera.stderr).toBe(0);

    const segunda = await insertMembership(database, {
      groupId: junior,
      userId,
    });

    expect(segunda.code, segunda.stderr).toBe(0);
  });

  it("rechaza meter en un grupo a un socio de otro club", async () => {
    const database = await migratedDatabase();
    const groupId = await seedGroup(database, "Senior Squad");
    const otherClubId = await seedOtherClub(database);
    const userId = await seedMember(database, { clubId: otherClubId });

    const insercion = await insertMembership(database, { groupId, userId });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/group_memberships_member_same_club_fkey/);
  });

  it("rechaza una pertenencia que dice ser del club del socio pero no del grupo", async () => {
    // El club de la fila tiene que ser el del grupo y el del socio a la vez:
    // copiar el del socio no basta para colar un grupo ajeno.
    const database = await migratedDatabase();
    const otherClubId = await seedOtherClub(database);
    const groupId = await seedGroup(database, "Senior Squad");
    const userId = await seedMember(database, { clubId: otherClubId });

    const insercion = await insertMembership(database, {
      groupId,
      userId,
      clubId: otherClubId,
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/group_memberships_group_same_club_fkey/);
  });

  it("rechaza una pertenencia de alguien que no es socio", async () => {
    const database = await migratedDatabase();
    const groupId = await seedGroup(database, "Senior Squad");
    const identityWithoutMember = await database.query(
      "insert into auth.users (id) values (gen_random_uuid()) returning id",
    );

    const insercion = await insertMembership(database, {
      groupId,
      userId: identityWithoutMember,
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/group_memberships_member_same_club_fkey/);
  });

  it("borra las pertenencias de un grupo borrado y deja intactos a sus socios", async () => {
    const database = await migratedDatabase();
    const groupId = await seedGroup(database, "Senior Squad");
    const userId = await seedMember(database);
    const insercion = await insertMembership(database, { groupId, userId });
    expect(insercion.code, insercion.stderr).toBe(0);

    await database.query(`delete from public.groups where id = '${groupId}'`);

    expect(await countMemberships(database)).toBe("0");
    expect(
      await database.query(
        `select count(*) from public.members where user_id = '${userId}'`,
      ),
    ).toBe("1");
  });

  it("borra las pertenencias de un socio cuando se borra su identidad", async () => {
    const database = await migratedDatabase();
    const groupId = await seedGroup(database, "Senior Squad");
    const userId = await seedMember(database);
    const insercion = await insertMembership(database, { groupId, userId });
    expect(insercion.code, insercion.stderr).toBe(0);

    await database.query(`delete from auth.users where id = '${userId}'`);

    expect(await countMemberships(database)).toBe("0");
    expect(await database.query("select count(*) from public.groups")).toBe(
      "1",
    );
  });
});

describeConPostgres("policies y privilegios de los grupos", () => {
  it("deja a un socio ver sus pertenencias y ninguna ajena", async () => {
    const database = await migratedDatabase();
    const socio = await seedMember(database);
    const otro = await seedMember(database);
    const senior = await seedGroup(database, "Senior Squad");
    const junior = await seedGroup(database, "Junior Squad");
    await insertMembership(database, { groupId: senior, userId: socio });
    await insertMembership(database, { groupId: junior, userId: otro });

    const lectura = await database.attempt(
      asApiIdentity(
        { role: "authenticated", subject: socio },
        "select user_id from public.group_memberships",
      ),
    );

    expect(lectura.code, lectura.stderr).toBe(0);
    expect(rowsOf(lectura)).toEqual([socio]);
  });

  it("deja a un socio ver solo los grupos a los que pertenece", async () => {
    const database = await migratedDatabase();
    const socio = await seedMember(database);
    const otro = await seedMember(database);
    const senior = await seedGroup(database, "Senior Squad");
    const junior = await seedGroup(database, "Junior Squad");
    await seedGroup(database, "Masters Squad");
    await insertMembership(database, { groupId: senior, userId: socio });
    await insertMembership(database, { groupId: junior, userId: otro });

    const lectura = await database.attempt(
      asApiIdentity(
        { role: "authenticated", subject: socio },
        "select name from public.groups",
      ),
    );

    expect(lectura.code, lectura.stderr).toBe(0);
    expect(rowsOf(lectura)).toEqual(["Senior Squad"]);
  });

  it.each([
    [
      "crear un grupo",
      "groups",
      () =>
        `insert into public.groups (club_id, name)
         select id, 'Nuevo' from public.clubs limit 1`,
    ],
    [
      "renombrar un grupo",
      "groups",
      () => "update public.groups set name = 'Renombrado'",
    ],
    ["borrar un grupo", "groups", () => "delete from public.groups"],
    [
      "asignarse a un grupo",
      "group_memberships",
      (userId: string) =>
        `insert into public.group_memberships (group_id, user_id, club_id)
         select id, '${userId}', club_id from public.groups`,
    ],
    [
      "cambiar su pertenencia",
      "group_memberships",
      () => "update public.group_memberships set assigned_at = now()",
    ],
    [
      "quitarse de un grupo",
      "group_memberships",
      () => "delete from public.group_memberships",
    ],
  ] as const)("no deja a un socio %s", async (_accion, table, buildSql) => {
    // Se exige el error, no sólo que nada cambie: sin el `revoke`, RLS
    // negaría en silencio y el cliente creería que guardó.
    const database = await migratedDatabase();
    const socio = await seedMember(database);
    const groupId = await seedGroup(database, "Senior Squad");
    await insertMembership(database, { groupId, userId: socio });

    const intento = await database.attempt(
      asApiIdentity({ role: "authenticated", subject: socio }, buildSql(socio)),
    );

    expect(intento.code).toBeGreaterThan(0);
    expect(intento.stderr).toMatch(
      new RegExp(`permission denied for table ${table}`),
    );
  });

  it.each(["groups", "group_memberships"])(
    "no deja a un cliente anónimo ver nada de %s",
    async (table) => {
      const database = await migratedDatabase();

      const lectura = await database.attempt(
        asApiIdentity({ role: "anon" }, `select * from public.${table}`),
      );

      expect(lectura.code).toBeGreaterThan(0);
      expect(lectura.stderr).toMatch(
        new RegExp(`permission denied for table ${table}`),
      );
    },
  );

  it("deja a anon sin privilegios y a authenticated sólo con la lectura", async () => {
    const database = await migratedDatabase();

    const privilegios = await database.query(
      `select table_name || ' ' || grantee || ' ' || privilege_type
         from information_schema.table_privileges
        where table_schema = 'public'
          and table_name in ('groups', 'group_memberships')
          and grantee in ('anon', 'authenticated')
        order by table_name, grantee, privilege_type`,
    );

    expect(privilegios.split("\n")).toEqual([
      "group_memberships authenticated SELECT",
      "groups authenticated SELECT",
    ]);
  });

  it.each(["groups", "group_memberships"])(
    "le deja al servidor leer y escribir %s",
    async (table) => {
      const database = await migratedDatabase();

      const privilegios = await database.query(
        `select privilege_type
           from information_schema.table_privileges
          where table_schema = 'public' and table_name = '${table}'
            and grantee = 'service_role'`,
      );

      expect(privilegios.split("\n")).toEqual(
        expect.arrayContaining(["DELETE", "INSERT", "SELECT", "UPDATE"]),
      );
    },
  );
});

describeConPostgres("la función de pertenencia a grupos", () => {
  it("responde verdadero si el socio está en alguno de los grupos", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database, { accountStatus: "active" });
    const senior = await seedGroup(database, "Senior Squad");
    const junior = await seedGroup(database, "Junior Squad");
    await insertMembership(database, { groupId: junior, userId });

    const pertenece = await database.query(
      callIsMemberInGroups(userId, [senior, junior]),
    );

    expect(pertenece).toBe("t");
  });

  it("responde falso si el socio no está en ninguno", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database, { accountStatus: "active" });
    const senior = await seedGroup(database, "Senior Squad");
    const junior = await seedGroup(database, "Junior Squad");
    await insertMembership(database, { groupId: junior, userId });

    const pertenece = await database.query(
      callIsMemberInGroups(userId, [senior]),
    );

    expect(pertenece).toBe("f");
  });

  it("responde falso con un conjunto vacío de grupos", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database, { accountStatus: "active" });
    const groupId = await seedGroup(database, "Senior Squad");
    await insertMembership(database, { groupId, userId });

    const pertenece = await database.query(callIsMemberInGroups(userId, []));

    expect(pertenece).toBe("f");
  });

  it("responde falso si el socio está dado de baja aunque siga asignado", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database, { accountStatus: "inactive" });
    const groupId = await seedGroup(database, "Senior Squad");
    await insertMembership(database, { groupId, userId });

    const pertenece = await database.query(
      callIsMemberInGroups(userId, [groupId]),
    );

    expect(pertenece).toBe("f");
  });

  it("no deja a un cliente anónimo llamarla", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);
    const groupId = await seedGroup(database, "Senior Squad");

    const llamada = await database.attempt(
      asApiIdentity({ role: "anon" }, callIsMemberInGroups(userId, [groupId])),
    );

    expect(llamada.code).toBeGreaterThan(0);
    expect(llamada.stderr).toMatch(
      /permission denied for function is_member_in_groups/,
    );
  });

  it("deja a un socio preguntar por sí mismo", async () => {
    // `security invoker`: la función lee con los privilegios y las policies de
    // quien la llama, que es lo que necesitan las policies de E7 y E11.
    const database = await migratedDatabase();
    const socio = await seedMember(database, { accountStatus: "active" });
    const groupId = await seedGroup(database, "Senior Squad");
    await insertMembership(database, { groupId, userId: socio });

    const llamada = await database.attempt(
      asApiIdentity(
        { role: "authenticated", subject: socio },
        callIsMemberInGroups(socio, [groupId]),
      ),
    );

    expect(llamada.code, llamada.stderr).toBe(0);
    expect(rowsOf(llamada)).toEqual(["t"]);
  });
});
