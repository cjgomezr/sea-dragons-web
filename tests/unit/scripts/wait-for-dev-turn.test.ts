import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/wait-for-dev-turn.sh");

const CHECKS = ".github/workflows/checks.yml";
const VISUAL = ".github/workflows/visual-baselines.yml";
const MIGRATIONS = ".github/workflows/migrations.yml";

/** El máximo de espera sin `DEV_TURN_MAX_WAIT_MINUTES` (#517): un `checks`
 * tarda de 30 a 40 minutos y una visual de 15 a 20. */
const DEFAULT_MAX_WAIT_MINUTES = 150;

/** La corrida que pregunta: `checks` de la rama impl-2, arrancada a las 10. */
const MY_RUN_ID = "500";
const MY_RUN = `2026-10-06T10:00:00Z pull_request impl-2 ${CHECKS}`;

const EARLIER = "2026-10-06T09:50:00Z";
const EVEN_EARLIER = "2026-10-06T09:40:00Z";
const LATER = "2026-10-06T10:05:00Z";

/** Una línea por corrida, con los campos que el script le pide a la API. */
function runLine(fields: {
  id: string;
  startedAt: string;
  event?: string;
  branch?: string;
  workflowPath?: string;
}): string {
  const {
    id,
    startedAt,
    event = "pull_request",
    branch = "impl-1",
    workflowPath = VISUAL,
  } = fields;
  return `${id} ${startedAt} ${event} ${branch} ${workflowPath}`;
}

const AHEAD = runLine({ id: "400", startedAt: EARLIER });
const AHEAD_URL = "https://github.com/acme/repo/actions/runs/400";

interface RunResult {
  code: number | null;
  output: string;
  summary: string;
  sleeps: number;
}

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

/**
 * `gh` de mentira, con el patrón de `checks-already-green-on-pr.test.ts`:
 * responde según variables de entorno, ya en la forma que pide el `--jq`.
 *
 * - `MY_RUN`: la corrida propia (vacío = no se puede leer).
 * - `IN_PROGRESS_<n>`: las corridas en marcha en la consulta número n. Si una
 *   consulta no tiene la suya, repite la última que sí la tenía.
 * - `QUEUED`: las corridas en cola de runner, iguales en todas las consultas.
 * - `GATE_OF_<id>`: cómo va el job de turno de esa corrida (falta = aún no
 *   existe).
 * - `LIST_FAILS_FIRST`: cuántas consultas de la lista fallan antes de
 *   contestar.
 *
 * `sleep` también es de mentira: cuenta las esperas sin esperar.
 */
async function installFakes(workDir: string): Promise<string> {
  const binDir = path.join(workDir, "stub-bin");
  await mkdir(binDir, { recursive: true });
  const pollFile = toBashPath(path.join(workDir, "polls"));
  const sleepLog = toBashPath(path.join(workDir, "sleeps.log"));
  const gh = `#!/usr/bin/env bash
case "$2" in
  */actions/runs/*/jobs*)
    id="\${2#*/actions/runs/}"
    id="\${id%%/*}"
    var="GATE_OF_$id"
    echo "\${!var:-absent}"
    ;;
  *"/actions/runs?status=in_progress"*)
    polls=$(( $(cat "${pollFile}" 2>/dev/null || echo 0) + 1 ))
    echo "$polls" > "${pollFile}"
    [ "$polls" -le "\${LIST_FAILS_FIRST:-0}" ] && exit 1
    for (( n = polls; n >= 1; n-- )); do
      var="IN_PROGRESS_$n"
      if [ -n "\${!var+set}" ]; then
        [ -n "\${!var}" ] && printf '%s\\n' "\${!var}"
        exit 0
      fi
    done
    ;;
  *"/actions/runs?status=queued"*)
    [ -n "\${QUEUED:-}" ] && printf '%s\\n' "$QUEUED"
    ;;
  */actions/runs/*)
    [ -z "\${MY_RUN:-}" ] && exit 1
    echo "$MY_RUN"
    ;;
  *) exit 1 ;;
esac
exit 0
`;
  await writeFile(path.join(binDir, "gh"), gh);
  await chmod(path.join(binDir, "gh"), 0o755);
  await writeFile(
    path.join(binDir, "sleep"),
    `#!/usr/bin/env bash\necho "$1" >> "${sleepLog}"\n`,
  );
  await chmod(path.join(binDir, "sleep"), 0o755);
  await writeFile(sleepLog, "");
  return binDir;
}

function spawnScript(
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [toBashPath(SCRIPT)], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk: Buffer): void => {
      output += chunk.toString();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

describe("wait-for-dev-turn", () => {
  let workDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
      workDir = "";
    }
  });

  async function run(env: Record<string, string>): Promise<RunResult> {
    workDir = await mkdtemp(path.join(tmpdir(), "seadragons-dev-turn-"));
    const binDir = await installFakes(workDir);
    const summaryFile = path.join(workDir, "step-summary");
    await writeFile(summaryFile, "");

    const { code, output } = await spawnScript(workDir, {
      ...process.env,
      GH_REPO: "acme/repo",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_RUN_ID: MY_RUN_ID,
      GITHUB_STEP_SUMMARY: summaryFile,
      MY_RUN,
      ...env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    const sleepLog = await readFile(path.join(workDir, "sleeps.log"), "utf8");
    return {
      code,
      output,
      summary: await readFile(summaryFile, "utf8"),
      sleeps: sleepLog.split("\n").filter(Boolean).length,
    };
  }

  it("arranca sin esperar cuando no hay nadie delante", async () => {
    const { code, sleeps, summary } = await run({ IN_PROGRESS_1: "" });

    expect(code).toBe(0);
    expect(sleeps).toBe(0);
    expect(summary).toMatch(/seadragons-dev/);
  });

  it("no cuenta su propia corrida entre las que están en marcha", async () => {
    const own = runLine({
      id: MY_RUN_ID,
      startedAt: "2026-10-06T10:00:00Z",
      branch: "impl-2",
      workflowPath: CHECKS,
    });

    const { code, sleeps } = await run({
      IN_PROGRESS_1: own,
      [`GATE_OF_${MY_RUN_ID}`]: "in_progress",
    });

    expect(code).toBe(0);
    expect(sleeps).toBe(0);
  });

  it("espera a la corrida anterior que usa dev y arranca cuando termina", async () => {
    const { code, sleeps } = await run({
      IN_PROGRESS_1: AHEAD,
      GATE_OF_400: "success",
      IN_PROGRESS_2: "",
    });

    expect(code).toBe(0);
    expect(sleeps).toBe(1);
  });

  it("dice en el resumen que espera dev y detrás de qué corrida", async () => {
    const { summary } = await run({
      IN_PROGRESS_1: AHEAD,
      GATE_OF_400: "success",
      IN_PROGRESS_2: "",
    });

    expect(summary).toMatch(/seadragons-dev/);
    expect(summary).toContain(AHEAD_URL);
  });

  it("con varias delante espera a todas las anteriores, empezando por la más vieja", async () => {
    const oldest = runLine({ id: "300", startedAt: EVEN_EARLIER });
    const newer = runLine({ id: "600", startedAt: LATER, branch: "impl-3" });

    const { code, sleeps, summary } = await run({
      IN_PROGRESS_1: [AHEAD, oldest, newer].join("\n"),
      GATE_OF_300: "success",
      GATE_OF_400: "in_progress",
      GATE_OF_600: "in_progress",
      IN_PROGRESS_2: [AHEAD, newer].join("\n"),
      IN_PROGRESS_3: newer,
    });

    expect(code).toBe(0);
    expect(sleeps).toBe(2);
    expect(summary).toContain("https://github.com/acme/repo/actions/runs/300");
  });

  it("no espera a una corrida que llegó después, aunque ya esté en marcha", async () => {
    const newer = runLine({ id: "600", startedAt: LATER });

    const { code, sleeps } = await run({
      IN_PROGRESS_1: newer,
      GATE_OF_600: "success",
    });

    expect(code).toBe(0);
    expect(sleeps).toBe(0);
  });

  it("cuando la de delante se cancela, dev queda libre en cuanto termina", async () => {
    const { code, sleeps } = await run({
      IN_PROGRESS_1: AHEAD,
      GATE_OF_400: "cancelled",
      IN_PROGRESS_2: "",
    });

    expect(code).toBe(0);
    expect(sleeps).toBe(1);
  });

  it("no espera a su propia corrida anterior del mismo PR, que se está cancelando", async () => {
    const previous = runLine({
      id: "450",
      startedAt: EARLIER,
      branch: "impl-2",
      workflowPath: CHECKS,
    });

    const { code, sleeps } = await run({
      IN_PROGRESS_1: previous,
      GATE_OF_450: "success",
    });

    expect(code).toBe(0);
    expect(sleeps).toBe(0);
  });

  it("sí espera a la visual del mismo PR: también usa dev", async () => {
    const sameBranchVisual = runLine({
      id: "450",
      startedAt: EARLIER,
      branch: "impl-2",
      workflowPath: VISUAL,
    });

    const { sleeps } = await run({
      IN_PROGRESS_1: sameBranchVisual,
      GATE_OF_450: "success",
      IN_PROGRESS_2: "",
    });

    expect(sleeps).toBe(1);
  });

  it("no espera a un workflow que no usa dev", async () => {
    const migrations = runLine({
      id: "400",
      startedAt: EARLIER,
      workflowPath: MIGRATIONS,
    });

    const { sleeps } = await run({ IN_PROGRESS_1: migrations });

    expect(sleeps).toBe(0);
  });

  it("no espera a una corrida que se saltó su turno porque no necesita dev", async () => {
    const { sleeps } = await run({
      IN_PROGRESS_1: AHEAD,
      GATE_OF_400: "skipped",
    });

    expect(sleeps).toBe(0);
  });

  it("espera a una corrida anterior que todavía no llegó a pedir turno", async () => {
    // Su job de turno aún no existe (espera a `arbol-ya-verificado`, o no le
    // ha tocado runner). Llegó antes, así que va delante.
    const { sleeps } = await run({
      IN_PROGRESS_1: AHEAD,
      IN_PROGRESS_2: "",
    });

    expect(sleeps).toBe(1);
  });

  it("espera a una corrida anterior que sigue en cola de runner", async () => {
    const { sleeps, summary } = await run({
      IN_PROGRESS_1: "",
      QUEUED: AHEAD,
      DEV_TURN_MAX_WAIT_MINUTES: "1",
    });

    expect(sleeps).toBe(1);
    expect(summary).toContain(AHEAD_URL);
  });

  it("falla con un mensaje claro cuando se agota el tiempo máximo de espera", async () => {
    const { code, output, sleeps } = await run({
      IN_PROGRESS_1: AHEAD,
      GATE_OF_400: "success",
      DEV_TURN_MAX_WAIT_MINUTES: "2",
    });

    expect(code).not.toBe(0);
    expect(sleeps).toBe(2);
    expect(output).toMatch(/2 min/);
    expect(output).toContain(AHEAD_URL);
  });

  // Con 150 vueltas del `sleep` de mentira el test tardaría demasiado en
  // Windows, así que el valor por defecto se lee del propio script.
  it("sin la variable, se rinde a los 150 minutos de espera", async () => {
    const script = await readFile(SCRIPT, "utf8");

    expect(script).toContain(
      `MAX_WAIT_MINUTES="\${DEV_TURN_MAX_WAIT_MINUTES:-${DEFAULT_MAX_WAIT_MINUTES}}"`,
    );
  });

  it("vuelve a preguntar cuando la API falla y arranca cuando contesta", async () => {
    const { code, sleeps } = await run({
      LIST_FAILS_FIRST: "1",
      IN_PROGRESS_1: "",
    });

    expect(code).toBe(0);
    expect(sleeps).toBe(1);
  });

  it("falla con un mensaje claro cuando la API nunca contesta", async () => {
    const { code, output } = await run({
      LIST_FAILS_FIRST: "99",
      DEV_TURN_MAX_WAIT_MINUTES: "2",
    });

    expect(code).not.toBe(0);
    expect(output).toMatch(/API/);
  });

  it("falla con un mensaje claro cuando no puede leer su propia corrida", async () => {
    const { code, output } = await run({ MY_RUN: "" });

    expect(code).not.toBe(0);
    expect(output).toContain(MY_RUN_ID);
  });
});
