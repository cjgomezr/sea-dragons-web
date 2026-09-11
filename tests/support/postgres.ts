import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { describe, it, onTestFinished } from "vitest";

/**
 * Arnés compartido de los tests que necesitan un Postgres de verdad: los del
 * aplicador de migraciones y los de cada migración del repositorio. Vive aquí
 * porque crear una base desechable, sembrarle los roles de la API de Supabase
 * y borrarla al terminar es la misma ceremonia para todos, y copiarla por
 * archivo haría que cada copia se fuera enterando por su cuenta de los
 * cambios (la normalización del CRLF de psql en Windows, por ejemplo).
 */

export const REPO_ROOT = path.resolve(__dirname, "../..");
export const APPLY_MIGRATIONS = path.join(
  REPO_ROOT,
  "scripts/apply-migrations.sh",
);
export const ROLES_SQL = path.join(REPO_ROOT, "supabase/ci/roles.sql");
export const SCHEMA_SNAPSHOT_SQL = path.join(
  REPO_ROOT,
  "supabase/ci/schema-snapshot.sql",
);
export const CHECK_SCHEMA_SNAPSHOT = path.join(
  REPO_ROOT,
  "scripts/check-schema-snapshot.sh",
);
/** El comprobador la carga con `source`, así que la copia de usar y tirar la
 * necesita al lado o muere antes de comparar nada. */
export const SCHEMA_DRIFT_LIB = path.join(
  REPO_ROOT,
  "scripts/lib/schema-drift.sh",
);
export const EXPECTED_SCHEMA = path.join(
  REPO_ROOT,
  "supabase/ci/schema-expected.txt",
);

/**
 * Conexión de administración desde la que estos tests crean y destruyen bases
 * desechables. Sin ella no hay Postgres contra el que probar y el bloque se
 * salta, igual que hace `describeRls` cuando falta Supabase. En CI la pone
 * `migrations.yml`, apuntando al Postgres efímero del runner: nunca a una base
 * real.
 */
export const ADMIN_URL_ENV = "MIGRATIONS_TEST_DATABASE_URL";
/** Bandera que pone `migrations.yml`: ahí saltarse los tests no es aceptable. */
export const REQUIRE_POSTGRES_ENV = "REQUIRE_MIGRATIONS_POSTGRES";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Bash en Windows no entiende las contrabarras de una ruta nativa. */
export function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

export function run(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

export function applyMigrations(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunResult> {
  return run("bash", [toBashPath(APPLY_MIGRATIONS), ...args], env);
}

export type PostgresDecision = "corre" | "exige" | "salta";

/**
 * Qué hacer con los tests que necesitan una base. Saltarlos es lo correcto en
 * una máquina sin Postgres y en `checks.yml`, que corre `npm test` sin base
 * ninguna. Lo que no puede pasar es que se salten en el workflow de
 * migraciones, donde son media cobertura del ticket: ahí se perderían la
 * prueba de la migración rota y la corrida se leería verde. Por eso
 * `migrations.yml` pide estos tests explícitamente y la falta de base pasa a
 * ser un fallo, no un salto.
 */
export function decidePostgresTests(
  env: Readonly<Record<string, string | undefined>>,
): PostgresDecision {
  if (env[ADMIN_URL_ENV]) {
    return "corre";
  }
  return env[REQUIRE_POSTGRES_ENV] === "1" ? "exige" : "salta";
}

/** `describe` para los casos que sólo tienen sentido contra un Postgres real. */
export function describeConPostgres(name: string, fn: () => void): void {
  const decision = decidePostgresTests(process.env);
  if (decision === "corre") {
    describe(name, fn);
    return;
  }
  if (decision === "exige") {
    describe(name, () => {
      it(`no se saltan: ${REQUIRE_POSTGRES_ENV}=1 los exige`, () => {
        throw new Error(
          `falta ${ADMIN_URL_ENV}: sin ella estos tests se saltarían y la ` +
            `corrida se leería verde sin haber probado ninguna migración`,
        );
      });
    });
    return;
  }
  describe.skip(`${name} (saltado: falta ${ADMIN_URL_ENV})`, fn);
}

export function psql(url: string, args: readonly string[]): Promise<RunResult> {
  return run(
    "psql",
    [
      "--no-psqlrc",
      "--quiet",
      "--set",
      "ON_ERROR_STOP=1",
      "-At",
      "-d",
      url,
      ...args,
    ],
    process.env,
  );
}

export async function expectPsqlSuccess(
  url: string,
  args: readonly string[],
): Promise<string> {
  const result = await psql(url, args);
  if (result.code !== 0) {
    throw new Error(`psql ${args.join(" ")} falló: ${result.stderr}`);
  }
  // psql termina las líneas con CRLF en Windows: sin normalizar, cada fila
  // menos la última llegaría con un \r pegado al valor.
  return result.stdout.replace(/\r\n/g, "\n").trim();
}

export interface TemporaryDatabase {
  readonly url: string;
  /** Corre `sql` y devuelve su salida, fallando si psql sale en rojo. */
  readonly query: (sql: string) => Promise<string>;
  /** Corre `sql` y devuelve el resultado sin fallar: para esperar un rechazo. */
  readonly attempt: (sql: string) => Promise<RunResult>;
  readonly snapshot: () => Promise<string>;
  readonly checkSchema: () => Promise<RunResult>;
}

/**
 * Crea una base desechable con los roles de la API de Supabase ya puestos, y
 * la borra cuando termina el test que la pidió. Sólo se puede llamar desde
 * dentro de un test: la limpieza se engancha a ese test, no al archivo.
 */
export async function freshDatabase(): Promise<TemporaryDatabase> {
  const adminUrl = process.env[ADMIN_URL_ENV];
  if (!adminUrl) {
    throw new Error(`falta ${ADMIN_URL_ENV}`);
  }
  const name = `migraciones_${randomUUID().replace(/-/g, "")}`;
  await expectPsqlSuccess(adminUrl, ["-c", `create database ${name}`]);
  onTestFinished(async () => {
    const dropped = await psql(adminUrl, [
      "-c",
      `drop database if exists ${name} with (force)`,
    ]);
    if (dropped.code !== 0) {
      // Que quede dicho: si no, las bases se acumulan sin que nadie lo sepa.
      console.warn(`no se pudo borrar la base ${name}: ${dropped.stderr}`);
    }
  });

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();
  // Un Postgres recién creado no trae los roles de la API de Supabase, a los
  // que las migraciones hacen GRANT.
  await expectPsqlSuccess(databaseUrl, ["-f", toBashPath(ROLES_SQL)]);

  return {
    url: databaseUrl,
    query: (sql: string) => expectPsqlSuccess(databaseUrl, ["-c", sql]),
    attempt: (sql: string) => psql(databaseUrl, ["-c", sql]),
    snapshot: () =>
      expectPsqlSuccess(databaseUrl, ["-f", toBashPath(SCHEMA_SNAPSHOT_SQL)]),
    checkSchema: () =>
      run("bash", [toBashPath(CHECK_SCHEMA_SNAPSHOT)], {
        ...process.env,
        DATABASE_URL: databaseUrl,
      }),
  };
}

/** Aplica el histórico completo del repositorio sobre `database`. */
export async function applyRepositoryMigrations(
  database: TemporaryDatabase,
): Promise<RunResult> {
  return applyMigrations([], { ...process.env, DATABASE_URL: database.url });
}
