import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/start-local-supabase.sh");

/** Lo que la app y las pruebas usan: la base, Auth, la API REST, Storage y
 * Kong, que es la puerta por la que pasan los tres. */
const REQUIRED_SERVICES = ["gotrue", "postgrest", "storage-api", "kong"];

/** Lo que el issue #535 pide no levantar, más lo que sólo existe para ello:
 * `postgres-meta` sólo lo usa Studio, `vector` sólo alimenta a la analítica,
 * `imgproxy` sólo sirve si se activan las transformaciones de imágenes y
 * `supavisor` es el pooler, que la app no usa. */
const EXCLUDED_SERVICES = [
  "studio",
  "postgres-meta",
  "realtime",
  "edge-runtime",
  "logflare",
  "vector",
  "mailpit",
  "imgproxy",
  "supavisor",
];

const LOCAL_URL = "http://127.0.0.1:54321";
const ANON_KEY = "anon-de-ejemplo";
const SERVICE_ROLE_KEY = "service-role-de-ejemplo";

const STATUS_ENV = [
  `API_URL="${LOCAL_URL}"`,
  'DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"',
  `ANON_KEY="${ANON_KEY}"`,
  `SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY}"`,
  'JWT_SECRET="secreto-de-ejemplo"',
].join("\n");

const BROKEN_MIGRATION_OUTPUT = [
  "Applying migration 0001_clubs.sql...",
  "Applying migration 0042_broken.sql...",
  'ERROR: syntax error at or near "tabel" (SQLSTATE 42601)',
  "At statement: 0",
].join("\n");

const UNHEALTHY_STORAGE_OUTPUT = [
  "Applying migration 0062_schedule_nightly_cleanup.sql...",
  "supabase_storage_sea-dragons-web container is not ready: unhealthy",
].join("\n");

interface FakeCli {
  /** Salida de cada `start`, en orden; el número es su código de salida. */
  starts: { exitCode: number; output: string }[];
  statusOutput?: string;
}

interface RunResult {
  code: number | null;
  output: string;
  calls: string[];
  githubEnv: string;
}

let workDir: string | undefined;

afterEach(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true });
    workDir = undefined;
  }
});

/** `supabase` de mentira: el `start` número n responde con `start-n.out` y
 * sale con `start-n.exit`; `status -o env` imprime `status.out`. Cada llamada
 * queda en `calls.log`. */
function fakeSupabaseSource(dir: string): string {
  return `#!/usr/bin/env bash
echo "$*" >> "${dir}/calls.log"
if [ "$1" = "start" ]; then
  n=$(( $(cat "${dir}/starts" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "${dir}/starts"
  cat "${dir}/start-$n.out" 2>/dev/null
  exit "$(cat "${dir}/start-$n.exit" 2>/dev/null || echo 1)"
fi
if [ "$1" = "status" ]; then
  cat "${dir}/status.out"
  exit 0
fi
exit 0
`;
}

async function installFakeCli(dir: string, fake: FakeCli): Promise<string> {
  const cli = path.join(dir, "supabase");
  await writeFile(cli, fakeSupabaseSource(dir));
  await chmod(cli, 0o755);
  await Promise.all(
    fake.starts.flatMap(({ exitCode, output }, index) => [
      writeFile(path.join(dir, `start-${index + 1}.exit`), `${exitCode}`),
      writeFile(path.join(dir, `start-${index + 1}.out`), output),
    ]),
  );
  await writeFile(
    path.join(dir, "status.out"),
    fake.statusOutput ?? STATUS_ENV,
  );
  return cli;
}

async function runScript(fake: FakeCli): Promise<RunResult> {
  workDir = await mkdtemp(path.join(tmpdir(), "seadragons-supabase-local-"));
  const dir = workDir;
  const cli = await installFakeCli(dir, fake);
  const githubEnv = path.join(dir, "github-env");
  await writeFile(githubEnv, "");

  const { code, output } = await new Promise<{
    code: number | null;
    output: string;
  }>((resolve, reject) => {
    const child = spawn("bash", [SCRIPT], {
      cwd: REPO_ROOT,
      env: { ...process.env, SUPABASE_CLI: cli, GITHUB_ENV: githubEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ code: exitCode, output }));
  });
  const calls = (await readFile(path.join(dir, "calls.log"), "utf8"))
    .split("\n")
    .filter((line) => line.length > 0);
  return {
    code,
    output,
    calls,
    githubEnv: await readFile(githubEnv, "utf8"),
  };
}

const startsOk = {
  exitCode: 0,
  output: "Started supabase local development setup.",
};

function startCalls(calls: readonly string[]): string[] {
  return calls.filter((call) => call.startsWith("start"));
}

describe("start-local-supabase.sh · arranque", () => {
  it("arranca a la primera y no reintenta", async () => {
    const result = await runScript({ starts: [startsOk] });

    expect(result.code).toBe(0);
    expect(startCalls(result.calls)).toHaveLength(1);
  });

  it.each(EXCLUDED_SERVICES)("no levanta %s", async (service) => {
    const result = await runScript({ starts: [startsOk] });

    const [start] = startCalls(result.calls);
    expect(start?.split(/[\s,]+/)).toContain(service);
  });

  it.each(REQUIRED_SERVICES)("sí levanta %s", async (service) => {
    const result = await runScript({ starts: [startsOk] });

    const [start] = startCalls(result.calls);
    expect(start?.split(/[\s,]+/)).not.toContain(service);
  });

  it("si el primer arranque falla, para lo que quedó y arranca a la segunda", async () => {
    const result = await runScript({
      starts: [{ exitCode: 1, output: UNHEALTHY_STORAGE_OUTPUT }, startsOk],
    });

    expect(result.code).toBe(0);
    expect(startCalls(result.calls)).toHaveLength(2);
    expect(result.calls).toContain("stop --no-backup");
  });

  it("no lo intenta una tercera vez", async () => {
    const result = await runScript({
      starts: [
        { exitCode: 1, output: BROKEN_MIGRATION_OUTPUT },
        { exitCode: 1, output: BROKEN_MIGRATION_OUTPUT },
        startsOk,
      ],
    });

    expect(result.code).not.toBe(0);
    expect(startCalls(result.calls)).toHaveLength(2);
  });

  it("si falla dos veces por una migración, dice cuál y con qué error", async () => {
    const result = await runScript({
      starts: [
        { exitCode: 1, output: BROKEN_MIGRATION_OUTPUT },
        { exitCode: 1, output: BROKEN_MIGRATION_OUTPUT },
      ],
    });

    expect(result.output).toMatch(/::error.*0042_broken\.sql/);
    expect(result.output).toMatch(/::error.*syntax error at or near "tabel"/);
  });

  it("si falla dos veces por un servicio, dice cuál", async () => {
    const result = await runScript({
      starts: [
        { exitCode: 1, output: UNHEALTHY_STORAGE_OUTPUT },
        { exitCode: 1, output: UNHEALTHY_STORAGE_OUTPUT },
      ],
    });

    expect(result.output).toMatch(
      /::error.*supabase_storage_sea-dragons-web container is not ready/,
    );
  });

  it("si falla un servicio después de las migraciones, no culpa a la última", async () => {
    const result = await runScript({
      starts: [
        { exitCode: 1, output: UNHEALTHY_STORAGE_OUTPUT },
        { exitCode: 1, output: UNHEALTHY_STORAGE_OUTPUT },
      ],
    });

    expect(result.output).not.toMatch(/::error.*0062/);
  });

  it("si falla, no deja ninguna variable en el entorno del job", async () => {
    const result = await runScript({
      starts: [
        { exitCode: 1, output: BROKEN_MIGRATION_OUTPUT },
        { exitCode: 1, output: BROKEN_MIGRATION_OUTPUT },
      ],
    });

    expect(result.githubEnv).toBe("");
  });
});

describe("start-local-supabase.sh · variables del job", () => {
  it("lee las llaves de supabase status en formato env", async () => {
    const result = await runScript({ starts: [startsOk] });

    expect(result.calls).toContain("status -o env");
  });

  it.each([
    ["NEXT_PUBLIC_SUPABASE_URL", LOCAL_URL],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY],
    ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY],
  ])("escribe %s en el entorno del job", async (name, value) => {
    const result = await runScript({ starts: [startsOk] });

    expect(result.githubEnv.split("\n")).toContain(`${name}=${value}`);
  });

  it("falla diciendo qué llave falta si status no la da", async () => {
    const result = await runScript({
      starts: [startsOk],
      statusOutput: `API_URL="${LOCAL_URL}"\nANON_KEY="${ANON_KEY}"`,
    });

    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/::error.*SERVICE_ROLE_KEY/);
    expect(result.githubEnv).toBe("");
  });
});
