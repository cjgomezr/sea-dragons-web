import { expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `public.notifications` contra un Postgres desechable (#264, RF-1 del PRD de
 * E6). Un aviso guarda su tipo y sus datos, nunca su texto. Las reglas que
 * importan aquí no pueden depender de que la aplicación se porte bien:
 * catálogo cerrado de tipos, datos que son un objeto, y ningún destinatario de
 * otro club.
 */

/** Etiquetas que psql imprime entre las filas que sí interesan. */
const COMMAND_TAGS: ReadonlySet<string> = new Set(["SET"]);

/** El índice parcial que sirve el conteo de la campana. */
const UNREAD_INDEX = "notifications_unread_user_id_idx";

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

/** Crea una identidad y su socio, y devuelve el `user_id` que los une. */
async function seedMember(
  database: TemporaryDatabase,
  clubId?: string,
): Promise<string> {
  const club = clubId ?? (await seededClubId(database));
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members (club_id, user_id, full_name, email)
     values ('${club}', '${userId}', 'Socio de prueba',
             '${userId}@example.test')`,
  );
  return userId;
}

interface NotificationRow {
  readonly userId: string;
  readonly clubId?: string;
  readonly type?: string;
  /** SQL literal: un objeto va como `'{"a":1}'`. */
  readonly data?: string;
}

async function insertNotification(
  database: TemporaryDatabase,
  row: NotificationRow,
): Promise<RunResult> {
  const clubId = row.clubId ?? (await seededClubId(database));
  const type = row.type ?? "role_changed";
  const data = row.data ?? `'{"role":"Coach"}'`;
  return database.attempt(
    `insert into public.notifications (club_id, user_id, type, data)
     values ('${clubId}', '${row.userId}', '${type}', ${data})`,
  );
}

async function countNotifications(
  database: TemporaryDatabase,
): Promise<string> {
  return database.query("select count(*) from public.notifications");
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

describeConPostgres("migración de los avisos", () => {
  it("guarda de cada aviso id, club, destinatario, tipo, datos, creación y lectura", async () => {
    const database = await migratedDatabase();

    const columns = await database.query(
      `select column_name || ' ' || data_type || ' null=' || is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'notifications'
        order by column_name`,
    );

    expect(columns.split("\n")).toEqual([
      "club_id uuid null=NO",
      "created_at timestamp with time zone null=NO",
      "data jsonb null=NO",
      "id uuid null=NO",
      "read_at timestamp with time zone null=YES",
      "type text null=NO",
      "user_id uuid null=NO",
    ]);
  });

  it("guarda un aviso nuevo sin leer", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);
    const insercion = await insertNotification(database, { userId });
    expect(insercion.code, insercion.stderr).toBe(0);

    const readAt = await database.query(
      "select coalesce(read_at::text, 'sin leer') from public.notifications",
    );

    expect(readAt).toBe("sin leer");
  });

  it("es idempotente: aplicada dos veces no falla ni duplica nada", async () => {
    const database = await migratedDatabase();
    const despuesDeLaPrimera = await database.snapshot();

    const segunda = await applyRepositoryMigrations(database);

    expect(segunda.code, segunda.stderr).toBe(0);
    // Dos cadenas vacías también son iguales: la tabla tiene que estar ahí.
    expect(despuesDeLaPrimera).toMatch(/tabla notifications rls=t/);
    expect(await database.snapshot()).toBe(despuesDeLaPrimera);
  });
});

describeConPostgres("el tipo y los datos de un aviso", () => {
  it.each(["role_changed", "role_request_rejected", "role_request_received"])(
    "acepta el tipo %s",
    async (type) => {
      const database = await migratedDatabase();
      const userId = await seedMember(database);

      const insercion = await insertNotification(database, { userId, type });

      expect(insercion.code, insercion.stderr).toBe(0);
    },
  );

  it.each(["event_created", "ROLE_CHANGED", ""])(
    "rechaza el tipo '%s', que no está en el catálogo",
    async (type) => {
      const database = await migratedDatabase();
      const userId = await seedMember(database);

      const insercion = await insertNotification(database, { userId, type });

      expect(insercion.code).toBeGreaterThan(0);
      expect(insercion.stderr).toMatch(/notifications_type_check/);
    },
  );

  it.each([
    ["una lista", `'["Coach"]'`],
    ["un texto", `'"Coach"'`],
    ["un número", "'1'"],
    ["null de JSON", "'null'"],
  ])("rechaza unos datos que son %s", async (_caso, data) => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);

    const insercion = await insertNotification(database, { userId, data });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/notifications_data_is_object/);
  });

  it("acepta un objeto vacío como datos", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);

    const insercion = await insertNotification(database, {
      userId,
      data: "'{}'",
    });

    expect(insercion.code, insercion.stderr).toBe(0);
  });
});

describeConPostgres("el destinatario de un aviso", () => {
  it("rechaza un destinatario de otro club que el del aviso", async () => {
    const database = await migratedDatabase();
    const otherClubId = await seedOtherClub(database);
    const userId = await seedMember(database, otherClubId);

    const insercion = await insertNotification(database, { userId });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/notifications_member_same_club_fkey/);
  });

  it("rechaza un destinatario que no es socio", async () => {
    const database = await migratedDatabase();
    const identityWithoutMember = await database.query(
      "insert into auth.users (id) values (gen_random_uuid()) returning id",
    );

    const insercion = await insertNotification(database, {
      userId: identityWithoutMember,
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/notifications_member_same_club_fkey/);
  });

  it("borra los avisos de un socio cuando se borra su identidad", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);
    const otro = await seedMember(database);
    await insertNotification(database, { userId });
    await insertNotification(database, { userId: otro });
    expect(await countNotifications(database)).toBe("2");

    await database.query(`delete from auth.users where id = '${userId}'`);

    expect(await countNotifications(database)).toBe("1");
  });
});

describeConPostgres("el conteo de avisos sin leer", () => {
  it("tiene un índice parcial por destinatario sobre los no leídos", async () => {
    const database = await migratedDatabase();

    const definicion = await database.query(
      `select indexdef from pg_indexes
        where schemaname = 'public' and indexname = '${UNREAD_INDEX}'`,
    );

    expect(definicion).toMatch(/\(user_id\) WHERE \(read_at IS NULL\)/);
  });

  it("cuenta los no leídos de un socio sin recorrer la tabla entera", async () => {
    // Sin filas de verdad el planificador prefiere recorrer: se le quita esa
    // opción para ver si el índice sirve a la consulta, que es lo que importa.
    const database = await migratedDatabase();
    const userId = await seedMember(database);

    const plan = await database.query(
      `set enable_seqscan = off;
       explain select count(*) from public.notifications
        where user_id = '${userId}' and read_at is null`,
    );

    expect(plan).toMatch(new RegExp(UNREAD_INDEX));
    expect(plan).not.toMatch(/Seq Scan/);
  });
});

describeConPostgres("policies y privilegios de los avisos", () => {
  it("deja a un socio ver sus avisos y ninguno ajeno", async () => {
    const database = await migratedDatabase();
    const socio = await seedMember(database);
    const otro = await seedMember(database);
    await insertNotification(database, { userId: socio });
    await insertNotification(database, { userId: otro });

    const lectura = await database.attempt(
      asApiIdentity(
        { role: "authenticated", subject: socio },
        "select user_id from public.notifications",
      ),
    );

    expect(lectura.code, lectura.stderr).toBe(0);
    expect(rowsOf(lectura)).toEqual([socio]);
  });

  it.each([
    [
      "crearse un aviso",
      (userId: string) =>
        `insert into public.notifications (club_id, user_id, type, data)
         select club_id, user_id, 'role_changed', '{}' from public.members
          where user_id = '${userId}'`,
    ],
    [
      "marcar un aviso como leído",
      () => "update public.notifications set read_at = now()",
    ],
    ["borrar sus avisos", () => "delete from public.notifications"],
  ] as const)("no deja a un socio %s", async (_accion, buildSql) => {
    // Se exige el error, no sólo que nada cambie: sin el `revoke`, RLS
    // negaría en silencio y el cliente creería que guardó.
    const database = await migratedDatabase();
    const socio = await seedMember(database);
    await insertNotification(database, { userId: socio });

    const intento = await database.attempt(
      asApiIdentity({ role: "authenticated", subject: socio }, buildSql(socio)),
    );

    expect(intento.code).toBeGreaterThan(0);
    expect(intento.stderr).toMatch(/permission denied for table notifications/);
  });

  it("no deja a un cliente anónimo ver nada", async () => {
    const database = await migratedDatabase();

    const lectura = await database.attempt(
      asApiIdentity({ role: "anon" }, "select * from public.notifications"),
    );

    expect(lectura.code).toBeGreaterThan(0);
    expect(lectura.stderr).toMatch(/permission denied for table notifications/);
  });

  it("deja a anon sin privilegios y a authenticated sólo con la lectura", async () => {
    const database = await migratedDatabase();

    const privilegios = await database.query(
      `select grantee || ' ' || privilege_type
         from information_schema.table_privileges
        where table_schema = 'public' and table_name = 'notifications'
          and grantee in ('anon', 'authenticated')
        order by grantee, privilege_type`,
    );

    expect(privilegios.split("\n")).toEqual(["authenticated SELECT"]);
  });

  it("le deja al servidor leer y escribir los avisos", async () => {
    const database = await migratedDatabase();

    const privilegios = await database.query(
      `select privilege_type
         from information_schema.table_privileges
        where table_schema = 'public' and table_name = 'notifications'
          and grantee = 'service_role'`,
    );

    expect(privilegios.split("\n")).toEqual(
      expect.arrayContaining(["DELETE", "INSERT", "SELECT", "UPDATE"]),
    );
  });
});
