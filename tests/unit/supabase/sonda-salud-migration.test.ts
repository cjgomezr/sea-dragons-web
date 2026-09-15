import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  freshDatabase,
  migratedDatabase,
} from "../../support/postgres";

/**
 * La función a la que pregunta `GET /api/v1/health`. Existe para que la sonda
 * no tenga que leer una tabla con la llave anónima: su única respuesta es "la
 * base contesta", y es lo único que `anon` puede ejecutar en el esquema.
 */
const HEALTH_PROBE = "public.health_probe()";

/** Los privilegios que la ACL de la función da a `grantee`, ordenados.
 * `PUBLIC` es el pseudo-rol con oid 0, del que heredan todos los demás. */
async function functionPrivilegesOf(
  database: TemporaryDatabase,
  grantee: string,
): Promise<string[]> {
  const rows = await database.query(
    `select a.privilege_type
       from pg_proc p
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = '${HEALTH_PROBE}'::regprocedure
        and case when a.grantee = 0 then 'PUBLIC'
                 else pg_get_userbyid(a.grantee) end = '${grantee}'
      order by a.privilege_type`,
  );
  return rows === "" ? [] : rows.split("\n");
}

async function probeAttributes(
  database: TemporaryDatabase,
  column: string,
): Promise<string> {
  return database.query(
    `select ${column} from pg_proc where oid = '${HEALTH_PROBE}'::regprocedure`,
  );
}

describeConPostgres("función de salud", () => {
  it("existe y responde sin error a una llamada anónima", async () => {
    const database = await migratedDatabase();

    const llamada = await database.attempt(
      `set role anon; select ${HEALTH_PROBE}`,
    );

    expect(llamada.code, llamada.stderr).toBe(0);
    expect(llamada.stdout.trim()).toBe("t");
  });

  it("responde un booleano, así que no puede devolver datos del club", async () => {
    const database = await migratedDatabase();

    expect(await probeAttributes(database, "pg_get_function_result(oid)")).toBe(
      "boolean",
    );
  });

  it("anon tiene execute y ningún otro privilegio sobre ella", async () => {
    const database = await migratedDatabase();

    expect(await functionPrivilegesOf(database, "anon")).toEqual(["EXECUTE"]);
  });

  it("no la hereda nadie más por PUBLIC ni por la ACL por defecto", async () => {
    // Postgres concede `execute` a PUBLIC en toda función nueva, y Supabase
    // además a los tres roles de la API. Sin los `revoke`, `authenticated` la
    // tendría por cualquiera de los dos caminos.
    const database = await migratedDatabase();

    expect(await functionPrivilegesOf(database, "PUBLIC")).toEqual([]);
    expect(await functionPrivilegesOf(database, "authenticated")).toEqual([]);
    expect(await functionPrivilegesOf(database, "service_role")).toEqual([]);
  });

  it("corre con los privilegios de quien la llama, no de quien la creó", async () => {
    // Una función `security definer` sería una puerta trasera a lo que `anon`
    // no tiene. Esta no la necesita: no lee ninguna tabla.
    const database = await migratedDatabase();

    expect(await probeAttributes(database, "prosecdef")).toBe("f");
  });

  it("fija un search_path vacío en vez de heredar el de la sesión", async () => {
    const database = await migratedDatabase();

    // Postgres guarda el `''` de la migración como `""`, y el array lo escapa.
    expect(await probeAttributes(database, "proconfig::text")).toBe(
      '{"search_path=\\"\\""}',
    );
  });
});

describeConPostgres("migración 0008", () => {
  it("es idempotente: aplicada dos veces no falla ni cambia los privilegios", async () => {
    const database = await migratedDatabase();
    const despuesDeLaPrimera = await database.snapshot();

    const segunda = await applyRepositoryMigrations(database);

    expect(segunda.code, segunda.stderr).toBe(0);
    expect(despuesDeLaPrimera).toMatch(/funcion health_probe\(\)/);
    expect(await database.snapshot()).toBe(despuesDeLaPrimera);
    expect(await functionPrivilegesOf(database, "anon")).toEqual(["EXECUTE"]);
  });

  it("quita el execute aunque la función naciera concedida a los roles de la API", async () => {
    // El sustrato importa: si esta base no reprodujera la ACL por defecto de
    // Supabase para funciones, el caso de `authenticated` pasaría por la
    // ausencia del privilegio y no por la migración.
    const database = await freshDatabase();
    const sinMigrar = await database.query(
      `select count(*)
         from pg_default_acl d
         join pg_namespace n on n.oid = d.defaclnamespace
        where n.nspname = 'public' and d.defaclobjtype = 'f'`,
    );
    expect(sinMigrar).not.toBe("0");

    const aplicadas = await applyRepositoryMigrations(database);

    expect(aplicadas.code, aplicadas.stderr).toBe(0);
    expect(await functionPrivilegesOf(database, "authenticated")).toEqual([]);
  });
});
