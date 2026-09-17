import { expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `public.role_requests` contra un Postgres desechable (#208, RF-3 del PRD de
 * E3). Las reglas que importan aquí no pueden depender de que la aplicación se
 * porte bien: una sola solicitud pendiente por socio aunque lleguen dos a la
 * vez, y nadie leyendo las ajenas. Por eso se prueban en la base y no en un
 * handler.
 */

/** El límite que la migración nombra para la justificación. */
const JUSTIFICATION_MAX_LENGTH = 500;

/** Cuánto retiene la primera transacción su fila sin confirmar, para que la
 * segunda inserción llegue seguro mientras la primera sigue abierta. */
const CONCURRENT_INSERT_HOLD_SECONDS = 2;

/** Lo mínimo que tiene que tardar la inserción rechazada para que conste que
 * esperó a la otra. Si hubieran corrido una detrás de otra, el rechazo sería
 * inmediato. La mitad del tiempo retenido deja margen al arranque de psql. */
const MIN_BLOCKED_MILLISECONDS = (CONCURRENT_INSERT_HOLD_SECONDS * 1000) / 2;

/** Etiquetas que psql imprime entre las filas que sí interesan. */
const COMMAND_TAGS: ReadonlySet<string> = new Set(["SET", "BEGIN", "COMMIT"]);

async function seededClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    "select id from public.clubs where slug = 'victoria-seadragons'",
  );
}

/** Crea una identidad y su socio, y devuelve el `user_id` que los une. */
async function seedMember(database: TemporaryDatabase): Promise<string> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members (club_id, user_id, full_name, email)
     values ('${await seededClubId(database)}', '${userId}', 'Socio de prueba',
             '${userId}@example.test')`,
  );
  return userId;
}

/**
 * La sentencia que inserta una solicitud válida con los campos que `overrides`
 * reemplace. Los valores son SQL literal, como en el test de `members`: una
 * cadena va entre comillas (`{ status: "'approved'" }`) y una expresión va tal
 * cual (`{ decided_at: "now()" }`).
 */
async function insertRequestSql(
  database: TemporaryDatabase,
  userId: string,
  overrides: Readonly<Record<string, string>> = {},
): Promise<string> {
  const values: Record<string, string> = {
    club_id: `'${await seededClubId(database)}'`,
    user_id: `'${userId}'`,
    requested_role: "'Coach'",
    ...overrides,
  };
  return `insert into public.role_requests (${Object.keys(values).join(", ")})
          values (${Object.values(values).join(", ")})`;
}

async function insertRequest(
  database: TemporaryDatabase,
  userId: string,
  overrides: Readonly<Record<string, string>> = {},
): Promise<RunResult> {
  return database.attempt(await insertRequestSql(database, userId, overrides));
}

/** Los campos de una solicitud ya decidida, para que el caso no tropiece con
 * la regla que ata la decisión al estado. */
function decidedAs(status: "approved" | "rejected"): Record<string, string> {
  return { status: `'${status}'`, decided_at: "now()" };
}

async function countRequests(database: TemporaryDatabase): Promise<string> {
  return database.query("select count(*) from public.role_requests");
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

interface TimedResult {
  readonly result: RunResult;
  readonly elapsedMilliseconds: number;
}

async function timedAttempt(
  database: TemporaryDatabase,
  sql: string,
): Promise<TimedResult> {
  const startedAt = performance.now();
  const result = await database.attempt(sql);
  return { result, elapsedMilliseconds: performance.now() - startedAt };
}

function rowsOf(result: RunResult): string[] {
  return result.stdout
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !COMMAND_TAGS.has(line));
}

describeConPostgres("migración de las solicitudes de rol", () => {
  it("guarda club, socio, rol pedido, justificación, estado, creación y decisión", async () => {
    const database = await migratedDatabase();

    const columns = await database.query(
      `select column_name || ' ' || data_type || ' null=' || is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'role_requests'
        order by column_name`,
    );

    // Las de la decisión son nulables porque una solicitud pendiente todavía
    // no la ha decidido nadie; la justificación, porque es opcional (FR-010).
    expect(columns.split("\n")).toEqual([
      "club_id uuid null=NO",
      "created_at timestamp with time zone null=NO",
      "decided_at timestamp with time zone null=YES",
      "decided_by uuid null=YES",
      "id uuid null=NO",
      "justification text null=YES",
      "requested_role text null=NO",
      "status text null=NO",
      "user_id uuid null=NO",
    ]);
  });

  it("nace pendiente y sin decisión", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);

    const insercion = await insertRequest(database, userId);

    expect(insercion.code, insercion.stderr).toBe(0);
    expect(
      await database.query(
        `select status || '|' || coalesce(decided_by::text, '-') || '|' ||
                coalesce(decided_at::text, '-')
           from public.role_requests`,
      ),
    ).toBe("pending|-|-");
  });

  it("es idempotente: aplicada dos veces no falla ni duplica nada", async () => {
    const database = await migratedDatabase();
    const despuesDeLaPrimera = await database.snapshot();

    const segunda = await applyRepositoryMigrations(database);

    expect(segunda.code, segunda.stderr).toBe(0);
    // Dos cadenas vacías también son iguales: la tabla tiene que estar ahí.
    expect(despuesDeLaPrimera).toMatch(/tabla role_requests rls=t/);
    expect(await database.snapshot()).toBe(despuesDeLaPrimera);
  });

  it("borra las solicitudes de un socio cuando se borra su identidad", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);
    const insercion = await insertRequest(database, userId);
    expect(insercion.code, insercion.stderr).toBe(0);

    await database.query(`delete from auth.users where id = '${userId}'`);

    expect(await countRequests(database)).toBe("0");
  });

  it("conserva la solicitud decidida cuando se borra la identidad de quien la decidió", async () => {
    // La solicitud es del socio que la pidió, no del Admin: borrar al Admin
    // no puede llevarse por delante el historial de otra persona.
    const database = await migratedDatabase();
    const requesterId = await seedMember(database);
    const adminId = await seedMember(database);
    const insercion = await insertRequest(database, requesterId, {
      ...decidedAs("approved"),
      decided_by: `'${adminId}'`,
    });
    expect(insercion.code, insercion.stderr).toBe(0);

    await database.query(`delete from auth.users where id = '${adminId}'`);

    expect(
      await database.query(
        "select status || '|' || coalesce(decided_by::text, '-') from public.role_requests",
      ),
    ).toBe("approved|-");
  });
});

describeConPostgres("una sola solicitud pendiente por socio", () => {
  it.each(["Coach", "Committee"])(
    "rechaza otra pendiente del mismo socio aunque pida %s",
    async (secondRole) => {
      const database = await migratedDatabase();
      const userId = await seedMember(database);
      const primera = await insertRequest(database, userId);
      expect(primera.code, primera.stderr).toBe(0);

      const segunda = await insertRequest(database, userId, {
        requested_role: `'${secondRole}'`,
      });

      expect(segunda.code).toBeGreaterThan(0);
      expect(segunda.stderr).toMatch(/role_requests_one_pending_per_member/);
      expect(await countRequests(database)).toBe("1");
    },
  );

  it("deja que dos socios distintos tengan cada uno su pendiente", async () => {
    const database = await migratedDatabase();
    const primera = await insertRequest(database, await seedMember(database));
    expect(primera.code, primera.stderr).toBe(0);

    const segunda = await insertRequest(database, await seedMember(database));

    expect(segunda.code, segunda.stderr).toBe(0);
  });

  it("deja existir una sola de dos inserciones pendientes lanzadas a la vez", async () => {
    // Las dos transacciones se abren juntas y la primera retiene su fila sin
    // confirmar: la segunda llega mientras tanto, que es el caso que una
    // comprobación previa en la aplicación no puede cubrir.
    const database = await migratedDatabase();
    const userId = await seedMember(database);
    const insertSql = await insertRequestSql(database, userId);
    const concurrentInsert = `begin; ${insertSql};
      select pg_sleep(${CONCURRENT_INSERT_HOLD_SECONDS}); commit;`;

    const attempts = await Promise.all([
      timedAttempt(database, concurrentInsert),
      timedAttempt(database, concurrentInsert),
    ]);

    const failures = attempts.filter(({ result }) => result.code !== 0);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.result.stderr).toMatch(
      /role_requests_one_pending_per_member/,
    );
    expect(failures[0]?.elapsedMilliseconds).toBeGreaterThanOrEqual(
      MIN_BLOCKED_MILLISECONDS,
    );
    expect(await countRequests(database)).toBe("1");
  });

  it.each(["approved", "rejected"] as const)(
    "acepta una nueva cuando la anterior está %s",
    async (previousStatus) => {
      const database = await migratedDatabase();
      const userId = await seedMember(database);
      const anterior = await insertRequest(
        database,
        userId,
        decidedAs(previousStatus),
      );
      expect(anterior.code, anterior.stderr).toBe(0);

      const nueva = await insertRequest(database, userId);

      expect(nueva.code, nueva.stderr).toBe(0);
      expect(await countRequests(database)).toBe("2");
    },
  );
});

describeConPostgres("restricciones de las solicitudes de rol", () => {
  it.each(["Admin", "Player", "Owner"])(
    "rechaza pedir el rol %s",
    async (role) => {
      // Admin no se pide: lo da otro Admin. Player lo tiene todo el mundo.
      const database = await migratedDatabase();

      const insercion = await insertRequest(
        database,
        await seedMember(database),
        {
          requested_role: `'${role}'`,
        },
      );

      expect(insercion.code).toBeGreaterThan(0);
      expect(insercion.stderr).toMatch(/role_requests_requested_role_check/);
    },
  );

  it("rechaza un estado fuera de pending, approved y rejected", async () => {
    const database = await migratedDatabase();

    const insercion = await insertRequest(
      database,
      await seedMember(database),
      {
        status: "'cancelled'",
        decided_at: "now()",
      },
    );

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/role_requests_status_check/);
  });

  it(`acepta una justificación de ${JUSTIFICATION_MAX_LENGTH} caracteres`, async () => {
    const database = await migratedDatabase();

    const insercion = await insertRequest(
      database,
      await seedMember(database),
      {
        justification: `repeat('x', ${JUSTIFICATION_MAX_LENGTH})`,
      },
    );

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it("rechaza una justificación más larga que el límite", async () => {
    const database = await migratedDatabase();

    const insercion = await insertRequest(
      database,
      await seedMember(database),
      {
        justification: `repeat('x', ${JUSTIFICATION_MAX_LENGTH + 1})`,
      },
    );

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/role_requests_justification_check/);
  });

  it("rechaza una solicitud pendiente que ya trae decisión", async () => {
    const database = await migratedDatabase();
    const adminId = await seedMember(database);

    const insercion = await insertRequest(
      database,
      await seedMember(database),
      {
        decided_by: `'${adminId}'`,
        decided_at: "now()",
      },
    );

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/role_requests_decision_matches_status/);
  });

  it("rechaza una solicitud decidida sin el instante de la decisión", async () => {
    const database = await migratedDatabase();

    const insercion = await insertRequest(
      database,
      await seedMember(database),
      {
        status: "'rejected'",
      },
    );

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/role_requests_decision_matches_status/);
  });

  it("rechaza una solicitud de alguien que no es socio", async () => {
    const database = await migratedDatabase();
    const identityWithoutMember = await database.query(
      "insert into auth.users (id) values (gen_random_uuid()) returning id",
    );

    const insercion = await insertRequest(database, identityWithoutMember);

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/role_requests_user_id_fkey/);
  });

  it("rechaza una fila sin club", async () => {
    // NFR-009: ninguna tabla del proyecto nace sin club.
    const database = await migratedDatabase();

    const insercion = await insertRequest(
      database,
      await seedMember(database),
      {
        club_id: "null",
      },
    );

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(
      /null value in column "club_id".*violates not-null constraint/s,
    );
  });
});

describeConPostgres("policies y privilegios de las solicitudes de rol", () => {
  it("deja a un socio ver sus solicitudes y ninguna ajena", async () => {
    const database = await migratedDatabase();
    const socio = await seedMember(database);
    const otro = await seedMember(database);
    const propia = await insertRequest(database, socio, {
      justification: "'la mía'",
    });
    const ajena = await insertRequest(database, otro, {
      justification: "'la ajena'",
    });
    expect(propia.code, propia.stderr).toBe(0);
    expect(ajena.code, ajena.stderr).toBe(0);

    const lectura = await database.attempt(
      asApiIdentity(
        { role: "authenticated", subject: socio },
        "select justification from public.role_requests",
      ),
    );

    expect(lectura.code, lectura.stderr).toBe(0);
    expect(rowsOf(lectura)).toEqual(["la mía"]);
  });

  it.each([
    [
      "insertar",
      (userId: string) =>
        `insert into public.role_requests (club_id, user_id, requested_role)
       select club_id, user_id, 'Coach' from public.members
        where user_id = '${userId}'`,
    ],
    [
      "cambiar",
      (userId: string) =>
        `update public.role_requests set status = 'approved', decided_at = now()
        where user_id = '${userId}'`,
    ],
    [
      "borrar",
      (userId: string) =>
        `delete from public.role_requests where user_id = '${userId}'`,
    ],
  ] as const)(
    "no deja a un socio %s ni siquiera sus propias solicitudes",
    async (_verbo, buildSql) => {
      // Se exige el error, no sólo que nada cambie: sin el `revoke`, RLS
      // negaría en silencio y el cliente creería que guardó.
      const database = await migratedDatabase();
      const socio = await seedMember(database);
      const insercion = await insertRequest(database, socio);
      expect(insercion.code, insercion.stderr).toBe(0);

      const intento = await database.attempt(
        asApiIdentity(
          { role: "authenticated", subject: socio },
          buildSql(socio),
        ),
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(
        /permission denied for table role_requests/,
      );
      expect(
        await database.query(
          "select count(*) || '|' || string_agg(status, ',') from public.role_requests",
        ),
      ).toBe("1|pending");
    },
  );

  it("no deja a un cliente anónimo ver nada", async () => {
    const database = await migratedDatabase();
    const insercion = await insertRequest(database, await seedMember(database));
    expect(insercion.code, insercion.stderr).toBe(0);

    const lectura = await database.attempt(
      asApiIdentity({ role: "anon" }, "select * from public.role_requests"),
    );

    expect(lectura.code).toBeGreaterThan(0);
    expect(lectura.stderr).toMatch(/permission denied for table role_requests/);
  });

  it("deja a anon sin privilegios y a authenticated sólo con la lectura", async () => {
    const database = await migratedDatabase();

    const privilegios = await database.query(
      `select grantee || ' ' || privilege_type
         from information_schema.table_privileges
        where table_schema = 'public' and table_name = 'role_requests'
          and grantee in ('anon', 'authenticated')
        order by grantee, privilege_type`,
    );

    expect(privilegios).toBe("authenticated SELECT");
  });

  it("le deja al servidor leer, crear, decidir y borrar solicitudes", async () => {
    const database = await migratedDatabase();

    const privilegios = await database.query(
      `select privilege_type
         from information_schema.table_privileges
        where table_schema = 'public' and table_name = 'role_requests'
          and grantee = 'service_role'`,
    );

    expect(privilegios.split("\n")).toEqual(
      expect.arrayContaining(["DELETE", "INSERT", "SELECT", "UPDATE"]),
    );
  });
});
