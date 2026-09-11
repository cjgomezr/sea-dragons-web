import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SCHEMA_DRIFT_LIB = path.join(REPO_ROOT, "scripts/lib/schema-drift.sh");

/** Descripción de esquema de juguete: las líneas reales las genera
 * `supabase/ci/schema-snapshot.sql`, pero la clasificación sólo mira qué línea
 * está en qué lado. Con líneas legibles, el fallo de un test dice qué pasó. */
const ESQUEMA_DEL_REPOSITORIO = [
  "tabla clubs rls=t",
  "columna clubs.id tipo=uuid null=NO default=gen_random_uuid()",
  "policy clubs.clubs_select_authenticated cmd=SELECT",
];

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

function run(args: readonly string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [...args], {
      cwd: REPO_ROOT,
      env: process.env,
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

const temporaryDirectories: string[] = [];

async function writeDescription(
  directory: string,
  name: string,
  lines: readonly string[],
): Promise<string> {
  const file = path.join(directory, name);
  await writeFile(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

/** Carga la biblioteca y clasifica las dos descripciones, igual que hace
 * `scripts/check-schema-snapshot.sh`. */
async function classify(
  repositorio: readonly string[],
  base: readonly string[],
): Promise<RunResult> {
  const directory = await mkdtemp(path.join(tmpdir(), "divergencia-"));
  temporaryDirectories.push(directory);
  const expected = await writeDescription(
    directory,
    "repositorio.txt",
    repositorio,
  );
  const actual = await writeDescription(directory, "base.txt", base);

  return classifyFiles(expected, actual);
}

function classifyFiles(expected: string, actual: string): Promise<RunResult> {
  return run([
    "-c",
    'set -euo pipefail; . "$1"; classify_schema_drift "$2" "$3"',
    "bash",
    toBashPath(SCHEMA_DRIFT_LIB),
    toBashPath(expected),
    toBashPath(actual),
  ]);
}

function state(result: RunResult): string {
  return result.stdout.trim();
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("comprobación de divergencia", () => {
  it("dice que son iguales cuando la base tiene lo que el repositorio declara", async () => {
    const resultado = await classify(
      ESQUEMA_DEL_REPOSITORIO,
      ESQUEMA_DEL_REPOSITORIO,
    );

    expect(state(resultado)).toBe("iguales");
  });

  it("dice que el repositorio va por delante cuando a la base le falta un objeto", async () => {
    // Es el estado de producción entre el merge y la corrida del workflow: hay
    // una migración escrita que todavía no llegó a la base.
    const resultado = await classify(
      ESQUEMA_DEL_REPOSITORIO,
      ESQUEMA_DEL_REPOSITORIO.slice(0, -1),
    );

    expect(state(resultado)).toBe("repositorio-por-delante");
  });

  it("dice que la base va por delante cuando tiene un objeto que el repositorio no declara", async () => {
    // El estado alarmante: alguien tocó la base por fuera de una migración, o
    // se añadió una sin regenerar la descripción del repositorio.
    const resultado = await classify(ESQUEMA_DEL_REPOSITORIO, [
      ...ESQUEMA_DEL_REPOSITORIO,
      "tabla intrusa rls=f",
    ]);

    expect(state(resultado)).toBe("base-por-delante");
  });

  it("dice que divergieron cuando cada lado tiene algo que el otro no", async () => {
    const resultado = await classify(ESQUEMA_DEL_REPOSITORIO, [
      ...ESQUEMA_DEL_REPOSITORIO.slice(0, -1),
      "tabla intrusa rls=f",
    ]);

    expect(state(resultado)).toBe("divergieron");
  });

  it("trata una base vacía como repositorio por delante, no como iguales", async () => {
    const resultado = await classify(ESQUEMA_DEL_REPOSITORIO, []);

    expect(state(resultado)).toBe("repositorio-por-delante");
  });

  it("no cambia de respuesta según el orden en que vengan las líneas", async () => {
    // Las dos descripciones se ordenan con la misma colación antes de
    // compararse. Sin eso, dos bases idénticas descritas por máquinas con
    // locales distintos se leerían como divergentes.
    const resultado = await classify(
      ESQUEMA_DEL_REPOSITORIO,
      [...ESQUEMA_DEL_REPOSITORIO].reverse(),
    );

    expect(state(resultado)).toBe("iguales");
  });

  it("sale en verde en cualquiera de los cuatro estados: el veredicto lo pone quien llama", async () => {
    // Clasificar no es juzgar. Si devolviera distinto de cero, quien la use
    // bajo `set -e` moriría antes de poder explicar la diferencia.
    const resultado = await classify(ESQUEMA_DEL_REPOSITORIO, []);

    expect(resultado.code, resultado.stderr).toBe(0);
  });

  it("falla en vez de inventarse un estado cuando le falta un archivo", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "divergencia-"));
    temporaryDirectories.push(directory);
    const expected = await writeDescription(
      directory,
      "repositorio.txt",
      ESQUEMA_DEL_REPOSITORIO,
    );

    const resultado = await classifyFiles(
      expected,
      path.join(directory, "no-existe.txt"),
    );

    expect(resultado.code).toBeGreaterThan(0);
    expect(resultado.stdout.trim()).toBe("");
    expect(resultado.stderr).toMatch(/no-existe\.txt/);
  });
});
