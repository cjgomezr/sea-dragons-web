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

// Puertos reales, no simulados: dos corridas de este archivo en paralelo (una
// sesión de agente y su propio subagente de revisión, por ejemplo) chocarían
// si todas usaran el mismo rango fijo. Un offset aleatorio por proceso reduce
// esa colisión sin necesitar coordinación entre corridas.
const PORT_BASE = 40000 + Math.floor(Math.random() * 10_000);
let nextPortOffset = 0;
function nextPort(): number {
  nextPortOffset += 1;
  return PORT_BASE + nextPortOffset;
}

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
 * Como DETACHED_WRAPPER_SCRIPT, pero además deja escrito en "real-pid" el
 * PID del hijo real, para que un netstat/lsof de mentira pueda reportarlo
 * una vez que decida "encontrarlo".
 *
 * En Windows netstat reporta el PID nativo, no el numerado por Git Bash, así
 * que "real-pid" debe guardar ESE (la misma traducción que ui-preflight.sh
 * hace en winpid_of), o record_real_owner nunca encuentra con qué mapearlo
 * de vuelta y descarta el resultado como si no hubiera encontrado nada. En
 * Linux (sin `ps -W`) no hay dos espacios de PID que traducir, así que cae
 * de vuelta al PID normal, que es justo lo que lsof -ti reportaría ahí.
 */
const DETACHED_WRAPPER_WRITES_PID_SCRIPT = `#!/usr/bin/env bash
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
node "$DIR/dummy-server.js" "$1" &
child=$!
winpid=$(ps -W 2>/dev/null | awk -v p="$child" '$1 == p { print $4 }' | head -1)
echo "\${winpid:-$child}" > "$DIR/real-pid"
disown
exit 0
`;

/**
 * Reproduce el curl real de mingw/Git Bash bajo `MSYS_NO_PATHCONV=1`
 * (issue #52): al no traducirse "/dev/null" al dispositivo NUL de Windows,
 * curl no puede escribir ahí el cuerpo de la respuesta y sale con el código
 * 23 "Failure writing output to destination", aunque el servidor haya
 * respondido 200 de verdad. `responds()` no puede depender de que esa
 * traducción ocurra.
 */
const FAKE_CURL_SCRIPT = `#!/usr/bin/env bash
for arg in "$@"; do
  if [ "$arg" = "/dev/null" ]; then
    echo "curl: (23) Failure writing output to destination" >&2
    exit 23
  fi
done
url="\${@: -1}"
node -e '
  const u = new URL(process.argv[1]);
  const req = require("http").get(
    { hostname: u.hostname, port: u.port || 80, path: "/", timeout: 3000 },
    () => process.exit(0)
  );
  req.on("error", () => process.exit(1));
  req.on("timeout", () => process.exit(1));
' "$url"
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

/** Instala el curl de mentira en un directorio propio y lo antepone al PATH del test. */
async function installFakeCurlThatFailsToWriteDevNull(
  workDir: string,
): Promise<string> {
  const binDir = path.join(workDir, "fake-bin");
  await mkdir(binDir, { recursive: true });
  const curlPath = path.join(binDir, "curl");
  await writeFile(curlPath, FAKE_CURL_SCRIPT);
  await chmod(curlPath, 0o755);
  return binDir;
}

// netstat/lsof salen con código distinto de cero cuando no encuentran nada
// (issue #102): reproduce a `port_owner_pid` no encontrando todavía al dueño
// real del puerto justo cuando `responds` ya lo da por arrancado, la misma
// carrera que en CI hacía que `set -euo pipefail` tumbara todo `up` ahí
// mismo, silenciosamente, con el servidor real ya arriba y respondiendo.
const FAKE_NOTHING_FOUND_SCRIPT = `#!/usr/bin/env bash
exit 1
`;

/** Instala un netstat y un lsof de mentira que nunca encuentran nada, y los antepone al PATH del test. */
async function installFakePidLookupToolsThatFindNothing(
  workDir: string,
): Promise<string> {
  const binDir = path.join(workDir, "fake-bin-lookup");
  await mkdir(binDir, { recursive: true });
  for (const name of ["netstat", "lsof"]) {
    const toolPath = path.join(binDir, name);
    await writeFile(toolPath, FAKE_NOTHING_FOUND_SCRIPT);
    await chmod(toolPath, 0o755);
  }
  return binDir;
}

/**
 * netstat/lsof de mentira que fallan sin encontrar nada las primeras
 * `failCount` veces (la demora real que port_owner_pid ahora reintenta) y
 * luego reportan el PID real que dejó escrito DETACHED_WRAPPER_WRITES_PID_SCRIPT.
 *
 * El formato de netstat importa: `port_owner_pid_once` sólo entra a la rama
 * de netstat (la que se ejercita en Windows, donde corre este test) cuando
 * taskkill también existe, y de ahí filtra con `grep -i listening | grep
 * ":$port "`, así que una salida que no imite una línea real de
 * `netstat -ano` se descartaría aunque el PID sea el correcto. lsof en
 * cambio sólo necesita el PID crudo, que es lo que usa la rama que se
 * ejercita en Linux (sin taskkill).
 */
async function installFlakyPidLookupTools(
  workDir: string,
  port: number,
  failCount: number,
): Promise<string> {
  const binDir = path.join(workDir, "fake-bin-flaky");
  await mkdir(binDir, { recursive: true });
  const counterPath = toBashPath(path.join(workDir, "lookup-attempts"));
  const realPidPath = toBashPath(path.join(workDir, "real-pid"));
  const attemptsPrelude = `attempts=0
[ -f "${counterPath}" ] && attempts=$(cat "${counterPath}")
attempts=$((attempts + 1))
echo "$attempts" > "${counterPath}"
if [ "$attempts" -le ${failCount} ] || [ ! -f "${realPidPath}" ]; then
  exit 1
fi`;
  const netstatScript = `#!/usr/bin/env bash
${attemptsPrelude}
pid=$(cat "${realPidPath}")
echo "  TCP    0.0.0.0:${port}         0.0.0.0:0              LISTENING       $pid"
`;
  const lsofScript = `#!/usr/bin/env bash
${attemptsPrelude}
cat "${realPidPath}"
`;
  await writeFile(path.join(binDir, "netstat"), netstatScript);
  await chmod(path.join(binDir, "netstat"), 0o755);
  await writeFile(path.join(binDir, "lsof"), lsofScript);
  await chmod(path.join(binDir, "lsof"), 0o755);
  return binDir;
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
  await writeFile(
    path.join(workDir, "detached-dev-server-writes-pid.sh"),
    DETACHED_WRAPPER_WRITES_PID_SCRIPT,
  );
  await chmod(path.join(workDir, "detached-dev-server-writes-pid.sh"), 0o755);
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
      const port = nextPort();
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
    "responds sigue reconociendo un servidor vivo aunque curl no pueda escribir en -o /dev/null",
    async () => {
      workDir = await setupWorkDir();
      const port = nextPort();
      const fakeBinDir = await installFakeCurlThatFailsToWriteDevNull(workDir);
      const env = baseEnv(workDir, port, { START_DELAY_MS: "500" });
      env.PATH = `${fakeBinDir}${path.delimiter}${env.PATH}`;
      cleanupEnv = env;

      const { code, stderr } = await runPreflight(["up"], workDir, env);

      expect(stderr).not.toMatch(/did not answer/);
      expect(code).toBe(0);
      expect(await respondsAt(`http://localhost:${port}`)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "up sigue arrancando cuando netstat/lsof no encuentran todavía al dueño real del puerto",
    async () => {
      workDir = await setupWorkDir();
      const port = nextPort();
      const fakeBinDir =
        await installFakePidLookupToolsThatFindNothing(workDir);
      // Sin el wrapper que se desliga: $! ya es el proceso real, así que
      // 'down' en el afterEach puede limpiarlo por PID aunque las
      // herramientas de lookup (deliberadamente rotas arriba) no encuentren
      // nada. El wrapper que sí se desliga es harina de otro costal (lo
      // cubren los demás tests de este archivo) y no lo que este prueba.
      const env = baseEnv(workDir, port, {
        DEV_SERVER_CMD: `node ${toBashPath(workDir)}/dummy-server.js ${port}`,
        START_DELAY_MS: "500",
      });
      env.PATH = `${fakeBinDir}${path.delimiter}${env.PATH}`;
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
    "up corrige el PID_FILE con el dueño real aunque netstat/lsof tarden unas vueltas en verlo, y down lo apaga de verdad",
    async () => {
      workDir = await setupWorkDir();
      const port = nextPort();
      // Falla las primeras 3 veces (dentro del presupuesto de 5 reintentos
      // de port_owner_pid) para probar que el propio reintento resuelve la
      // demora, no una segunda llamada externa (down también llama a
      // port_owner_pid como último recurso, lo cual taparía una regresión
      // aquí si se agotara ese presupuesto).
      const fakeBinDir = await installFlakyPidLookupTools(workDir, port, 3);
      const env = baseEnv(workDir, port, {
        DEV_SERVER_CMD: `bash ${toBashPath(workDir)}/detached-dev-server-writes-pid.sh ${port}`,
        START_DELAY_MS: "200",
      });
      env.PATH = `${fakeBinDir}${path.delimiter}${env.PATH}`;
      cleanupEnv = env;

      const up = await runPreflight(["up"], workDir, env);
      expect(up.stderr).not.toMatch(/did not answer/);
      expect(up.code).toBe(0);
      expect(await respondsAt(`http://localhost:${port}`)).toBe(true);

      // El bug real (#102): sin los reintentos, record_real_owner se rinde
      // y deja el PID_FILE apuntando al wrapper ya muerto, así que down()
      // no encuentra a quién matar y el servidor de verdad sigue arriba
      // aunque down() reporte éxito.
      const down = await runPreflight(["down"], workDir, env);
      expect(down.code).toBe(0);
      expect(await respondsAt(`http://localhost:${port}`)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "check reconoce como propio un servidor cuyo proceso lanzador ya murió",
    async () => {
      workDir = await setupWorkDir();
      const port = nextPort();
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
      const port = nextPort();
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
      const port = nextPort();
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
      const port = nextPort();
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
      const port = nextPort();
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
      const port = nextPort();
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
