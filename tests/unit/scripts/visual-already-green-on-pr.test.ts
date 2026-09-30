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
const SCRIPT = path.join(REPO_ROOT, "scripts/checks-already-green-on-pr.sh");
const VISUAL_WORKFLOW = "visual-baselines.yml";

/** El commit que el merge dejó en main, y el árbol que trae. */
const MAIN_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MAIN_TREE = "1111111111111111111111111111111111111111";
/** La cabeza del PR que se mergeó. */
const PR_HEAD_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
/** Un commit anterior de ese mismo PR. */
const EARLIER_PR_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const OTHER_TREE = "2222222222222222222222222222222222222222";

const SQUASH_MESSAGE = "Enseña el logo del club (#421) (#440)";

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  output: string;
}

/** Una corrida de la visual tal como la describe la API de Actions. */
interface FakeRun {
  workflow: string;
  event: "pull_request" | "push" | "workflow_dispatch";
  headSha: string;
  status: "completed" | "in_progress";
  conclusion: "success" | "failure" | "cancelled" | null;
}

const GREEN_VISUAL_ON_HEAD: FakeRun = {
  workflow: VISUAL_WORKFLOW,
  event: "pull_request",
  headSha: PR_HEAD_SHA,
  status: "completed",
  conclusion: "success",
};

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

/**
 * `gh` de mentira que imita la API de Actions en vez de devolver un número
 * fijo: filtra las corridas de `RUNS_FILE` por workflow, evento y cabeza como
 * lo hace GitHub, y aplica con `jq` la misma expresión `--jq` que pide el
 * script. Así una corrida roja, cancelada o de otro commit se descarta por la
 * lógica del script y no por el doble.
 */
async function installFakeGh(workDir: string): Promise<string> {
  const binDir = path.join(workDir, "stub-bin");
  await mkdir(binDir, { recursive: true });
  const logFile = path.join(workDir, "gh-calls.log");
  const script = `#!/usr/bin/env bash
echo "$@" >> "${toBashPath(logFile)}"

url="$2"
jq_expression="\${4:-.}"

case "$url" in
  */pulls/*) echo "\${PR_HEAD:-}" ;;
  */commits/*)
    sha="\${url##*/commits/}"
    var="TREE_OF_$sha"
    echo "\${!var:-}"
    ;;
  */actions/workflows/*/runs*)
    workflow="\${url#*/actions/workflows/}"
    workflow="\${workflow%%/*}"
    event=$(printf '%s' "$url" | sed -n 's/.*[?&]event=\\([^&]*\\).*/\\1/p')
    head_sha=$(printf '%s' "$url" | sed -n 's/.*[?&]head_sha=\\([^&]*\\).*/\\1/p')
    jq --arg workflow "$workflow" --arg event "$event" --arg head_sha "$head_sha" \\
      '{workflow_runs: [.[] | select(.workflow == $workflow
        and ($event == "" or .event == $event)
        and ($head_sha == "" or .head_sha == $head_sha))]}' \\
      "\${RUNS_FILE}" | jq -r "$jq_expression"
    ;;
  *) exit 1 ;;
esac
exit 0
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

describe("checks-already-green-on-pr con WORKFLOW_FILE=visual-baselines.yml", () => {
  let workDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
      workDir = "";
    }
  });

  interface Scenario {
    runs: FakeRun[];
    env?: Record<string, string>;
  }

  /** Corre el script como lo corre el job `arbol-ya-verificado` de la visual. */
  async function run({ runs, env = {} }: Scenario): Promise<RunResult> {
    workDir = await mkdtemp(path.join(tmpdir(), "seadragons-visual-gate-"));
    const binDir = await installFakeGh(workDir);
    const outputFile = path.join(workDir, "github-output");
    const runsFile = path.join(workDir, "runs.json");
    await writeFile(outputFile, "");
    await writeFile(
      runsFile,
      JSON.stringify(
        runs.map((fake) => ({
          workflow: fake.workflow,
          event: fake.event,
          head_sha: fake.headSha,
          status: fake.status,
          conclusion: fake.conclusion,
        })),
      ),
    );

    const result = await spawnScript(workDir, {
      ...process.env,
      GH_REPO: "acme/repo",
      GITHUB_SHA: MAIN_SHA,
      GITHUB_OUTPUT: outputFile,
      WORKFLOW_FILE: VISUAL_WORKFLOW,
      HEAD_COMMIT_MESSAGE: SQUASH_MESSAGE,
      PR_HEAD: PR_HEAD_SHA,
      RUNS_FILE: toBashPath(runsFile),
      [`TREE_OF_${MAIN_SHA}`]: MAIN_TREE,
      [`TREE_OF_${PR_HEAD_SHA}`]: MAIN_TREE,
      ...env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    return { ...result, output: await readFile(outputFile, "utf8") };
  }

  it("dice que sí cuando el árbol es el de la cabeza del PR y su visual salió verde", async () => {
    const { code, output } = await run({ runs: [GREEN_VISUAL_ON_HEAD] });

    expect(code).toBe(0);
    expect(output).toContain("ya_verificado=true");
  });

  it("explica en el log por qué se salta la comparación", async () => {
    const { stdout } = await run({ runs: [GREEN_VISUAL_ON_HEAD] });

    expect(stdout).toMatch(/#440/);
    expect(stdout).toMatch(/visual-baselines\.yml/);
  });

  it("busca la corrida en visual-baselines.yml, no en checks.yml", async () => {
    await run({ runs: [GREEN_VISUAL_ON_HEAD] });

    const log = await readFile(path.join(workDir, "gh-calls.log"), "utf8");
    expect(log).toMatch(/actions\/workflows\/visual-baselines\.yml\/runs/);
    expect(log).not.toMatch(/actions\/workflows\/checks\.yml/);
  });

  it("dice que no cuando lo que salió verde fue checks.yml y no la visual", async () => {
    const { output } = await run({
      runs: [{ ...GREEN_VISUAL_ON_HEAD, workflow: "checks.yml" }],
    });

    expect(output).toContain("ya_verificado=false");
  });

  it("dice que no cuando main se movió y el árbol no es el de la cabeza del PR", async () => {
    const { output } = await run({
      runs: [GREEN_VISUAL_ON_HEAD],
      env: { [`TREE_OF_${PR_HEAD_SHA}`]: OTHER_TREE },
    });

    expect(output).toContain("ya_verificado=false");
  });

  it.each([
    ["falló", { status: "completed", conclusion: "failure" }],
    ["fue cancelada", { status: "completed", conclusion: "cancelled" }],
    ["sigue en curso", { status: "in_progress", conclusion: null }],
  ] as const)(
    "dice que no cuando la visual del PR %s",
    async (_description, outcome) => {
      const { output } = await run({
        runs: [{ ...GREEN_VISUAL_ON_HEAD, ...outcome }],
      });

      expect(output).toContain("ya_verificado=false");
    },
  );

  it("dice que no cuando el PR no tiene ninguna visual", async () => {
    const { output } = await run({ runs: [] });

    expect(output).toContain("ya_verificado=false");
  });

  it("dice que sí cuando la visual salió verde sólo tras aceptar la línea base", async () => {
    // La cabeza del PR es el commit del bot con las capturas aceptadas, así que
    // su árbol ya las incluye. La corrida roja es la del commit anterior, y la
    // aceptación en sí (workflow_dispatch) no cuenta.
    const { output } = await run({
      runs: [
        {
          ...GREEN_VISUAL_ON_HEAD,
          headSha: EARLIER_PR_SHA,
          conclusion: "failure",
        },
        {
          ...GREEN_VISUAL_ON_HEAD,
          headSha: EARLIER_PR_SHA,
          event: "workflow_dispatch",
        },
        GREEN_VISUAL_ON_HEAD,
      ],
    });

    expect(output).toContain("ya_verificado=true");
  });

  it("dice que no cuando la visual verde es de un commit anterior del PR", async () => {
    const { output } = await run({
      runs: [{ ...GREEN_VISUAL_ON_HEAD, headSha: EARLIER_PR_SHA }],
    });

    expect(output).toContain("ya_verificado=false");
  });

  it("no cuenta una aceptación verde, porque aceptar no compara", async () => {
    const { output } = await run({
      runs: [{ ...GREEN_VISUAL_ON_HEAD, event: "workflow_dispatch" }],
    });

    expect(output).toContain("ya_verificado=false");
  });

  it("dice que no en un push directo sin PR detrás", async () => {
    const { output } = await run({
      runs: [GREEN_VISUAL_ON_HEAD],
      env: { HEAD_COMMIT_MESSAGE: "Arreglo rápido a mano" },
    });

    expect(output).toContain("ya_verificado=false");
  });

  it("dice que no cuando el (#N) no está al final de la primera línea", async () => {
    const { output } = await run({
      runs: [GREEN_VISUAL_ON_HEAD],
      env: { HEAD_COMMIT_MESSAGE: "Revierte (#440) a medias\n\nDetalle" },
    });

    expect(output).toContain("ya_verificado=false");
  });

  it("dice que no cuando el PR del mensaje ya no existe", async () => {
    const { output } = await run({
      runs: [GREEN_VISUAL_ON_HEAD],
      env: { PR_HEAD: "" },
    });

    expect(output).toContain("ya_verificado=false");
  });
});

describe("checks-already-green-on-pr sin WORKFLOW_FILE", () => {
  let workDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
      workDir = "";
    }
  });

  it("sigue buscando la corrida de checks.yml, como antes", async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "seadragons-visual-gate-"));
    const binDir = await installFakeGh(workDir);
    const runsFile = path.join(workDir, "runs.json");
    await writeFile(runsFile, "[]");
    const inheritedEnv: NodeJS.ProcessEnv = { ...process.env };
    delete inheritedEnv.WORKFLOW_FILE;

    await spawnScript(workDir, {
      ...inheritedEnv,
      GH_REPO: "acme/repo",
      GITHUB_SHA: MAIN_SHA,
      HEAD_COMMIT_MESSAGE: SQUASH_MESSAGE,
      PR_HEAD: PR_HEAD_SHA,
      RUNS_FILE: toBashPath(runsFile),
      [`TREE_OF_${MAIN_SHA}`]: MAIN_TREE,
      [`TREE_OF_${PR_HEAD_SHA}`]: MAIN_TREE,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    const log = await readFile(path.join(workDir, "gh-calls.log"), "utf8");
    expect(log).toMatch(/actions\/workflows\/checks\.yml\/runs/);
  });
});
