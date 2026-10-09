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
const SCRIPT = path.join(REPO_ROOT, "scripts/baselines-only-after-green.sh");

const WORKFLOW = "checks.yml";
const HEAVY_JOB = "checks";

/** La cabeza del PR antes del empujón (`github.event.before`) y después. */
const BEFORE_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HEAD_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const NULL_SHA = "0000000000000000000000000000000000000000";

const GREEN_RUN_ID = 4242;

const LINUX_BASELINE =
  "tests/ui.spec.ts-snapshots/panel-desktop-light-chromium-linux.png";
const OTHER_LINUX_BASELINE =
  "tests/ui.spec.ts-snapshots/panel-mobile-dark-chromium-linux.png";

/** Lo que la API de comparación devuelve, en lo que al script le importa. */
interface FakeCompare {
  status: "ahead" | "behind" | "diverged" | "identical";
  files: Array<{ filename: string; previous_filename?: string }>;
}

/** Una corrida tal como la describe la API de Actions. */
interface FakeRun {
  id: number;
  workflow: string;
  event: "pull_request" | "push";
  head_sha: string;
  status: "completed" | "in_progress";
  conclusion: "success" | "failure" | "cancelled" | "skipped" | null;
}

interface FakeJob {
  name: string;
  conclusion: "success" | "failure" | "skipped" | null;
}

interface Scenario {
  compare?: FakeCompare;
  runs?: FakeRun[];
  jobs?: Record<string, FakeJob[]>;
  env?: Record<string, string>;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  output: string;
  summary: string;
}

const ONLY_LINUX_BASELINES: FakeCompare = {
  status: "ahead",
  files: [{ filename: LINUX_BASELINE }, { filename: OTHER_LINUX_BASELINE }],
};

const GREEN_RUN_ON_BEFORE: FakeRun = {
  id: GREEN_RUN_ID,
  workflow: WORKFLOW,
  event: "pull_request",
  head_sha: BEFORE_SHA,
  status: "completed",
  conclusion: "success",
};

const HEAVY_JOB_RAN: Record<string, FakeJob[]> = {
  [String(GREEN_RUN_ID)]: [
    { name: "arbol-ya-verificado", conclusion: "success" },
    { name: HEAVY_JOB, conclusion: "success" },
  ],
};

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

/**
 * `gh` de mentira que imita las dos APIs que el script consulta y aplica con
 * `jq` la misma expresión `--jq` que pide el script. Así una corrida roja, de
 * otro commit o de otro workflow se descarta por la lógica del script y no por
 * el doble. Un archivo de fixture que falta es una API que no contesta.
 */
async function installFakeGh(workDir: string): Promise<string> {
  const binDir = path.join(workDir, "stub-bin");
  await mkdir(binDir, { recursive: true });
  const logFile = path.join(workDir, "gh-calls.log");
  const script = `#!/usr/bin/env bash
echo "$@" >> "${toBashPath(logFile)}"

[ "\${GH_FAILS:-0}" = "1" ] && exit 1

url="$2"
jq_expression="\${4:-.}"

case "$url" in
  */compare/*)
    [ -f "\${COMPARE_FILE:-}" ] || exit 1
    jq -r "$jq_expression" "$COMPARE_FILE"
    ;;
  */actions/workflows/*/runs*)
    [ -f "\${RUNS_FILE:-}" ] || exit 1
    workflow="\${url#*/actions/workflows/}"
    workflow="\${workflow%%/*}"
    event=$(printf '%s' "$url" | sed -n 's/.*[?&]event=\\([^&]*\\).*/\\1/p')
    head_sha=$(printf '%s' "$url" | sed -n 's/.*[?&]head_sha=\\([^&]*\\).*/\\1/p')
    jq --arg workflow "$workflow" --arg event "$event" --arg head_sha "$head_sha" \\
      '{workflow_runs: [.[] | select(.workflow == $workflow
        and ($event == "" or .event == $event)
        and ($head_sha == "" or .head_sha == $head_sha))]}' \\
      "$RUNS_FILE" | jq -r "$jq_expression"
    ;;
  */actions/runs/*/jobs*)
    [ -f "\${JOBS_FILE:-}" ] || exit 1
    run_id="\${url#*/actions/runs/}"
    run_id="\${run_id%%/*}"
    jq --arg id "$run_id" '{jobs: (.[$id] // [])}' "$JOBS_FILE" |
      jq -r "$jq_expression"
    ;;
  *) exit 1 ;;
esac
`;
  await writeFile(path.join(binDir, "gh"), script);
  await chmod(path.join(binDir, "gh"), 0o755);
  await writeFile(logFile, "");
  return binDir;
}

function spawnScript(
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [toBashPath(SCRIPT)], {
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

describe("baselines-only-after-green", () => {
  let workDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
      workDir = "";
    }
  });

  async function writeFixture(
    name: string,
    contents: unknown,
  ): Promise<Record<string, string>> {
    if (contents === undefined) {
      return {};
    }
    const file = path.join(workDir, `${name}.json`);
    await writeFile(file, JSON.stringify(contents));
    return { [`${name.toUpperCase()}_FILE`]: toBashPath(file) };
  }

  /** Corre el script como lo corre el job de la pregunta en un PR, con
   * GITHUB_OUTPUT y GITHUB_STEP_SUMMARY apuntando a archivos. */
  async function run(scenario: Scenario): Promise<RunResult> {
    workDir = await mkdtemp(path.join(tmpdir(), "seadragons-baselines-gate-"));
    const binDir = await installFakeGh(workDir);
    const outputFile = path.join(workDir, "github-output");
    const summaryFile = path.join(workDir, "step-summary");
    await writeFile(outputFile, "");
    await writeFile(summaryFile, "");

    const result = await spawnScript(workDir, {
      ...process.env,
      GH_REPO: "acme/repo",
      BEFORE_SHA,
      HEAD_SHA,
      WORKFLOW_FILE: WORKFLOW,
      HEAVY_JOB,
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
      ...(await writeFixture("compare", scenario.compare)),
      ...(await writeFixture("runs", scenario.runs)),
      ...(await writeFixture("jobs", scenario.jobs)),
      ...scenario.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    return {
      ...result,
      output: await readFile(outputFile, "utf8"),
      summary: await readFile(summaryFile, "utf8"),
    };
  }

  const GREEN_BEFORE: Scenario = {
    compare: ONLY_LINUX_BASELINES,
    runs: [GREEN_RUN_ON_BEFORE],
    jobs: HEAVY_JOB_RAN,
  };

  it("dice que sí cuando el commit nuevo solo trae líneas base de Linux y el anterior pasó la suite", async () => {
    const { code, output } = await run(GREEN_BEFORE);

    expect(code).toBe(0);
    expect(output).toContain("ya_verificado=true");
  });

  it("deja en el resumen qué commit anterior estaba verde y qué corrida lo prueba", async () => {
    const { summary } = await run(GREEN_BEFORE);

    expect(summary).toContain(BEFORE_SHA);
    expect(summary).toContain(`acme/repo/actions/runs/${GREEN_RUN_ID}`);
  });

  it("dice que no cuando el commit nuevo toca un archivo fuera de las líneas base", async () => {
    const { output } = await run({
      ...GREEN_BEFORE,
      compare: {
        status: "ahead",
        files: [{ filename: LINUX_BASELINE }, { filename: "src/app/page.tsx" }],
      },
    });

    expect(output).toContain("ya_verificado=false");
  });

  it.each([
    "tests/ui.spec.ts-snapshots/panel-desktop-light-chromium-win32.png",
    "tests/ui.spec.ts-snapshots/panel-desktop-light-chromium-darwin.png",
  ])(
    "dice que no cuando el commit trae una captura que no es de Linux: %s",
    async (file) => {
      const { output } = await run({
        ...GREEN_BEFORE,
        compare: { status: "ahead", files: [{ filename: file }] },
      });

      expect(output).toContain("ya_verificado=false");
    },
  );

  it("dice que no cuando la captura de Linux vive fuera del directorio de líneas base", async () => {
    const { output } = await run({
      ...GREEN_BEFORE,
      compare: {
        status: "ahead",
        files: [{ filename: "public/hero-chromium-linux.png" }],
      },
    });

    expect(output).toContain("ya_verificado=false");
  });

  it("dice que no cuando una línea base llega renombrando un archivo de fuera", async () => {
    // El rename borra el archivo de origen: el árbol cambia fuera de las
    // líneas base aunque el nombre nuevo encaje.
    const { output } = await run({
      ...GREEN_BEFORE,
      compare: {
        status: "ahead",
        files: [
          { filename: LINUX_BASELINE, previous_filename: "src/app/logo.png" },
        ],
      },
    });

    expect(output).toContain("ya_verificado=false");
  });

  it("dice que no cuando la comparación no trae ningún archivo", async () => {
    const { output } = await run({
      ...GREEN_BEFORE,
      compare: { status: "ahead", files: [] },
    });

    expect(output).toContain("ya_verificado=false");
  });

  it("dice que no cuando la comparación llega al tope de archivos de la API y puede venir recortada", async () => {
    const files = Array.from({ length: 300 }, (_, index) => ({
      filename: `tests/ui.spec.ts-snapshots/estado-${index}-chromium-linux.png`,
    }));

    const { output } = await run({
      ...GREEN_BEFORE,
      compare: { status: "ahead", files },
    });

    expect(output).toContain("ya_verificado=false");
  });

  it.each([
    ["en rojo", { status: "completed", conclusion: "failure" }],
    ["cancelada", { status: "completed", conclusion: "cancelled" }],
    ["en curso", { status: "in_progress", conclusion: null }],
  ] as const)(
    "dice que no cuando la corrida del commit anterior está %s",
    async (_label, state) => {
      const { output } = await run({
        ...GREEN_BEFORE,
        runs: [{ ...GREEN_RUN_ON_BEFORE, ...state }],
      });

      expect(output).toContain("ya_verificado=false");
    },
  );

  it("dice que no cuando el commit anterior no tiene ninguna corrida", async () => {
    const { output } = await run({ ...GREEN_BEFORE, runs: [] });

    expect(output).toContain("ya_verificado=false");
  });

  it("dice que no cuando la única corrida verde del commit anterior es de otro workflow", async () => {
    const { output } = await run({
      ...GREEN_BEFORE,
      runs: [{ ...GREEN_RUN_ON_BEFORE, workflow: "visual-baselines.yml" }],
    });

    expect(output).toContain("ya_verificado=false");
  });

  it("dice que no cuando la única corrida verde del commit anterior no nació de un pull request", async () => {
    const { output } = await run({
      ...GREEN_BEFORE,
      runs: [{ ...GREEN_RUN_ON_BEFORE, event: "push" }],
    });

    expect(output).toContain("ya_verificado=false");
  });

  it("dice que no cuando la corrida verde del commit anterior fue a su vez un salto", async () => {
    // Un job saltado por `if:` deja el workflow en success. Si eso contara,
    // dos aceptaciones seguidas encadenarían saltos sin que nadie hubiera
    // corrido nunca la suite sobre el código.
    const { output } = await run({
      ...GREEN_BEFORE,
      jobs: {
        [String(GREEN_RUN_ID)]: [
          { name: "solo-lineas-base", conclusion: "success" },
          { name: HEAVY_JOB, conclusion: "skipped" },
        ],
      },
    });

    expect(output).toContain("ya_verificado=false");
  });

  it("dice que no cuando el commit anterior no es antepasado del nuevo (push forzado)", async () => {
    const { output } = await run({
      ...GREEN_BEFORE,
      compare: { ...ONLY_LINUX_BASELINES, status: "diverged" },
    });

    expect(output).toContain("ya_verificado=false");
  });

  it.each([
    ["el SHA nulo", NULL_SHA],
    ["vacío", ""],
    ["algo que no es un SHA", "main"],
  ])("dice que no cuando el commit anterior es %s", async (_label, before) => {
    const { output } = await run({
      ...GREEN_BEFORE,
      env: { BEFORE_SHA: before },
    });

    expect(output).toContain("ya_verificado=false");
  });

  it("dice que no cuando la API no contesta, en vez de ahorrarse la corrida", async () => {
    const { code, output } = await run({
      ...GREEN_BEFORE,
      env: { GH_FAILS: "1" },
    });

    expect(code).toBe(0);
    expect(output).toContain("ya_verificado=false");
  });

  it.each(["compare", "runs", "jobs"] as const)(
    "dice que no cuando falla solo la consulta de %s",
    async (missing) => {
      const { code, output } = await run({
        ...GREEN_BEFORE,
        [missing]: undefined,
      });

      expect(code).toBe(0);
      expect(output).toContain("ya_verificado=false");
    },
  );

  it("busca la corrida del commit anterior en el workflow que pregunta", async () => {
    const { output } = await run({
      ...GREEN_BEFORE,
      runs: [{ ...GREEN_RUN_ON_BEFORE, workflow: "migrations.yml" }],
      jobs: {
        [String(GREEN_RUN_ID)]: [
          { name: "migraciones", conclusion: "success" },
        ],
      },
      env: { WORKFLOW_FILE: "migrations.yml", HEAVY_JOB: "migraciones" },
    });

    const log = await readFile(path.join(workDir, "gh-calls.log"), "utf8");
    expect(log).toMatch(/workflows\/migrations\.yml\/runs/);
    expect(output).toContain("ya_verificado=true");
  });

  it("explica en el resumen por qué no se salta, nombrando el commit anterior", async () => {
    const { summary } = await run({ ...GREEN_BEFORE, runs: [] });

    expect(summary).toContain(BEFORE_SHA);
  });
});
