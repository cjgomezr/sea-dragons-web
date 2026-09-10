import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const APPLY_MIGRATIONS = path.join(REPO_ROOT, "scripts/apply-migrations.sh");
const ROLES_SQL = path.join(REPO_ROOT, "supabase/ci/roles.sql");
const SCHEMA_SNAPSHOT_SQL = path.join(
  REPO_ROOT,
  "supabase/ci/schema-snapshot.sql",
);
const CHECK_SCHEMA_SNAPSHOT = path.join(
  REPO_ROOT,
  "scripts/check-schema-snapshot.sh",
);
const EXPECTED_SCHEMA = path.join(REPO_ROOT, "supabase/ci/schema-expected.txt");

/**
 * Conexión de administración desde la que estos tests crean y destruyen bases
 * desechables. Sin ella no hay Postgres contra el que probar y el bloque se
 * salta, igual que hace `describeRls` cuando falta Supabase. En CI la pone
 * `migrations.yml`, apuntando al Postgres efímero del runner: nunca a una base
 * real.
 */
const ADMIN_URL_ENV = "MIGRATIONS_TEST_DATABASE_URL";
/** Bandera que pone `migrations.yml`: ahí saltarse los tests no es aceptable. */
const REQUIRE_POSTGRES_ENV = "REQUIRE_MIGRATIONS_POSTGRES";
const adminUrl = process.env[ADMIN_URL_ENV];

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

function run(
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

function applyMigrations(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunResult> {
  return run("bash", [toBashPath(APPLY_MIGRATIONS), ...args], env);
}

function listedNames(result: RunResult): string[] {
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => path.basename(line));
}

const temporaryDirectories: string[] = [];

async function migrationsDirectory(
  files: Readonly<Record<string, string>>,
): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "migraciones-"));
  temporaryDirectories.push(directory);
  for (const [name, sql] of Object.entries(files)) {
    await writeFile(path.join(directory, name), sql, "utf8");
  }
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("orden de migraciones", () => {
  it("devuelve las migraciones por nombre ascendente, no por fecha de creación", async () => {
    const directory = await migrationsDirectory({
      "0010_diez.sql": "select 1;",
      "0002_dos.sql": "select 1;",
      "0001_uno.sql": "select 1;",
    });

    const result = await applyMigrations([
      "--list",
      "--dir",
      toBashPath(directory),
    ]);

    expect(result.code).toBe(0);
    expect(listedNames(result)).toEqual([
      "0001_uno.sql",
      "0002_dos.sql",
      "0010_diez.sql",
    ]);
  });

  it("ordena por lo que viene después cuando dos comparten prefijo de fecha", async () => {
    const directory = await migrationsDirectory({
      "20260910_beta.sql": "select 1;",
      "20260910_alfa.sql": "select 1;",
      "20260909_previa.sql": "select 1;",
    });

    const result = await applyMigrations([
      "--list",
      "--dir",
      toBashPath(directory),
    ]);

    expect(listedNames(result)).toEqual([
      "20260909_previa.sql",
      "20260910_alfa.sql",
      "20260910_beta.sql",
    ]);
  });

  it("da el mismo orden sea cual sea el locale del runner", async () => {
    // La colación de `sort` depende del locale: en C las mayúsculas van antes
    // que las minúsculas y en en_US.UTF-8 se ordena ignorando la caja, así que
    // este par sí distingue un orden del otro. El script fija LC_ALL=C para
    // que el runner no decida en qué orden se aplican las migraciones.
    const files = {
      "0003_Beta.sql": "select 1;",
      "0003_alfa.sql": "select 1;",
    };
    const enC = await migrationsDirectory(files);
    const enUsUtf8 = await migrationsDirectory(files);

    const [conC, conEnUs] = await Promise.all([
      applyMigrations(["--list", "--dir", toBashPath(enC)], {
        ...process.env,
        LC_ALL: "C",
      }),
      applyMigrations(["--list", "--dir", toBashPath(enUsUtf8)], {
        ...process.env,
        LC_ALL: "en_US.UTF-8",
      }),
    ]);

    expect(listedNames(conC)).toEqual(["0003_Beta.sql", "0003_alfa.sql"]);
    expect(listedNames(conEnUs)).toEqual(listedNames(conC));
  });

  it("ignora lo que no sea un .sql del propio directorio", async () => {
    const directory = await migrationsDirectory({
      "0001_uno.sql": "select 1;",
      "README.md": "no es una migración",
      "0002_dos.sql.bak": "tampoco",
    });
    await mkdir(path.join(directory, "subcarpeta"));
    await writeFile(
      path.join(directory, "subcarpeta", "0003_tres.sql"),
      "select 1;",
      "utf8",
    );

    const result = await applyMigrations([
      "--list",
      "--dir",
      toBashPath(directory),
    ]);

    expect(listedNames(result)).toEqual(["0001_uno.sql"]);
  });
});

describe("aplicador de migraciones", () => {
  it("lista sin necesitar ninguna conexión a una base", async () => {
    const sinBase = { ...process.env };
    delete sinBase.DATABASE_URL;

    const result = await applyMigrations(["--list"], sinBase);

    expect(result.code).toBe(0);
    expect(listedNames(result)).toContain("0001_clubs.sql");
  });

  it("falla diciendo qué variable falta cuando no hay DATABASE_URL", async () => {
    const sinBase = { ...process.env };
    delete sinBase.DATABASE_URL;

    const result = await applyMigrations([], sinBase);

    expect(result.code).toBeGreaterThan(0);
    expect(result.stderr).toMatch(/DATABASE_URL/);
  });

  it("falla cuando el directorio de migraciones no existe", async () => {
    const result = await applyMigrations([
      "--list",
      "--dir",
      toBashPath(path.join(tmpdir(), `no-existe-${randomUUID()}`)),
    ]);

    expect(result.code).toBeGreaterThan(0);
    expect(result.stderr).toMatch(/no existe/i);
  });

  it("falla en vez de dar un verde falso cuando el directorio no tiene migraciones", async () => {
    const directory = await migrationsDirectory({});

    const result = await applyMigrations([
      "--list",
      "--dir",
      toBashPath(directory),
    ]);

    expect(result.code).toBeGreaterThan(0);
    expect(result.stderr).toMatch(/ninguna migración/i);
  });
});

interface TemporaryDatabase {
  readonly url: string;
  readonly query: (sql: string) => Promise<string>;
  readonly snapshot: () => Promise<string>;
  readonly checkSchema: () => Promise<RunResult>;
}

type PostgresDecision = "corre" | "exige" | "salta";

/**
 * Qué hacer con los tests que necesitan una base. Saltarlos es lo correcto en
 * una máquina sin Postgres y en `checks.yml`, que corre `npm test` sin base
 * ninguna. Lo que no puede pasar es que se salten en el workflow de
 * migraciones, donde son media cobertura del ticket: ahí se perderían la
 * prueba de la migración rota y la corrida se leería verde. Por eso
 * `migrations.yml` pide estos tests explícitamente y la falta de base pasa a
 * ser un fallo, no un salto.
 */
function decidePostgresTests(
  env: Readonly<Record<string, string | undefined>>,
): PostgresDecision {
  if (env[ADMIN_URL_ENV]) {
    return "corre";
  }
  return env[REQUIRE_POSTGRES_ENV] === "1" ? "exige" : "salta";
}

describe("tests que necesitan Postgres", () => {
  it("corren cuando hay una base de administración", () => {
    expect(decidePostgresTests({ [ADMIN_URL_ENV]: "postgresql://x" })).toBe(
      "corre",
    );
  });

  it("se exigen, en vez de saltarse, cuando el workflow de migraciones los pide", () => {
    expect(decidePostgresTests({ [REQUIRE_POSTGRES_ENV]: "1" })).toBe("exige");
  });

  it("se saltan cuando nadie los pide y no hay base", () => {
    expect(decidePostgresTests({})).toBe("salta");
  });
});

function describeConPostgres(name: string, fn: () => void): void {
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

function psql(url: string, args: readonly string[]): Promise<RunResult> {
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

async function expectPsqlSuccess(
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

/**
 * Copia del comprobador de esquema en un árbol de usar y tirar. `--write`
 * sobrescribe el archivo esperado que hay junto al script, así que probarlo
 * sobre el repositorio pondría en juego un archivo versionado: si el guardia
 * fallara, el test dejaría el repositorio tocado además de en rojo.
 */
async function sandboxedChecker(): Promise<{
  script: string;
  expectedSchema: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "comprobador-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "scripts"));
  await mkdir(path.join(root, "supabase", "ci"), { recursive: true });

  const script = path.join(root, "scripts", "check-schema-snapshot.sh");
  const expectedSchema = path.join(
    root,
    "supabase",
    "ci",
    "schema-expected.txt",
  );
  await copyFile(CHECK_SCHEMA_SNAPSHOT, script);
  await copyFile(
    SCHEMA_SNAPSHOT_SQL,
    path.join(root, "supabase", "ci", "schema-snapshot.sql"),
  );
  await copyFile(EXPECTED_SCHEMA, expectedSchema);
  return { script, expectedSchema };
}

const createdDatabases: string[] = [];

async function freshDatabase(): Promise<TemporaryDatabase> {
  if (!adminUrl) {
    throw new Error(`falta ${ADMIN_URL_ENV}`);
  }
  const name = `migraciones_${randomUUID().replace(/-/g, "")}`;
  await expectPsqlSuccess(adminUrl, ["-c", `create database ${name}`]);
  createdDatabases.push(name);

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();
  // Un Postgres recién creado no trae los roles de la API de Supabase, a los
  // que las migraciones hacen GRANT.
  await expectPsqlSuccess(databaseUrl, ["-f", toBashPath(ROLES_SQL)]);

  return {
    url: databaseUrl,
    query: (sql: string) => expectPsqlSuccess(databaseUrl, ["-c", sql]),
    snapshot: () =>
      expectPsqlSuccess(databaseUrl, ["-f", toBashPath(SCHEMA_SNAPSHOT_SQL)]),
    checkSchema: () =>
      run("bash", [toBashPath(CHECK_SCHEMA_SNAPSHOT)], {
        ...process.env,
        DATABASE_URL: databaseUrl,
      }),
  };
}

afterEach(async () => {
  if (!adminUrl) {
    return;
  }
  for (const name of createdDatabases.splice(0)) {
    const dropped = await psql(adminUrl, [
      "-c",
      `drop database if exists ${name} with (force)`,
    ]);
    if (dropped.code !== 0) {
      // Que quede dicho: si no, las bases se acumulan sin que nadie lo sepa.
      console.warn(`no se pudo borrar la base ${name}: ${dropped.stderr}`);
    }
  }
});

describeConPostgres(
  "migraciones del repositorio sobre un Postgres limpio",
  () => {
    it("aplica el histórico completo y deja el esquema que declara el repositorio", async () => {
      const database = await freshDatabase();

      const result = await applyMigrations([], {
        ...process.env,
        DATABASE_URL: database.url,
      });

      expect(result.code, result.stderr).toBe(0);
      // El esquema resultante se compara contra `schema-expected.txt`, que es
      // lo que el repositorio declara tener. Cualquier diferencia es un fallo.
      const comparacion = await database.checkSchema();
      expect(comparacion.code, comparacion.stderr).toBe(0);
      expect(await database.query("select slug from public.clubs")).toBe(
        "victoria-seadragons",
      );
    });

    it("la comparación nota que el esquema de la base no es el declarado", async () => {
      // Sin esto, la comparación de arriba pasaría igual siendo incapaz de ver
      // una diferencia.
      const database = await freshDatabase();
      const aplicadas = await applyMigrations([], {
        ...process.env,
        DATABASE_URL: database.url,
      });
      // Si el histórico no se hubiera aplicado, la diferencia se notaría igual
      // y el test pasaría sin haber probado lo que dice probar.
      expect(aplicadas.code, aplicadas.stderr).toBe(0);

      await database.query("create table public.intrusa (id int primary key)");

      const comparacion = await database.checkSchema();
      expect(comparacion.code).toBeGreaterThan(0);
      expect(comparacion.stderr).toMatch(/intrusa/);
      // Y dice cómo arreglarlo cuando la diferencia es la esperada.
      expect(comparacion.stderr).toMatch(/--write/);
    });

    it("aplicar dos veces el histórico no cambia el esquema resultante ni duplica la semilla", async () => {
      // El caso de las dos migraciones que llegan a main el mismo día: la
      // segunda corrida no puede asumir que la primera no corrió.
      const database = await freshDatabase();
      const entorno = { ...process.env, DATABASE_URL: database.url };

      const primera = await applyMigrations([], entorno);
      const despuesDeLaPrimera = await database.snapshot();
      const segunda = await applyMigrations([], entorno);

      expect(primera.code, primera.stderr).toBe(0);
      expect(segunda.code, segunda.stderr).toBe(0);
      // La comparación sólo vale si la descripción del esquema trae algo: dos
      // cadenas vacías también son iguales.
      expect(despuesDeLaPrimera).toMatch(/tabla clubs rls=t/);
      expect(despuesDeLaPrimera).toMatch(
        /policy clubs\.clubs_select_authenticated/,
      );
      expect(await database.snapshot()).toBe(despuesDeLaPrimera);
      expect(await database.query("select count(*) from public.clubs")).toBe(
        "1",
      );
    });

    it("--write regenera una descripción con la que la comparación vuelve a pasar", async () => {
      const database = await freshDatabase();
      const entorno = { ...process.env, DATABASE_URL: database.url };
      await applyMigrations([], entorno);
      await database.query("create table public.nueva (id int primary key)");
      const { script } = await sandboxedChecker();

      const escritura = await run("bash", [toBashPath(script), "--write"], {
        ...process.env,
        DATABASE_URL: database.url,
      });

      expect(escritura.code, escritura.stderr).toBe(0);
      const comparacion = await run("bash", [toBashPath(script)], {
        ...process.env,
        DATABASE_URL: database.url,
      });
      expect(comparacion.code, comparacion.stderr).toBe(0);
    });

    it("--write se niega a guardar el esquema de una base sin migraciones", async () => {
      // Guardar una descripción vacía dejaría la comparación pasando contra
      // cualquier base vacía a partir de ese momento.
      const database = await freshDatabase();
      const { script, expectedSchema } = await sandboxedChecker();
      const antes = await readFile(expectedSchema, "utf8");

      const escritura = await run("bash", [toBashPath(script), "--write"], {
        ...process.env,
        DATABASE_URL: database.url,
      });

      expect(escritura.code).toBeGreaterThan(0);
      expect(escritura.stderr).toMatch(/ningún objeto/i);
      expect(await readFile(expectedSchema, "utf8")).toBe(antes);
    });

    it("se detiene en la primera migración rota y no aplica las siguientes", async () => {
      // La prueba de fuego del ticket: con este código de salida distinto de
      // cero, el paso del workflow (que no lleva continue-on-error) deja el PR
      // en rojo.
      const database = await freshDatabase();
      const directory = await migrationsDirectory({
        "0001_buena.sql": "create table public.buena (id int primary key);",
        "0002_rota.sql": "create table public.rota (id int primary key",
        "0003_nunca.sql": "create table public.nunca (id int primary key);",
      });

      const result = await applyMigrations(["--dir", toBashPath(directory)], {
        ...process.env,
        DATABASE_URL: database.url,
      });

      expect(result.code).toBeGreaterThan(0);
      expect(result.stderr).toMatch(/0002_rota\.sql/);
      const tablas = await database.query(
        "select table_name from information_schema.tables where table_schema = 'public' order by 1",
      );
      expect(tablas.split("\n").filter(Boolean)).toEqual(["buena"]);
    });

    it("deja la migración rota sin aplicar a medias", async () => {
      // Cada archivo va en una sola transacción: una migración que crea dos
      // tablas y falla en la segunda no puede dejar la primera puesta.
      const database = await freshDatabase();
      const directory = await migrationsDirectory({
        "0001_a_medias.sql":
          "create table public.primera (id int primary key);\ncreate table public.segunda (id int primary key",
      });

      const result = await applyMigrations(["--dir", toBashPath(directory)], {
        ...process.env,
        DATABASE_URL: database.url,
      });

      expect(result.code).toBeGreaterThan(0);
      expect(
        await database.query(
          "select count(*) from information_schema.tables where table_schema = 'public'",
        ),
      ).toBe("0");
    });
  },
);
