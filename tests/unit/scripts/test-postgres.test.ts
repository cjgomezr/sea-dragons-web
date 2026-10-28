import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const TEST_POSTGRES_SCRIPT = path.join(REPO_ROOT, "scripts/test-postgres.sh");

/** Lanzan bash de verdad: ver el mismo timeout en `process-backlog.test.ts`. */
const REAL_PROCESS_TEST_TIMEOUT_MS = 20_000;

const REMOVE_TEMP_DIR_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 200,
} as const;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

function runScript(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [toBashPath(TEST_POSTGRES_SCRIPT), ...args], {
      cwd,
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

interface FakePostgres {
  binDir: string;
  logFile: string;
  root: string;
}

/**
 * `initdb` y `pg_ctl` de mentira: registran cada llamada y responden a
 * `status` según exista el archivo `running` dentro del directorio de datos,
 * que `start` crea y `stop` borra. Así el test no necesita un Postgres.
 */
async function installFakePostgres(workDir: string): Promise<FakePostgres> {
  const binDir = path.join(workDir, "pg-bin");
  const root = path.join(workDir, "pg-root");
  const logFile = path.join(workDir, "pg-calls.log");
  await mkdir(binDir, { recursive: true });
  await mkdir(root, { recursive: true });
  await writeFile(logFile, "");
  const log = toBashPath(logFile);

  await writeFile(
    path.join(binDir, "initdb"),
    `#!/usr/bin/env bash
echo "initdb $*" >> "${log}"
while [ $# -gt 0 ]; do
  if [ "$1" = "-D" ]; then mkdir -p "$2"; echo 17 > "$2/PG_VERSION"; fi
  shift
done
`,
  );
  await writeFile(
    path.join(binDir, "pg_ctl"),
    `#!/usr/bin/env bash
echo "pg_ctl $*" >> "${log}"
data=""; action=""
while [ $# -gt 0 ]; do
  case "$1" in
    -D) data="$2"; shift ;;
    -o|-l|-m) shift ;;
    start|stop|status) action="$1" ;;
  esac
  shift
done
case "$action" in
  start) touch "$data/running" ;;
  stop) rm -f "$data/running" ;;
  status) [ -f "$data/running" ] || exit 3 ;;
esac
`,
  );
  await chmod(path.join(binDir, "initdb"), 0o755);
  await chmod(path.join(binDir, "pg_ctl"), 0o755);
  return { binDir, logFile, root };
}

function fakeEnv(fake: FakePostgres): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PG_BIN: toBashPath(fake.binDir),
    TEST_POSTGRES_ROOT: toBashPath(fake.root),
  };
}

async function setupGitRepo(workDir: string, branch: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "bash",
      ["-c", `git init -q && git checkout -q -b ${branch}`],
      { cwd: workDir, stdio: "ignore" },
    );
    child.on("error", reject);
    child.on("close", () => resolve());
  });
}

describe("test-postgres.sh", () => {
  let workDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, REMOVE_TEMP_DIR_OPTIONS);
      workDir = "";
    }
  });

  it(
    "crea la base la primera vez, la arranca en el puerto del ticket y da la URL",
    async () => {
      workDir = await mkdtemp(path.join(tmpdir(), "seadragons-test-pg-"));
      const fake = await installFakePostgres(workDir);

      const { code, stdout } = await runScript(
        ["start", "912"],
        workDir,
        fakeEnv(fake),
      );

      expect(code).toBe(0);
      const calls = await readFile(fake.logFile, "utf8");
      expect(calls).toMatch(/initdb .*-U postgres/);
      expect(calls).toMatch(/pg_ctl .*-p 55912.*-w start/);
      expect(stdout).toContain(
        "MIGRATIONS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55912/postgres",
      );
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "no vuelve a arrancar una base que ya está corriendo",
    async () => {
      workDir = await mkdtemp(path.join(tmpdir(), "seadragons-test-pg-"));
      const fake = await installFakePostgres(workDir);
      await runScript(["start", "912"], workDir, fakeEnv(fake));
      await writeFile(fake.logFile, "");

      const { code, stdout } = await runScript(
        ["start", "912"],
        workDir,
        fakeEnv(fake),
      );

      expect(code).toBe(0);
      const calls = await readFile(fake.logFile, "utf8");
      expect(calls).not.toMatch(/initdb/);
      expect(calls).not.toMatch(/ start/);
      expect(stdout).toContain("127.0.0.1:55912");
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "toma el ticket de la rama impl-N cuando no se lo pasan",
    async () => {
      workDir = await mkdtemp(path.join(tmpdir(), "seadragons-test-pg-"));
      const fake = await installFakePostgres(workDir);
      await setupGitRepo(workDir, "impl-907");

      const { code, stdout } = await runScript(
        ["start"],
        workDir,
        fakeEnv(fake),
      );

      expect(code).toBe(0);
      expect(stdout).toContain("127.0.0.1:55907");
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "falla con un mensaje claro si no sabe de qué ticket es",
    async () => {
      workDir = await mkdtemp(path.join(tmpdir(), "seadragons-test-pg-"));
      const fake = await installFakePostgres(workDir);
      await setupGitRepo(workDir, "otra-rama");

      const { code, stderr } = await runScript(
        ["start"],
        workDir,
        fakeEnv(fake),
      );

      expect(code).not.toBe(0);
      expect(stderr).toMatch(/número del ticket/);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "stop para la base y borra su directorio",
    async () => {
      workDir = await mkdtemp(path.join(tmpdir(), "seadragons-test-pg-"));
      const fake = await installFakePostgres(workDir);
      await runScript(["start", "912"], workDir, fakeEnv(fake));
      await writeFile(fake.logFile, "");

      const { code } = await runScript(["stop", "912"], workDir, fakeEnv(fake));

      expect(code).toBe(0);
      const calls = await readFile(fake.logFile, "utf8");
      expect(calls).toMatch(/pg_ctl .*stop/);
      expect(existsSync(path.join(fake.root, "912"))).toBe(false);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "stop no hace nada y sale bien si la base nunca se creó",
    async () => {
      workDir = await mkdtemp(path.join(tmpdir(), "seadragons-test-pg-"));
      const fake = await installFakePostgres(workDir);

      const { code } = await runScript(["stop", "912"], workDir, fakeEnv(fake));

      expect(code).toBe(0);
      const calls = await readFile(fake.logFile, "utf8");
      expect(calls).toBe("");
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "rechaza una acción desconocida",
    async () => {
      workDir = await mkdtemp(path.join(tmpdir(), "seadragons-test-pg-"));
      const fake = await installFakePostgres(workDir);

      const { code, stderr } = await runScript(
        ["restart", "912"],
        workDir,
        fakeEnv(fake),
      );

      expect(code).not.toBe(0);
      expect(stderr).toMatch(/start\|stop\|url/);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );
});
