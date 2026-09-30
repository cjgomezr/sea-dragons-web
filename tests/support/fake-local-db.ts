import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Arnés de `copy-dev-to-local.sh` y `restore-local-backup.sh` (#448): un
 * `supabase` y un `psql` de mentira delante del PATH, con el mismo patrón que
 * `tests/unit/scripts/task-status.test.ts`. Cada invocación queda en un log;
 * lo que responden se decide con archivos en `fixtures/`. */

export const REPO_ROOT = path.resolve(__dirname, "..", "..");

export const LOCAL_DB_URL =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** Esquema por defecto de las dos bases: iguales. */
export const DEFAULT_SCHEMA = "table public.members\ntable public.groups\n";

export interface RunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface FakeLocalDb {
  readonly workDir: string;
  readonly fixturesDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly run: (script: string, args: readonly string[]) => Promise<RunResult>;
  readonly calls: () => Promise<string[]>;
  readonly restoreInput: () => Promise<string>;
  readonly dumpFile: (origin: "local" | "dev") => Promise<string>;
  readonly setFixture: (name: string, content: string) => Promise<void>;
}

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

/** `supabase`: `status` sale con `status.exit` (0 si no existe); `db dump`
 * escribe en el `-f` un volcado que dice de dónde salió, salvo que exista
 * `backup.exit` y el volcado sea el local. Anota la ruta de cada volcado en
 * `dump-files.log`, para poder comprobar después que el de desarrollo se
 * borró. */
function fakeSupabase(logFile: string, fixturesDir: string): string {
  return `#!/usr/bin/env bash
echo "supabase $*" >> "${logFile}"
FIXTURES="${fixturesDir}"
if [ "$1" = "status" ]; then
  exit "$(cat "$FIXTURES/status.exit" 2>/dev/null || echo 0)"
fi
if [ "$1" = "db" ] && [ "$2" = "dump" ]; then
  origin=dev
  file=""
  previous=""
  for arg in "$@"; do
    [ "$arg" = "--local" ] && origin=local
    if [ "$previous" = "-f" ] || [ "$previous" = "--file" ]; then file="$arg"; fi
    previous="$arg"
  done
  echo "$origin $file" >> "$FIXTURES/dump-files.log"
  if [ "$origin" = "local" ] && [ -f "$FIXTURES/backup.exit" ]; then
    exit "$(cat "$FIXTURES/backup.exit")"
  fi
  printf -- '-- volcado %s\\nINSERT INTO "public"."members" ("id") VALUES (1);\\n' "$origin" > "$file"
  exit 0
fi
exit 0
`;
}

/** `psql`: si lee `schema-snapshot.sql`, describe la base con
 * `schema-local.txt` o `schema-dev.txt` según el puerto de la URL. Si no,
 * es una restauración: guarda la entrada en `restore-input.sql` y sale con
 * `restore.exit`, escribiendo `restore.stderr` en stderr. */
function fakePsql(logFile: string, fixturesDir: string): string {
  return `#!/usr/bin/env bash
echo "psql $*" >> "${logFile}"
FIXTURES="${fixturesDir}"
case "$*" in
  *schema-snapshot.sql*)
    case "$1" in
      *:54322*) cat "$FIXTURES/schema-local.txt" ;;
      *) cat "$FIXTURES/schema-dev.txt" ;;
    esac
    exit 0
    ;;
esac
cat >> "$FIXTURES/restore-input.sql"
[ -f "$FIXTURES/restore.stderr" ] && cat "$FIXTURES/restore.stderr" >&2
exit "$(cat "$FIXTURES/restore.exit" 2>/dev/null || echo 0)"
`;
}

async function installExecutable(file: string, content: string): Promise<void> {
  await writeFile(file, content);
  await chmod(file, 0o755);
}

function runScript(
  script: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [path.join(REPO_ROOT, script), ...args], {
      ...options,
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

async function readOrEmpty(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

export async function installFakeLocalDb(
  devDbUrl: string | undefined,
): Promise<FakeLocalDb> {
  const workDir = await mkdtemp(path.join(tmpdir(), "seadragons-local-db-"));
  const binDir = path.join(workDir, "stub-bin");
  const fixturesDir = path.join(workDir, "fixtures");
  await mkdir(binDir, { recursive: true });
  await mkdir(fixturesDir, { recursive: true });
  const logFile = path.join(workDir, "calls.log");
  await writeFile(logFile, "");
  await writeFile(path.join(fixturesDir, "schema-local.txt"), DEFAULT_SCHEMA);
  await writeFile(path.join(fixturesDir, "schema-dev.txt"), DEFAULT_SCHEMA);

  const bashLog = toBashPath(logFile);
  const bashFixtures = toBashPath(fixturesDir);
  await installExecutable(
    path.join(binDir, "supabase"),
    fakeSupabase(bashLog, bashFixtures),
  );
  await installExecutable(
    path.join(binDir, "psql"),
    fakePsql(bashLog, bashFixtures),
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
  };
  delete env.SUPABASE_LOCAL_DB_URL;
  delete env.SUPABASE_DEV_DB_URL;
  if (devDbUrl !== undefined) {
    env.SUPABASE_DEV_DB_URL = devDbUrl;
  }

  const lines = async (file: string): Promise<string[]> =>
    (await readOrEmpty(file)).split("\n").filter((line) => line.length > 0);

  return {
    workDir,
    fixturesDir,
    env,
    run: (script, args) => runScript(script, args, { cwd: workDir, env }),
    calls: () => lines(logFile),
    restoreInput: () =>
      readOrEmpty(path.join(fixturesDir, "restore-input.sql")),
    dumpFile: async (origin) => {
      const entries = await lines(path.join(fixturesDir, "dump-files.log"));
      const entry = entries.find((line) => line.startsWith(`${origin} `));
      if (entry === undefined) {
        throw new Error(`no hubo volcado ${origin}`);
      }
      return entry.slice(origin.length + 1);
    },
    setFixture: (name, content) =>
      writeFile(path.join(fixturesDir, name), content),
  };
}
