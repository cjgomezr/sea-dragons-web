import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const UI_PREFLIGHT_SCRIPT = path.join(REPO_ROOT, "scripts/ui-preflight.sh");
const TEST_TIMEOUT_MS = 20_000;

type PreflightCommand = "up" | "down";

interface ScriptTimeouts {
  readonly bootTimeoutS: number;
  readonly stopTimeoutS: number;
}

const SECOND_MS = 1_000;
// Pausas fijas escritas en ui-preflight.sh, fuera de sus dos plazos
// configurables: el `sleep 1` de kill_tree, el que sigue a kill_port_owner, y
// los reintentos de record_real_owner (5 × 0.1 s en port_owner_pid y
// 3 × 0.2 s en pid_for_winpid). En Windows kill_tree sale por taskkill antes
// de su `sleep 1`: ahí esa pausa no ocurre y queda como margen para los dos
// `ps -W` de winpid_of.
const KILL_TREE_PAUSE_MS = 1_000;
const KILL_PORT_OWNER_PAUSE_MS = 1_000;
const RECORD_REAL_OWNER_RETRIES_MS = 5 * 100 + 3 * 200;
// Lo que el script no escribe en ningún sitio: cada sondeo del puerto y cada
// taskkill lanzan un proceso, y con la suite entera lanzando los suyos en
// paralelo eso deja de ser gratis (issue #151).
const PROCESS_SPAWN_ALLOWANCE_MS = 500;
const RESPONDS_AT_TIMEOUT_MS = 1_000;
// Crear el directorio temporal y copiar los fixtures, antes de la secuencia.
const WORK_DIR_SETUP_ALLOWANCE_MS = 5_000;

/**
 * STOP_TIMEOUT tal como lo declara el script. Se lee del texto y no se copia:
 * si alguien lo alarga, el plazo del test crece con él en vez de volverse
 * imposible sin que nadie lo note.
 */
function readStopTimeoutS(script: string): number {
  const match = /^STOP_TIMEOUT=(\d+)$/m.exec(script);
  if (!match) {
    throw new Error(
      "ui-preflight.sh ya no declara STOP_TIMEOUT=<segundos>: el plazo de sus tests no tiene de dónde salir",
    );
  }
  return Number(match[1]);
}

/** Cada vuelta de espera del script: un sondeo del puerto y un `sleep 1`. */
function waitLoopMs(iterations: number): number {
  return iterations * (SECOND_MS + PROCESS_SPAWN_ALLOWANCE_MS);
}

function upWorstCaseMs({ bootTimeoutS }: ScriptTimeouts): number {
  const checkProbeAndLaunch = 2 * PROCESS_SPAWN_ALLOWANCE_MS;
  return (
    checkProbeAndLaunch +
    waitLoopMs(bootTimeoutS) +
    RECORD_REAL_OWNER_RETRIES_MS
  );
}

function downWorstCaseMs({ stopTimeoutS }: ScriptTimeouts): number {
  // taskkill, los dos sondeos que siguen al bucle y kill_port_owner.
  const extraProcesses = 4 * PROCESS_SPAWN_ALLOWANCE_MS;
  return (
    KILL_TREE_PAUSE_MS +
    waitLoopMs(stopTimeoutS) +
    KILL_PORT_OWNER_PAUSE_MS +
    extraProcesses
  );
}

/**
 * El plazo de una secuencia de llamadas al script, cada una seguida de un
 * `respondsAt` que comprueba el puerto. Es una estimación holgada del peor
 * caso, no una cota exacta: no cuenta un sondeo que se quede en "unknown"
 * (hasta 3 s), ni los netstat/grep/awk/ps que lanzan record_real_owner y
 * kill_port_owner, ni los reintentos de port_owner_pid dentro de `down`. Lo
 * compensa con que un `up` que sale bien nunca paga su último `sleep 1`.
 * Agotarlo apunta a una llamada anormalmente lenta, no prueba por sí solo un
 * defecto del script.
 */
function sequenceDeadlineMs(
  commands: readonly PreflightCommand[],
  timeouts: ScriptTimeouts,
): number {
  const worstCaseOf: Record<PreflightCommand, number> = {
    up: upWorstCaseMs(timeouts),
    down: downWorstCaseMs(timeouts),
  };
  return commands.reduce(
    (total, command) => total + worstCaseOf[command] + RESPONDS_AT_TIMEOUT_MS,
    0,
  );
}

interface TimedStep {
  readonly name: string;
  readonly run: () => Promise<void>;
}

interface FinishedStep {
  readonly name: string;
  readonly elapsedMs: number;
}

interface RunningStep {
  readonly index: number;
  readonly name: string;
  readonly startedAt: number;
}

function describeFinishedSteps(finished: readonly FinishedStep[]): string {
  const [first, ...rest] = finished;
  if (!first) {
    return "no había terminado ningún paso antes";
  }
  const durations = [
    `${first.name} tardó ${first.elapsedMs} ms`,
    ...rest.map(({ name, elapsedMs }) => `${name} ${elapsedMs} ms`),
  ];
  if (durations.length === 1) {
    return `antes, ${durations[0]}`;
  }
  return `antes, ${durations.slice(0, -1).join(", ")} y ${durations.at(-1)}`;
}

function describeStalledSequence(options: {
  readonly steps: readonly TimedStep[];
  readonly deadlineMs: number;
  readonly running: RunningStep;
  readonly finished: readonly FinishedStep[];
}): string {
  const { steps, deadlineMs, running, finished } = options;
  const sequenceName = steps.map((step) => step.name).join(", ");
  const runningFor = Date.now() - running.startedAt;
  return `la secuencia ${sequenceName} no terminó en ${deadlineMs} ms: seguía en el paso ${running.index + 1} (${running.name}) tras ${runningFor} ms; ${describeFinishedSteps(finished)}`;
}

interface SequenceProgress {
  readonly finished: FinishedStep[];
  running: RunningStep;
  isDeadlineReached: boolean;
}

/**
 * Corre los pasos uno tras otro, anotando en `progress` cuál corre y cuánto
 * tardaron los ya terminados. Deja de empezar pasos en cuanto vence el plazo.
 */
async function runStepsInOrder(
  steps: readonly TimedStep[],
  progress: SequenceProgress,
): Promise<void> {
  for (const [index, step] of steps.entries()) {
    if (progress.isDeadlineReached) {
      return;
    }
    const startedAt = Date.now();
    progress.running = { index, name: step.name, startedAt };
    await step.run();
    progress.finished.push({
      name: step.name,
      elapsedMs: Date.now() - startedAt,
    });
  }
}

/**
 * Corre los pasos en orden y, si no terminan en `deadlineMs`, falla diciendo
 * en cuál se quedó y cuánto tardaron los anteriores. Un timeout de Vitest a
 * secas no dice nada de eso, y tampoco trae el stderr del script (issue #151).
 */
async function runTimedSequence(
  steps: readonly TimedStep[],
  deadlineMs: number,
): Promise<void> {
  const progress: SequenceProgress = {
    finished: [],
    running: { index: 0, name: "", startedAt: Date.now() },
    isDeadlineReached: false,
  };
  const sequence = runStepsInOrder(steps, progress);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      progress.isDeadlineReached = true;
      const { running, finished } = progress;
      reject(
        new Error(
          describeStalledSequence({ steps, deadlineMs, running, finished }),
        ),
      );
    }, deadlineMs);
  });
  // Si gana el plazo, el paso en vuelo no se puede cancelar (ya no empieza
  // ninguno más) y puede fallar más tarde. Ese error ya no tiene a quién
  // llegar: el del plazo es el que se reporta, y sin este manejador Vitest lo
  // contaría como un rechazo sin atender de otro test.
  sequence.catch(() => undefined);
  try {
    await Promise.race([sequence, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

const TEST_BOOT_TIMEOUT_S = 8;
const TWO_BOOTS_COMMANDS = ["up", "down", "up", "down"] as const;
const TWO_BOOTS_DEADLINE_MS = sequenceDeadlineMs(TWO_BOOTS_COMMANDS, {
  bootTimeoutS: TEST_BOOT_TIMEOUT_S,
  stopTimeoutS: readStopTimeoutS(readFileSync(UI_PREFLIGHT_SCRIPT, "utf8")),
});

// Puertos reales, no simulados: dos corridas de este archivo en paralelo (una
// sesión de agente y su propio subagente de revisión, por ejemplo) chocarían
// si todas usaran el mismo rango fijo. Un offset aleatorio por proceso reduce
// esa colisión sin necesitar coordinación entre corridas.
//
// Por debajo de 32768 a propósito: ahí empieza el rango de puertos efímeros
// de Linux (32768-60999 por defecto), del que el sistema reparte el extremo
// local de cada conexión saliente. Un puerto de ese rango se lo puede quedar
// un cliente cualquiera de esta misma suite en el instante justo, y entonces
// el dev server no logra bindear, nadie responde y `up` agota su plazo. No
// falla siempre, que es lo peor que puede hacer un test.
const PORT_BASE = 20_000 + Math.floor(Math.random() * 10_000);
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
    await fetch(url, { signal: AbortSignal.timeout(RESPONDS_AT_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

const PORT_ACCEPT_TIMEOUT_MS = 5_000;
const PORT_PROBE_INTERVAL_MS = 50;
// Holgado para un handshake contra localhost, corto frente al plazo total:
// un runner cargado puede tardar más de lo obvio, y quedarse corto aquí sólo
// gasta un intento del bucle.
const PORT_CONNECT_TIMEOUT_MS = 500;

// Un sondeo fallido guarda por qué falló: "la conexión fue rechazada cien
// veces" (el auxiliar nunca arrancó) y "el handshake se agotó" (algo raro en
// la red del runner) piden investigaciones distintas, y en CI el mensaje del
// test es todo lo que queda.
type PortProbe =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: string };

/**
 * El texto de un fallo de conexión, ya venga suelto o agrupado. Node conecta a
 * "localhost" probando IPv6 e IPv4 a la vez, y cuando fallan las dos emite un
 * AggregateError cuyo `message` está vacío: el motivo vive en `errors`.
 */
function describeConnectError(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    // `errors` viene tipado como any[] en las libs de TS: se estrecha antes
    // de recorrerlo, o el any se cuela en el resto de la función.
    const causes: unknown[] = error.errors;
    return causes.map(describeConnectError).join("; ");
  }
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

/**
 * Abre y cierra una conexión TCP. Es la única señal que da un puerto mudo:
 * acepta, pero no contesta nada, así que un fetch no distingue "no hay nadie"
 * de "hay alguien callado".
 */
function probePort(port: number): Promise<PortProbe> {
  return new Promise((resolve) => {
    const socket = connect({ host: "localhost", port });
    const settle = (probe: PortProbe): void => {
      socket.destroy();
      resolve(probe);
    };
    socket.setTimeout(PORT_CONNECT_TIMEOUT_MS);
    socket.on("connect", () => settle({ accepted: true }));
    socket.on("timeout", () =>
      settle({
        accepted: false,
        reason: `el handshake no terminó en ${PORT_CONNECT_TIMEOUT_MS} ms`,
      }),
    );
    socket.on("error", (error) =>
      settle({ accepted: false, reason: describeConnectError(error) }),
    );
  });
}

/**
 * Espera a que alguien escuche en el puerto, o falla diciendo cuánto esperó y
 * por qué no llegó a conectar.
 */
async function waitUntilPortAccepts(
  port: number,
  timeoutMs: number = PORT_ACCEPT_TIMEOUT_MS,
): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    const probe = await probePort(port);
    if (probe.accepted) {
      return;
    }
    // El transcurrido de verdad, no el plazo pedido: el último sondeo puede
    // haberse comido hasta PORT_CONNECT_TIMEOUT_MS de más.
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > timeoutMs) {
      throw new Error(
        `el puerto ${port} no llegó a aceptar conexiones en ${elapsedMs} ms (último intento: ${probe.reason})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, PORT_PROBE_INTERVAL_MS));
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
 *
 * El `| head -1` de aquí abajo es la forma que el script de producción ya no
 * usa y que un test de este archivo prohíbe. Aquí es inofensiva: no hay
 * pipefail en este fixture y sólo puede casar una línea, la del hijo que
 * acaba de lanzar.
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

/**
 * netstat y lsof de mentira que listan MILES de dueños para el puerto, muy
 * por encima de lo que cabe en el buffer de una tubería. Es lo que ocurre de
 * verdad en cuanto el dev server tiene mas de un proceso pegado al socket, y
 * lo que hacía caer a `up` en silencio: quien escribe en la tubería se queda
 * a medias cuando el lector cierra, y bajo `set -o pipefail` ese SIGPIPE se
 * propaga hasta tumbar el script entero (issue #102).
 */
const NOISY_OWNER_COUNT = 20_000;

async function installNoisyPidLookupTools(
  workDir: string,
  port: number,
): Promise<string> {
  const binDir = path.join(workDir, "fake-bin-noisy");
  await mkdir(binDir, { recursive: true });
  const netstatScript = `#!/usr/bin/env bash
seq 1 ${NOISY_OWNER_COUNT} | awk '{ printf "  TCP    0.0.0.0:${port}         0.0.0.0:0              LISTENING       %d\\n", 99000000 + $1 }'
`;
  const lsofScript = `#!/usr/bin/env bash
seq 99000001 ${99000000 + NOISY_OWNER_COUNT}
`;
  await writeFile(path.join(binDir, "netstat"), netstatScript);
  await chmod(path.join(binDir, "netstat"), 0o755);
  await writeFile(path.join(binDir, "lsof"), lsofScript);
  await chmod(path.join(binDir, "lsof"), 0o755);
  return binDir;
}

/**
 * netstat y lsof de mentira que ven DOS procesos en el puerto: el que
 * escucha y un cliente conectado a él. El lsof de verdad hace justo eso,
 * porque "-i tcp:PUERTO" casa cualquier socket con ese puerto en el extremo
 * local O en el remoto, y sólo filtra por estado si se lo piden. netstat en
 * cambio siempre etiqueta cada línea con su estado.
 */
async function installPidLookupToolsThatAlsoSeeTheClient(
  workDir: string,
  port: number,
  listenerPid: number,
  clientPid: number,
): Promise<string> {
  const binDir = path.join(workDir, "fake-bin-with-client");
  await mkdir(binDir, { recursive: true });
  const netstatScript = `#!/usr/bin/env bash
echo "  TCP    0.0.0.0:${port}         0.0.0.0:0              LISTENING       ${listenerPid}"
echo "  TCP    127.0.0.1:${port}       127.0.0.1:54321        ESTABLISHED     ${clientPid}"
`;
  const lsofScript = `#!/usr/bin/env bash
echo "${listenerPid}"
for arg in "$@"; do
  if [ "$arg" = "-sTCP:LISTEN" ]; then
    exit 0
  fi
done
echo "${clientPid}"
`;
  await writeFile(path.join(binDir, "netstat"), netstatScript);
  await chmod(path.join(binDir, "netstat"), 0o755);
  await writeFile(path.join(binDir, "lsof"), lsofScript);
  await chmod(path.join(binDir, "lsof"), 0o755);
  return binDir;
}

// Un intervalo que no llega a dispararse nunca: no mide nada, sólo le da al
// proceso un handle abierto para que el event loop no lo deje morir solo.
const KEEPS_PROCESS_ALIVE_MS = 1 << 30;

/**
 * Un proceso que no hace nada y se deja matar, para comprobar que nadie lo mata.
 *
 * No espera a nada, y no le hace falta: lo único que se afirma de él es que su
 * PID siga vivo, y ese PID existe desde que `spawn` vuelve. No abre puertos ni
 * responde nada, así que no hay precondición que sondear (issue #125).
 */
function startSacrificialProcess(): ChildProcess {
  return spawn(
    process.execPath,
    ["-e", `setInterval(() => {}, ${KEEPS_PROCESS_ALIVE_MS});`],
    { stdio: "ignore" },
  );
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * `ps` de mentira, en cuatro sabores, para las rutas que traducen PIDs entre
 * la numeración de Git Bash y la nativa de Windows.
 *
 * Imita el formato de `ps -W`: el PID de Git Bash en la columna 1 y el
 * nativo en la 4. Aquí los dos valen lo mismo, el que `up` dejó escrito en
 * el PID_FILE, porque lo que se prueba es que el script no se muera
 * traduciendo, no la traducción en sí.
 *
 * - `normal`: una línea, el caso corriente.
 * - `inundacion`: MILES de líneas coincidentes. `awk` las escribe todas, así
 *   que un `head` al otro lado cierra la tubería a media escritura, y el
 *   SIGPIPE resultante tumba el script bajo `set -o pipefail`. Es el mismo
 *   defecto que el #102 arregló en `record_real_owner`.
 * - `sin-soporte-de-W`: `ps -W` sale distinto de cero, como en cualquier
 *   Linux. Bajo `pipefail` eso solo basta para tumbar la línea que lo
 *   invoca, que es justo la que tiene una alternativa esperando debajo.
 * - `no-encuentra-nada`: sale bien y no imprime a nadie. No encontrar no es
 *   un fallo.
 */
type FakePsFlavour =
  "normal" | "inundacion" | "sin-soporte-de-W" | "no-encuentra-nada";

const PS_FLOOD_LINES = 20_000;

/**
 * Instala los cuatro dobles que hacen falta para ejercitar la rama de
 * Windows: `ps`, `netstat`, `lsof` y `taskkill`.
 *
 * El `taskkill` es la pieza que abre esa rama en Linux, porque el script
 * entra en ella con un simple `command -v taskkill`. Sin él, estos tests no
 * correrían en el CI y nadie los vería fallar nunca, que es exactamente lo
 * que le pasó al caso del SIGINT de tree-guard (issue #102). Y mata de
 * verdad: si sólo fingiera, el servidor seguiría en pie y el test no
 * distinguiría un `down` que funciona de uno que no.
 *
 * Los cuatro leen el mismo PID, así que todos hablan de un único proceso en
 * una única numeración, y `kill` puede con él en las dos plataformas.
 */
async function installWindowsPidTranslationFakes(
  workDir: string,
  port: number,
  psFlavour: FakePsFlavour,
): Promise<string> {
  const binDir = path.join(workDir, `fake-bin-win-${psFlavour}`);
  await mkdir(binDir, { recursive: true });
  const pidFile = toBashPath(path.join(workDir, ".factory/ui-server.pid"));
  // `down` borra el PID_FILE nada más leerlo, antes de ponerse a traducir
  // PIDs, así que un doble que sólo mirara ahí se quedaría mudo justo en la
  // ruta que hay que ejercitar. La caché guarda el último PID visto.
  const pidCache = toBashPath(path.join(workDir, "fake-pid-cache"));
  const killLog = toBashPath(path.join(workDir, "taskkill-calls"));
  const readsPid = `[ -f "${pidFile}" ] && cp "${pidFile}" "${pidCache}"
[ -f "${pidCache}" ] || exit 0
pid=$(cat "${pidCache}")`;
  const psBodies: Record<FakePsFlavour, string> = {
    normal: `${readsPid}
echo "$pid 1 1 $pid"`,
    inundacion: `${readsPid}
seq 1 ${PS_FLOOD_LINES} | awk -v p="$pid" '{ print p, 1, 1, p }'`,
    "sin-soporte-de-W": `for arg in "$@"; do
  [ "$arg" = "-W" ] && exit 1
done
${readsPid}
echo "$pid 1 1 $pid"`,
    "no-encuentra-nada": "exit 0",
  };
  const tools: Record<string, string> = {
    ps: psBodies[psFlavour],
    netstat: `${readsPid}
echo "  TCP    0.0.0.0:${port}         0.0.0.0:0              LISTENING       $pid"`,
    lsof: `${readsPid}
echo "$pid"`,
    // Un `kill` a secas basta: las columnas 1 y 4 del ps de mentira valen lo
    // mismo, el PID que `up` escribió con `echo $!`, o sea la numeración de
    // Git Bash, que es la única que este `kill` necesita entender.
    //
    // Deja escrito a quién le pidieron matar: es la única forma de ver desde
    // fuera qué PID devolvió la traducción, en vez de deducirlo de que el
    // puerto acabara libre.
    taskkill: `pid="\${@: -1}"
echo "$pid" >> "${killLog}"
kill -9 "$pid" 2>/dev/null || true`,
  };
  for (const [name, body] of Object.entries(tools)) {
    const toolPath = path.join(binDir, name);
    await writeFile(
      toolPath,
      `#!/usr/bin/env bash
${body}
`,
    );
    await chmod(toolPath, 0o755);
  }
  return binDir;
}

/**
 * Un servidor que acepta la conexión y no contesta nunca. Es el puerto
 * "ocupado pero lento" de verdad: no rechaza, así que no hay forma de saber
 * si hay alguien salvo esperando, y esperar es lo que se agota bajo carga.
 *
 * Vuelve sólo cuando el puerto ya acepta conexiones: quien lo llama afirma
 * justo después que ese puerto tiene dueño, y afirmarlo antes de que node
 * llegue a escuchar es la carrera del issue #125.
 */
async function startMuteServer(port: number): Promise<ChildProcess> {
  const muteServer = spawn(
    process.execPath,
    ["-e", `require("node:net").createServer(() => {}).listen(${port});`],
    { stdio: "ignore" },
  );
  try {
    await waitUntilPortAccepts(port);
  } catch (error) {
    muteServer.kill();
    throw error;
  }
  return muteServer;
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
    FABRICA_SERVER_TIMEOUT: String(TEST_BOOT_TIMEOUT_S),
    ...extra,
    DEV_SERVER_CMD:
      extra.DEV_SERVER_CMD ??
      `bash ${toBashPath(workDir)}/detached-dev-server.sh ${port}`,
  };
}

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

/** El PATH del test con un directorio de dobles por delante del real. */
function withFakeBin(
  env: NodeJS.ProcessEnv,
  binDir: string,
): NodeJS.ProcessEnv {
  return { ...env, PATH: `${binDir}${path.delimiter}${env.PATH}` };
}

describe("ui-preflight.sh", () => {
  let workDir = "";
  let cleanupEnv: NodeJS.ProcessEnv = process.env;
  let intruder: ChildProcess | undefined;
  let client: ChildProcess | undefined;

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
    if (client) {
      client.kill();
      client = undefined;
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
      expect(code, stderr).toBe(0);
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
      expect(code, stderr).toBe(0);
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
      expect(code, stderr).toBe(0);
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
      expect(up.code, up.stderr).toBe(0);
      expect(await respondsAt(`http://localhost:${port}`)).toBe(true);

      // El bug real (#102): sin los reintentos, record_real_owner se rinde
      // y deja el PID_FILE apuntando al wrapper ya muerto, así que down()
      // no encuentra a quién matar y el servidor de verdad sigue arriba
      // aunque down() reporte éxito.
      const down = await runPreflight(["down"], workDir, env);
      expect(down.code, down.stderr).toBe(0);
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
      expect(up.code, up.stderr).toBe(0);

      const check = await runPreflight(["check"], workDir, env);
      expect(check.code, check.stderr).toBe(0);
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
      const url = `http://localhost:${port}`;

      await runTimedSequence(
        [
          {
            name: "up",
            run: async () => {
              const firstUp = await runPreflight(["up"], workDir, env);
              expect(firstUp.code, firstUp.stderr).toBe(0);
              expect(await respondsAt(url)).toBe(true);
            },
          },
          {
            name: "down",
            run: async () => {
              const firstDown = await runPreflight(["down"], workDir, env);
              expect(firstDown.code, firstDown.stderr).toBe(0);
              expect(await respondsAt(url)).toBe(false);
            },
          },
          {
            name: "up",
            run: async () => {
              const secondUp = await runPreflight(["up"], workDir, env);
              expect(secondUp.stderr).not.toMatch(/did not answer/);
              expect(secondUp.code, secondUp.stderr).toBe(0);
              expect(await respondsAt(url)).toBe(true);
            },
          },
          {
            name: "down",
            run: async () => {
              const secondDown = await runPreflight(["down"], workDir, env);
              expect(secondDown.code, secondDown.stderr).toBe(0);
              expect(await respondsAt(url)).toBe(false);
            },
          },
        ],
        TWO_BOOTS_DEADLINE_MS,
      );
    },
    // El plazo propio de la secuencia salta antes que el de Vitest, que es el
    // que no dice nada útil.
    TWO_BOOTS_DEADLINE_MS + WORK_DIR_SETUP_ALLOWANCE_MS,
  );

  it(
    "up no se muere en silencio cuando el puerto tiene muchísimos dueños listados",
    async () => {
      workDir = await setupWorkDir();
      const port = nextPort();
      const fakeBinDir = await installNoisyPidLookupTools(workDir, port);
      const env = baseEnv(workDir, port, {
        DEV_SERVER_CMD: `node ${toBashPath(workDir)}/dummy-server.js ${port}`,
        START_DELAY_MS: "200",
      });
      // La limpieza va con el netstat de verdad: lo que se prueba aquí es
      // 'up', y las herramientas de mentira no sabrían matar a nadie.
      cleanupEnv = env;
      const envWithFakeTools = { ...env };
      envWithFakeTools.PATH = `${fakeBinDir}${path.delimiter}${env.PATH}`;

      const up = await runPreflight(["up"], workDir, envWithFakeTools);

      // El fallo real: `up` salía distinto de cero SIN escribir una sola
      // línea que lo explicara, con el servidor ya arriba y el puerto
      // ocupado para quien viniera detras.
      expect(up.stderr).not.toMatch(/did not answer/);
      expect(up.code, up.stderr).toBe(0);
      expect(up.stdout.trim()).toBe(`http://localhost:${port}`);
      expect(await respondsAt(`http://localhost:${port}`)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "up no se muere cuando ps lista miles de líneas para el mismo proceso",
    async () => {
      workDir = await setupWorkDir();
      const port = nextPort();
      const fakeBinDir = await installWindowsPidTranslationFakes(
        workDir,
        port,
        "inundacion",
      );
      const env = baseEnv(workDir, port, {
        DEV_SERVER_CMD: `node ${toBashPath(workDir)}/dummy-server.js ${port}`,
        START_DELAY_MS: "200",
      });
      cleanupEnv = env;

      const up = await runPreflight(
        ["up"],
        workDir,
        withFakeBin(env, fakeBinDir),
      );

      // Traducir el PID nativo al de Git Bash es lo último que hace `up`
      // cuando el puerto ya responde. Morirse ahí deja el servidor arriba y
      // el puerto ocupado, sin escribir una línea que lo explique.
      expect(up.stderr).not.toMatch(/did not answer/);
      expect(up.code, up.stderr).toBe(0);
      expect(up.stdout.trim()).toBe(`http://localhost:${port}`);
      expect(await respondsAt(`http://localhost:${port}`)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "down no se muere cuando ps lista miles de líneas, y deja el puerto libre",
    async () => {
      workDir = await setupWorkDir();
      const port = nextPort();
      const env = baseEnv(workDir, port, {
        DEV_SERVER_CMD: `node ${toBashPath(workDir)}/dummy-server.js ${port}`,
        START_DELAY_MS: "200",
      });
      cleanupEnv = env;
      // El arranque con un ps corriente: lo que se prueba aquí es el apagado.
      const calmBinDir = await installWindowsPidTranslationFakes(
        workDir,
        port,
        "normal",
      );
      const up = await runPreflight(
        ["up"],
        workDir,
        withFakeBin(env, calmBinDir),
      );
      expect(up.code, up.stderr).toBe(0);
      const floodedBinDir = await installWindowsPidTranslationFakes(
        workDir,
        port,
        "inundacion",
      );

      const down = await runPreflight(
        ["down"],
        workDir,
        withFakeBin(env, floodedBinDir),
      );

      expect(down.code, down.stderr).toBe(0);
      expect(await respondsAt(`http://localhost:${port}`)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "down sigue apagando cuando ps no admite la opción -W",
    async () => {
      workDir = await setupWorkDir();
      const port = nextPort();
      const env = baseEnv(workDir, port, {
        DEV_SERVER_CMD: `node ${toBashPath(workDir)}/dummy-server.js ${port}`,
        START_DELAY_MS: "200",
      });
      cleanupEnv = env;
      const calmBinDir = await installWindowsPidTranslationFakes(
        workDir,
        port,
        "normal",
      );
      const up = await runPreflight(
        ["up"],
        workDir,
        withFakeBin(env, calmBinDir),
      );
      expect(up.code, up.stderr).toBe(0);
      const serverPid = (
        await readFile(path.join(workDir, ".factory/ui-server.pid"), "utf8")
      ).trim();
      const withoutWBinDir = await installWindowsPidTranslationFakes(
        workDir,
        port,
        "sin-soporte-de-W",
      );

      const down = await runPreflight(
        ["down"],
        workDir,
        withFakeBin(env, withoutWBinDir),
      );

      // El apagado es la única ruta que llega a winpid_of, y su alternativa
      // sin -W es la línea a la que un `ps -W` fallido nunca dejaba llegar.
      expect(down.code, down.stderr).toBe(0);
      expect(await respondsAt(`http://localhost:${port}`)).toBe(false);
      // Y llegó con el PID bueno, no vacío: la traducción salió del `ps` sin
      // -W, que es el respaldo que se quería ejercitar.
      const killed = (
        await readFile(path.join(workDir, "taskkill-calls"), "utf8")
      )
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      expect(killed).toContain(serverPid);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "up sigue arrancando cuando ps no admite la opción -W",
    async () => {
      workDir = await setupWorkDir();
      const port = nextPort();
      const fakeBinDir = await installWindowsPidTranslationFakes(
        workDir,
        port,
        "sin-soporte-de-W",
      );
      const env = baseEnv(workDir, port, {
        DEV_SERVER_CMD: `node ${toBashPath(workDir)}/dummy-server.js ${port}`,
        START_DELAY_MS: "200",
      });
      cleanupEnv = env;

      const up = await runPreflight(
        ["up"],
        workDir,
        withFakeBin(env, fakeBinDir),
      );

      // Bajo pipefail, un `ps -W` que sale distinto de cero basta para
      // tumbar la tubería entera. La alternativa sin -W existe justo para
      // este caso, pero no se llegaba nunca a ella.
      expect(up.code, up.stderr).toBe(0);
      expect(await respondsAt(`http://localhost:${port}`)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "up sigue arrancando cuando ps no encuentra a nadie",
    async () => {
      workDir = await setupWorkDir();
      const port = nextPort();
      const fakeBinDir = await installWindowsPidTranslationFakes(
        workDir,
        port,
        "no-encuentra-nada",
      );
      const env = baseEnv(workDir, port, {
        DEV_SERVER_CMD: `node ${toBashPath(workDir)}/dummy-server.js ${port}`,
        START_DELAY_MS: "200",
      });
      cleanupEnv = env;

      const up = await runPreflight(
        ["up"],
        workDir,
        withFakeBin(env, fakeBinDir),
      );

      // "No lo encontré" es una respuesta, no un fallo: la misma decisión
      // que ya se tomó en port_owner_pid en el #102.
      expect(up.code, up.stderr).toBe(0);
      expect(await respondsAt(`http://localhost:${port}`)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it("ui-preflight.sh no toma ninguna primera línea con head", async () => {
    const script = await readFile(UI_PREFLIGHT_SCRIPT, "utf8");

    // Un cable trampa, no una descripción de comportamiento. Se gana el sitio
    // porque este defecto ya reincidió (#102 y luego #104), no lo ve el lint
    // y su fallo es invisible: mata el script sin dejar mensaje. `head` es la
    // forma conocida, no el peligro entero: cualquier lector que cierre antes
    // de tiempo (`sed 1q`, `grep -q`) hace lo mismo.
    const offenders = script
      .split("\n")
      .filter((line) => line.includes("| head"));

    expect(offenders).toEqual([]);
  });

  it(
    "un puerto que acepta y no contesta no se lee como libre",
    async () => {
      workDir = await setupWorkDir();
      const port = nextPort();
      client = await startMuteServer(port);
      const env = baseEnv(workDir, port, {});
      cleanupEnv = env;

      const { code, stderr } = await runPreflight(["check"], workDir, env);

      // "No me dio tiempo a averiguarlo" no es "no hay nadie". Darlo por
      // libre es lo que dejaba arrancar el dev server encima de un puerto
      // ajeno, y entonces las capturas son de otra app (issue #117).
      expect(stderr).not.toMatch(/is free/);
      expect(code).not.toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "un puerto donde de verdad no hay nadie sigue leyéndose como libre",
    async () => {
      workDir = await setupWorkDir();
      const port = nextPort();
      const env = baseEnv(workDir, port, {});
      cleanupEnv = env;

      const { code, stderr } = await runPreflight(["check"], workDir, env);

      // El arreglo no puede volver paranoico al script: donde nadie escucha,
      // la conexión se rechaza y eso sí es una respuesta.
      expect(stderr, stderr).toMatch(/is free/);
      expect(code, stderr).toBe(0);
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
    "down mata al servidor que escucha, no al cliente conectado a ese puerto",
    async () => {
      workDir = await setupWorkDir();
      const port = nextPort();
      intruder = await startIntruder(port);
      client = startSacrificialProcess();
      const fakeBinDir = await installPidLookupToolsThatAlsoSeeTheClient(
        workDir,
        port,
        intruder.pid!,
        client.pid!,
      );
      // Un PID_FILE que ya no apunta a nadie: es lo que empuja a down() a su
      // último recurso: preguntar quién ocupa el puerto y matarlo.
      await mkdir(path.join(workDir, ".factory"), { recursive: true });
      await writeFile(
        path.join(workDir, ".factory/ui-server.pid"),
        String(await aDeadPid()),
      );
      const env = baseEnv(workDir, port, {});
      cleanupEnv = env;
      const envWithFakeTools = { ...env };
      envWithFakeTools.PATH = `${fakeBinDir}${path.delimiter}${env.PATH}`;

      const down = await runPreflight(["down"], workDir, envWithFakeTools);

      expect(down.code, down.stderr).toBe(0);
      expect(await respondsAt(`http://localhost:${port}`)).toBe(false);
      // Quien hace un fetch contra el puerto (esta misma suite, o el
      // navegador de Playwright durante una captura) aparece en esa lista
      // tanto como el servidor. Matarlo es matar a quien pregunta.
      expect(isAlive(client.pid!)).toBe(true);
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

// El andamiaje de este archivo arranca procesos auxiliares y sondea el puerto
// justo después. Cuando ese sondeo se adelanta al arranque del auxiliar, el
// test afirma una precondición que todavía no es cierta y falla al azar bajo
// carga (issue #125). Estos tests cubren al andamiaje mismo.
describe("andamiaje de los tests de ui-preflight.sh", () => {
  let muteServer: ChildProcess | undefined;

  afterEach(() => {
    if (muteServer) {
      muteServer.kill();
      muteServer = undefined;
    }
  });

  it("startMuteServer no vuelve hasta que el puerto acepta conexiones", async () => {
    const port = nextPort();

    muteServer = await startMuteServer(port);

    expect((await probePort(port)).accepted).toBe(true);
  });

  it("el motivo sobrevive al AggregateError que agrupa los intentos por familia", () => {
    // Lo que de verdad emite node al conectar a "localhost" cuando resuelve a
    // ::1 y a 127.0.0.1: agrupa los dos fallos y deja su propio `message`
    // vacío. Leerlo a secas daba un motivo en blanco en el runner de Linux, y
    // en Windows no, porque ahí no llegaba a haber dos familias que agrupar.
    const bothFamiliesRefused = new AggregateError([
      new Error("connect ECONNREFUSED ::1:24063"),
      new Error("connect ECONNREFUSED 127.0.0.1:24063"),
    ]);

    expect(describeConnectError(bothFamiliesRefused)).toBe(
      "connect ECONNREFUSED ::1:24063; connect ECONNREFUSED 127.0.0.1:24063",
    );
  });

  it("esperar a un puerto que nadie ocupa falla nombrando el puerto, lo esperado y el motivo", async () => {
    const port = nextPort();

    // El motivo se comprueba como "algo, no vacío", a propósito. Exigir aquí
    // el ECONNREFUSED que da un puerto libre ataría el test al errno de una
    // plataforma, y una máquina que descarte el paquete en vez de rechazarlo
    // daría el motivo del handshake agotado. Eso es exactamente el tipo de
    // fragilidad por entorno que este ticket vino a quitar.
    await expect(waitUntilPortAccepts(port, 300)).rejects.toThrow(
      new RegExp(
        `^el puerto ${port} no llegó a aceptar conexiones en \\d+ ms \\(último intento: .+\\)$`,
      ),
    );
  });
});

describe("plazo de las secuencias de ui-preflight", () => {
  const FOUR_CALLS = ["up", "down", "up", "down"] as const;
  const TODAY = { bootTimeoutS: 8, stopTimeoutS: 10 };

  it("cubre al menos las esperas de up y de down que el script declara", () => {
    // Sólo las pausas escritas en el script, sin contar lo que cuesta cada
    // sondeo: up espera BOOT_TIMEOUT, y down hace 1 s en kill_tree, hasta
    // STOP_TIMEOUT a que el puerto quede libre y 1 s tras kill_port_owner.
    const sleepsOnlyMs = 2 * 8_000 + 2 * (1_000 + 10_000 + 1_000);

    expect(sequenceDeadlineMs(FOUR_CALLS, TODAY)).toBeGreaterThanOrEqual(
      sleepsOnlyMs,
    );
  });

  it("crece cuando el script alarga STOP_TIMEOUT", () => {
    const longerStop = { ...TODAY, stopTimeoutS: 20 };

    const growthMs =
      sequenceDeadlineMs(FOUR_CALLS, longerStop) -
      sequenceDeadlineMs(FOUR_CALLS, TODAY);

    expect(growthMs).toBeGreaterThanOrEqual(2 * 10_000);
  });

  it("crece cuando se alarga FABRICA_SERVER_TIMEOUT", () => {
    const longerBoot = { ...TODAY, bootTimeoutS: 18 };

    const growthMs =
      sequenceDeadlineMs(FOUR_CALLS, longerBoot) -
      sequenceDeadlineMs(FOUR_CALLS, TODAY);

    expect(growthMs).toBeGreaterThanOrEqual(2 * 10_000);
  });

  it("lee STOP_TIMEOUT del texto del script", () => {
    const script = "#!/usr/bin/env bash\nSTOP_TIMEOUT=37\n";

    expect(readStopTimeoutS(script)).toBe(37);
  });

  it("falla con un mensaje claro si el script deja de declarar STOP_TIMEOUT", () => {
    expect(() => readStopTimeoutS("#!/usr/bin/env bash\n")).toThrow(
      /STOP_TIMEOUT/,
    );
  });
});

describe("diagnóstico de una secuencia lenta", () => {
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const never = (): Promise<void> => new Promise(() => undefined);

  it("resuelve cuando todos los pasos terminan dentro del plazo", async () => {
    const steps = [
      { name: "up", run: () => sleep(5) },
      { name: "down", run: () => sleep(5) },
    ];

    await expect(runTimedSequence(steps, 1_000)).resolves.toBeUndefined();
  });

  it("nombra el paso que no terminó y lo que tardaron los anteriores", async () => {
    const steps = [
      { name: "up", run: () => sleep(20) },
      { name: "down", run: () => sleep(20) },
      { name: "up", run: never },
      { name: "down", run: never },
    ];

    await expect(runTimedSequence(steps, 300)).rejects.toThrow(
      /^la secuencia up, down, up, down no terminó en 300 ms: seguía en el paso 3 \(up\) tras \d+ ms; antes, up tardó \d+ ms y down \d+ ms$/,
    );
  });

  it("dice que no hubo pasos anteriores cuando se atasca el primero", async () => {
    const steps = [{ name: "up", run: never }];

    await expect(runTimedSequence(steps, 50)).rejects.toThrow(
      /seguía en el paso 1 \(up\) tras \d+ ms; no había terminado ningún paso antes$/,
    );
  });

  it("no empieza ningún paso nuevo después de agotar el plazo", async () => {
    // Un `up` que arrancara tras el plazo dejaría un servidor huérfano: el
    // afterEach ya habría hecho su `down` y borrado el directorio.
    let secondStepStarts = 0;
    const steps = [
      { name: "down", run: () => sleep(100) },
      {
        name: "up",
        run: async (): Promise<void> => {
          secondStepStarts += 1;
        },
      },
    ];

    await expect(runTimedSequence(steps, 20)).rejects.toThrow(
      /paso 1 \(down\)/,
    );
    await sleep(200);

    expect(secondStepStarts).toBe(0);
  });

  it("deja pasar tal cual el error de un paso, sin disfrazarlo de plazo", async () => {
    const steps = [
      {
        name: "up",
        run: async (): Promise<void> => {
          throw new Error("el puerto no respondió");
        },
      },
    ];

    await expect(runTimedSequence(steps, 1_000)).rejects.toThrow(
      /^el puerto no respondió$/,
    );
  });
});
