import { spawn, type ChildProcess } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const UI_PREFLIGHT_SCRIPT = path.join(REPO_ROOT, "scripts/ui-preflight.sh");
const TEST_TIMEOUT_MS = 20_000;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runPreflight(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["scripts/ui-preflight.sh", ...args], {
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

async function respondsAt(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Servidor HTTP mínimo usado como "dev server" de mentira. `START_DELAY_MS`
 * simula el tiempo de compilación real de Next.js antes de escuchar.
 */
const DUMMY_SERVER_SCRIPT = `
const http = require("http");
const port = process.argv[2];
const delay = Number(process.env.START_DELAY_MS || 0);
setTimeout(() => {
  http.createServer((req, res) => { res.writeHead(200); res.end("ok"); }).listen(port);
}, delay);
`;

/**
 * Simula cómo "npm run dev" se comporta a veces en Windows: el wrapper que
 * `ui-preflight.sh` lanza con \`exec\` no termina siendo el proceso que
 * escucha el puerto. Este arranca el servidor real como hijo, lo desliga y
 * termina de inmediato, dejando el PID capturado por \`$!\` muerto mientras el
 * servidor de verdad sigue vivo.
 */
const DETACHED_WRAPPER_SCRIPT = `#!/usr/bin/env bash
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
node "$DIR/dummy-server.js" "$1" &
disown
exit 0
`;

const NEVER_STARTS_SCRIPT = `#!/usr/bin/env bash
sleep 30
`;

/**
 * `git.exe`/`bash.exe` pueden tardar en soltar el handle del directorio
 * temporal en Windows; un `rm` inmediato falla con `EBUSY: resource busy or
 * locked`. Mismo remedio que `tests/unit/scripts/process-backlog.test.ts`
 * (#55): reintentar en vez de tumbar el test por una limpieza ajena a lo que
 * se verifica.
 */
const REMOVE_TEMP_DIR_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 200,
} as const;

/** Arranca un servidor HTTP ajeno a ui-preflight y espera a que responda. */
async function startIntruder(port: number): Promise<ChildProcess> {
  const intruder = spawn(
    process.execPath,
    [
      "-e",
      `require("node:http").createServer((req,res)=>{res.writeHead(200);res.end("ok");}).listen(${port});`,
    ],
    { stdio: "ignore" },
  );
  const deadline = Date.now() + 5000;
  while (!(await respondsAt(`http://localhost:${port}`))) {
    if (Date.now() > deadline) {
      throw new Error("el servidor intruso no llegó a responder");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return intruder;
}

/** Un PID que existió y ya terminó, para simular un PID_FILE de una sesión anterior que no cerró bien. */
async function aDeadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((resolve) => child.on("exit", resolve));
  return child.pid!;
}

async function setupWorkDir(): Promise<string> {
  const workDir = await mkdtemp(
    path.join(tmpdir(), "seadragons-ui-preflight-"),
  );
  await mkdir(path.join(workDir, "scripts"), { recursive: true });
  await copyFile(
    UI_PREFLIGHT_SCRIPT,
    path.join(workDir, "scripts/ui-preflight.sh"),
  );
  await writeFile(path.join(workDir, "dummy-server.js"), DUMMY_SERVER_SCRIPT);
  await writeFile(
    path.join(workDir, "detached-dev-server.sh"),
    DETACHED_WRAPPER_SCRIPT,
  );
  await chmod(path.join(workDir, "detached-dev-server.sh"), 0o755);
  await writeFile(path.join(workDir, "never-starts.sh"), NEVER_STARTS_SCRIPT);
  await chmod(path.join(workDir, "never-starts.sh"), 0o755);
  return workDir;
}

function baseEnv(
  workDir: string,
  port: number,
  extra: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    APP_URL: `http://localhost:${port}`,
    FABRICA_SERVER_TIMEOUT: "8",
    ...extra,
    DEV_SERVER_CMD:
      extra.DEV_SERVER_CMD ??
      `bash ${toBashPath(workDir)}/detached-dev-server.sh ${port}`,
  };
}

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

describe("ui-preflight.sh", () => {
  let workDir = "";
  let cleanupEnv: NodeJS.ProcessEnv = process.env;
  let intruder: ChildProcess | undefined;

  afterEach(async () => {
    if (workDir) {
      // El servidor real puede seguir vivo si un test falla a mitad de camino;
      // 'down' lo mata por puerto, no por el PID que quedó registrado.
      await runPreflight(["down"], workDir, cleanupEnv).catch(() => undefined);
      await rm(workDir, REMOVE_TEMP_DIR_OPTIONS);
      workDir = "";
    }
    if (intruder) {
      intruder.kill();
      intruder = undefined;
    }
  });

  it(
    "arranca aunque el proceso lanzador termine antes de que el servidor real escuche",
    async () => {
      workDir = await setupWorkDir();
      const port = 39181;
      const env = baseEnv(workDir, port, { START_DELAY_MS: "2000" });
      cleanupEnv = env;
      const { code, stdout, stderr } = await runPreflight(["up"], workDir, env);

      expect(stderr).not.toMatch(/did not answer/);
      expect(code).toBe(0);
      expect(stdout.trim()).toBe(`http://localhost:${port}`);
      expect(await respondsAt(`http://localhost:${port}`)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "check reconoce como propio un servidor cuyo proceso lanzador ya murió",
    async () => {
      workDir = await setupWorkDir();
      const port = 39182;
      const env = baseEnv(workDir, port, { START_DELAY_MS: "500" });
      cleanupEnv = env;

      const up = await runPreflight(["up"], workDir, env);
      expect(up.code).toBe(0);

      const check = await runPreflight(["check"], workDir, env);
      expect(check.code).toBe(0);
      expect(check.stderr).toMatch(/served by this factory/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "dos arranques seguidos con servidores distintos terminan ambos con éxito",
    async () => {
      workDir = await setupWorkDir();
      const port = 39183;
      const env = baseEnv(workDir, port, { START_DELAY_MS: "500" });
      cleanupEnv = env;

      const firstUp = await runPreflight(["up"], workDir, env);
      expect(firstUp.code).toBe(0);
      expect(await respondsAt(`http://localhost:${port}`)).toBe(true);

      const firstDown = await runPreflight(["down"], workDir, env);
      expect(firstDown.code).toBe(0);
      expect(await respondsAt(`http://localhost:${port}`)).toBe(false);

      const secondUp = await runPreflight(["up"], workDir, env);
      expect(secondUp.stderr).not.toMatch(/did not answer/);
      expect(secondUp.code).toBe(0);
      expect(await respondsAt(`http://localhost:${port}`)).toBe(true);

      const secondDown = await runPreflight(["down"], workDir, env);
      expect(secondDown.code).toBe(0);
      expect(await respondsAt(`http://localhost:${port}`)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "sigue abortando por timeout cuando el servidor de verdad nunca escucha",
    async () => {
      workDir = await setupWorkDir();
      const port = 39184;
      const env = baseEnv(workDir, port, {
        FABRICA_SERVER_TIMEOUT: "2",
        DEV_SERVER_CMD: `bash ${toBashPath(workDir)}/never-starts.sh`,
      });
      cleanupEnv = env;

      const { code, stderr } = await runPreflight(["up"], workDir, env);

      expect(code).not.toBe(0);
      expect(stderr).toMatch(/did not answer/);
      expect(await respondsAt(`http://localhost:${port}`)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "sigue abortando cuando el proceso muere sin haber levantado nada",
    async () => {
      workDir = await setupWorkDir();
      const port = 39185;
      const dieImmediately = path.join(workDir, "dies-immediately.sh");
      await writeFile(dieImmediately, "#!/usr/bin/env bash\nexit 1\n");
      await chmod(dieImmediately, 0o755);
      const env = baseEnv(workDir, port, {
        FABRICA_SERVER_TIMEOUT: "3",
        DEV_SERVER_CMD: `bash ${toBashPath(dieImmediately)}`,
      });
      cleanupEnv = env;

      const { code, stderr } = await runPreflight(["up"], workDir, env);

      expect(code).not.toBe(0);
      expect(stderr).toMatch(/did not answer/);
      expect(await respondsAt(`http://localhost:${port}`)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "se sigue negando a arrancar sobre un servidor que esta fábrica no inició",
    async () => {
      workDir = await setupWorkDir();
      const port = 39186;
      intruder = await startIntruder(port);

      const env = baseEnv(workDir, port, {});
      cleanupEnv = env;
      const { code, stderr } = await runPreflight(["up"], workDir, env);

      expect(code).not.toBe(0);
      expect(stderr).toMatch(/did not start it/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "se sigue negando cuando un PID_FILE de una sesión anterior sin cerrar coincide con un servidor ajeno más nuevo",
    async () => {
      workDir = await setupWorkDir();
      const port = 39187;
      // Simula una sesión previa que llamó a 'up' y nunca llegó a 'down'
      // (por ejemplo, el worker se quedó sin turnos a mitad de camino): el
      // PID_FILE sobrevive apuntando a un proceso que ya no existe.
      await mkdir(path.join(workDir, ".factory"), { recursive: true });
      await writeFile(
        path.join(workDir, ".factory/ui-server.pid"),
        String(await aDeadPid()),
      );
      // Después, sin relación alguna, otro servidor (no nuestro) toma ese
      // mismo puerto.
      intruder = await startIntruder(port);

      const env = baseEnv(workDir, port, {});
      cleanupEnv = env;
      const { code, stderr } = await runPreflight(["check"], workDir, env);

      expect(code).not.toBe(0);
      expect(stderr).toMatch(/did not start it/);
      expect(stderr).not.toMatch(/served by this factory/);
    },
    TEST_TIMEOUT_MS,
  );
});
