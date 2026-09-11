import { randomUUID } from "node:crypto";
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
import {
  ADMIN_URL_ENV,
  CHECK_SCHEMA_SNAPSHOT,
  EXPECTED_SCHEMA,
  REQUIRE_POSTGRES_ENV,
  type RunResult,
  SCHEMA_DRIFT_LIB,
  SCHEMA_SNAPSHOT_SQL,
  applyMigrations,
  decidePostgresTests,
  describeConPostgres,
  freshDatabase,
  run,
  toBashPath,
} from "../../support/postgres";

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
  await mkdir(path.join(root, "scripts", "lib"), { recursive: true });
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
    SCHEMA_DRIFT_LIB,
    path.join(root, "scripts", "lib", "schema-drift.sh"),
  );
  await copyFile(
    SCHEMA_SNAPSHOT_SQL,
    path.join(root, "supabase", "ci", "schema-snapshot.sql"),
  );
  await copyFile(EXPECTED_SCHEMA, expectedSchema);
  return { script, expectedSchema };
}

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
      expect(comparacion.stdout.trim()).toBe("iguales");
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
      // La base tiene algo que el repositorio no declara, que es un estado
      // distinto de "le faltan migraciones" y pide un arreglo distinto.
      expect(comparacion.stdout.trim()).toBe("base-por-delante");
    });

    it("distingue que el repositorio va por delante cuando a la base le falta lo declarado", async () => {
      const database = await freshDatabase();
      const aplicadas = await applyMigrations([], {
        ...process.env,
        DATABASE_URL: database.url,
      });
      expect(aplicadas.code, aplicadas.stderr).toBe(0);

      // Una base a la que le falta una tabla declarada es lo que ve la
      // comprobación de divergencia cuando producción se quedó atrás.
      await database.query("drop table public.audit_log");

      const comparacion = await database.checkSchema();

      expect(comparacion.code).toBeGreaterThan(0);
      expect(comparacion.stdout.trim()).toBe("repositorio-por-delante");
      expect(comparacion.stderr).toMatch(/migraciones por aplicar/);
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
      const aplicadas = await applyMigrations([], entorno);
      expect(aplicadas.code, aplicadas.stderr).toBe(0);
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
