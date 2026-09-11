import { expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  freshDatabase,
  migratedDatabase,
} from "../../support/postgres";

/**
 * Los privilegios de `public.clubs` y `public.audit_log` para los dos roles que
 * alcanza la llave anónima. Son la mitad de la frontera de NFR-004 que RLS no
 * cubre: `truncate`, `trigger` y `references` no los filtra ninguna policy, así
 * que una tabla que nace con todos los privilegios concedidos (lo que hace el
 * `pg_default_acl` de este proyecto de Supabase, reproducido en
 * `supabase/ci/roles.sql`) se puede vaciar con la llave que viaja en cada
 * petición del navegador.
 *
 * Se comprueba con una consulta al catálogo y no leyendo el SQL: el privilegio
 * que cuenta es el que la base dice tener después de aplicar el histórico
 * completo, no el que una migración parece conceder.
 */

/** Los privilegios que la base atribuye a `grantee` sobre `table`, ordenados.
 * `role_table_grants` es la misma vista que usa `supabase/ci/schema-snapshot.sql`. */
async function privilegesOf(
  database: TemporaryDatabase,
  table: string,
  grantee: string,
): Promise<string[]> {
  const rows = await database.query(
    `select privilege_type
       from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = '${table}'
        and grantee = '${grantee}'
      order by privilege_type`,
  );
  return rows === "" ? [] : rows.split("\n");
}

/** Envuelve `sql` en el `set role` que PostgREST hace antes de cada consulta.
 * Sin claims del JWT a propósito: ninguna policy de estas dos tablas lee
 * `auth.uid()`, así que el rol es todo lo que hace falta para reproducirlas. */
function asRole(
  role: "anon" | "authenticated" | "service_role",
  sql: string,
): string {
  return `set role ${role}; ${sql}`;
}

/** Escribe un evento en la bitácora como lo hace la aplicación: con la llave de
 * servicio, que es el único camino de escritura que NFR-010 permite. */
async function insertAuditEvent(
  database: TemporaryDatabase,
): Promise<RunResult> {
  const clubId = await database.query(
    "select id from public.clubs where slug = 'victoria-seadragons'",
  );
  return database.attempt(
    asRole(
      "service_role",
      `insert into public.audit_log
         (club_id, actor_id, action, entity_type, entity_id, result)
       values ('${clubId}', gen_random_uuid(), 'sign_in', 'member', 'm-1', 'success')`,
    ),
  );
}

describeConPostgres("privilegios de clubs", () => {
  it("deja a anon sólo con la lectura de la que depende la sonda de salud", async () => {
    // `select` y nada más. La sonda de /api/v1/health lee esta tabla con la
    // llave anónima y sin sesión (src/app/api/v1/health/route.ts), así que
    // quitarle también la lectura dejaría la vigilancia de producción en rojo.
    // RLS sigue sin darle ni una fila: no hay policy para `anon`.
    const database = await migratedDatabase();

    expect(await privilegesOf(database, "clubs", "anon")).toEqual(["SELECT"]);
  });

  it("no deja a authenticated truncar, disparar ni referenciar la tabla", async () => {
    const database = await migratedDatabase();

    // `select` y nada más, así que de los tres que RLS no filtra (`truncate`,
    // `trigger` y `references`) no queda ninguno.
    expect(await privilegesOf(database, "clubs", "authenticated")).toEqual([
      "SELECT",
    ]);
  });
});

describeConPostgres("privilegios de audit_log", () => {
  it("no deja a anon ningún privilegio", async () => {
    const database = await migratedDatabase();

    expect(await privilegesOf(database, "audit_log", "anon")).toEqual([]);
  });

  it("no deja a authenticated ningún privilegio, empezando por los tres que RLS no filtra", async () => {
    // NFR-010: la bitácora la escribe el servidor con la llave de servicio y no
    // la edita quien audita. Hoy ni la lee: su policy de lectura niega a todo
    // `authenticated` hasta que E3 traiga el rol Admin, así que el privilegio
    // que necesita es ninguno.
    const database = await migratedDatabase();

    expect(await privilegesOf(database, "audit_log", "authenticated")).toEqual(
      [],
    );
  });
});

describeConPostgres("privilegios", () => {
  it("no deja a una sesión autenticada truncar clubs", async () => {
    const database = await migratedDatabase();

    const intento = await database.attempt(
      asRole("authenticated", "truncate public.clubs cascade"),
    );

    expect(intento.code).toBeGreaterThan(0);
    expect(intento.stderr).toMatch(/permission denied for table clubs/);
    expect(await database.query("select count(*) from public.clubs")).toBe("1");
  });

  it("no deja a una sesión autenticada truncar audit_log", async () => {
    const database = await migratedDatabase();
    await insertAuditEvent(database);

    const intento = await database.attempt(
      asRole("authenticated", "truncate public.audit_log"),
    );

    expect(intento.code).toBeGreaterThan(0);
    expect(intento.stderr).toMatch(/permission denied for table audit_log/);
    // La fila sigue ahí: sin esto el caso pasaría igual contra una tabla vacía,
    // donde truncar no se nota.
    expect(await database.query("select count(*) from public.audit_log")).toBe(
      "1",
    );
  });

  it("no deja a un cliente anónimo tocar la bitácora ni para mirarla", async () => {
    const database = await migratedDatabase();

    const lectura = await database.attempt(
      asRole("anon", "select id from public.audit_log"),
    );

    expect(lectura.code).toBeGreaterThan(0);
    expect(lectura.stderr).toMatch(/permission denied for table audit_log/);
  });

  it("sigue dejando a la sonda de salud leer clubs con la llave anónima", async () => {
    // El caso de "nada que funcionaba deja de funcionar": la sonda no espera
    // filas (RLS no le da ninguna a `anon`), espera que la consulta no falle.
    const database = await migratedDatabase();

    const sonda = await database.attempt(
      asRole("anon", "select id from public.clubs limit 1"),
    );

    expect(sonda.code, sonda.stderr).toBe(0);
    // Y ni una fila, que es la otra mitad del argumento: el `select` que conserva
    // `anon` es inofensivo porque RLS no le da nada. Si alguien le escribe una
    // policy de lectura a `anon`, este caso lo cuenta. La salida vacía es la
    // lista vacía: con `--quiet` y `-At`, psql no imprime ni etiquetas de
    // sentencia ni cabeceras.
    expect(sonda.stdout.trim()).toBe("");
  });

  it("sigue dejando a una sesión autenticada leer el club sembrado", async () => {
    const database = await migratedDatabase();

    const lectura = await database.attempt(
      asRole(
        "authenticated",
        "select slug from public.clubs where slug = 'victoria-seadragons'",
      ),
    );

    expect(lectura.code, lectura.stderr).toBe(0);
    expect(lectura.stdout).toMatch(/victoria-seadragons/);
  });

  it("sigue dejando a la llave de servicio escribir en la bitácora", async () => {
    // NFR-010 y `recordAuditEvent` (src/lib/audit/audit-log.ts): el único
    // camino de escritura de la bitácora es la llave de servicio, y este
    // ticket no lo toca.
    const database = await migratedDatabase();

    const escritura = await insertAuditEvent(database);

    expect(escritura.code, escritura.stderr).toBe(0);
    expect(await database.query("select count(*) from public.audit_log")).toBe(
      "1",
    );
  });
});

describeConPostgres("migración 0004", () => {
  it("es idempotente: aplicada dos veces no falla ni cambia los privilegios", async () => {
    const database = await migratedDatabase();
    const despuesDeLaPrimera = await database.snapshot();

    const segunda = await applyRepositoryMigrations(database);

    expect(segunda.code, segunda.stderr).toBe(0);
    // La comparación sólo vale si la descripción trae las líneas que importan:
    // dos cadenas vacías también son iguales.
    expect(despuesDeLaPrimera).toMatch(/grant clubs anon SELECT/);
    expect(despuesDeLaPrimera).not.toMatch(/grant clubs anon TRUNCATE/);
    expect(await database.snapshot()).toBe(despuesDeLaPrimera);
  });

  it("quita los privilegios aunque la tabla naciera con todos concedidos", async () => {
    // El sustrato importa: si esta base no reprodujera el `pg_default_acl` del
    // proyecto de Supabase, los casos de arriba pasarían por la ausencia del
    // privilegio y no por la migración, y el verde sería falso.
    const database = await freshDatabase();
    const sinMigrar = await database.query(
      `select count(*)
         from pg_default_acl d
         join pg_namespace n on n.oid = d.defaclnamespace
        where n.nspname = 'public' and d.defaclobjtype = 'r'`,
    );
    expect(sinMigrar).not.toBe("0");

    const aplicadas = await applyRepositoryMigrations(database);

    expect(aplicadas.code, aplicadas.stderr).toBe(0);
    expect(await privilegesOf(database, "audit_log", "anon")).toEqual([]);
  });
});
