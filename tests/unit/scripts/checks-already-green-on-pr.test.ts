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

/** El commit que el merge dejó en main, y el árbol que trae. */
const MAIN_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MAIN_TREE = "1111111111111111111111111111111111111111";
/** La cabeza del PR que se mergeó, y el árbol que ya pasó en verde. */
const PR_HEAD_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const OTHER_TREE = "2222222222222222222222222222222222222222";

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  output: string;
}

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

/**
 * `gh` de mentira, con el mismo patrón que
 * `tests/unit/scripts/report-visual-incident.test.ts`: registra cada llamada
 * y responde según variables de entorno.
 *
 * - `PR_HEAD` es la cabeza que devuelve la consulta del PR (vacío = no hay).
 * - `TREE_OF_<sha>` es el árbol de cada commit.
 * - `GREEN_RUNS` cuántas corridas verdes de `checks` hay para esa cabeza.
 * - `GH_FAILS` hace que cualquier llamada a la API falle.
 */
async function installFakeGh(workDir: string): Promise<string> {
  const binDir = path.join(workDir, "stub-bin");
  await mkdir(binDir, { recursive: true });
  const logFile = path.join(workDir, "gh-calls.log");
  const script = `#!/usr/bin/env bash
echo "$@" >> "${toBashPath(logFile)}"

[ "\${GH_FAILS:-0}" = "1" ] && exit 1

case "$2" in
  */pulls/*) echo "\${PR_HEAD:-}" ;;
  */commits/*)
    sha="\${2##*/commits/}"
    var="TREE_OF_$sha"
    echo "\${!var:-}"
    ;;
  */runs*) echo "\${GREEN_RUNS:-0}" ;;
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

describe("checks-already-green-on-pr", () => {
  let workDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
      workDir = "";
    }
  });

  /** Corre el script como lo corre Actions: con GITHUB_OUTPUT apuntando a un
   * archivo, que es de donde el job lee la respuesta. */
  async function run(env: Record<string, string>): Promise<RunResult> {
    workDir = await mkdtemp(path.join(tmpdir(), "seadragons-tree-gate-"));
    const binDir = await installFakeGh(workDir);
    const outputFile = path.join(workDir, "github-output");
    await writeFile(outputFile, "");

    const result = await spawnScript(workDir, {
      ...process.env,
      GH_REPO: "acme/repo",
      GITHUB_SHA: MAIN_SHA,
      GITHUB_OUTPUT: outputFile,
      [`TREE_OF_${MAIN_SHA}`]: MAIN_TREE,
      [`TREE_OF_${PR_HEAD_SHA}`]: MAIN_TREE,
      ...env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    return { ...result, output: await readFile(outputFile, "utf8") };
  }

  it("dice que sí cuando el árbol del merge es el que el PR dejó en verde", async () => {
    const { code, output } = await run({
      HEAD_COMMIT_MESSAGE: "Recorta lo que gasta CI (#193)",
      PR_HEAD: PR_HEAD_SHA,
      GREEN_RUNS: "1",
    });

    expect(code).toBe(0);
    expect(output).toContain("ya_verificado=true");
  });

  it("dice que no cuando el merge trae un árbol distinto al que se probó", async () => {
    const { code, output } = await run({
      HEAD_COMMIT_MESSAGE: "Recorta lo que gasta CI (#193)",
      PR_HEAD: PR_HEAD_SHA,
      [`TREE_OF_${PR_HEAD_SHA}`]: OTHER_TREE,
      GREEN_RUNS: "1",
    });

    expect(code).toBe(0);
    expect(output).toContain("ya_verificado=false");
  });

  it("dice que no cuando ese árbol nunca pasó los checks en verde", async () => {
    // Un PR mergeado con el check en rojo, o antes de que terminara: el repo
    // no tiene branch protection, así que es posible y es justo el caso en el
    // que main necesita su propia corrida.
    const { output } = await run({
      HEAD_COMMIT_MESSAGE: "Recorta lo que gasta CI (#193)",
      PR_HEAD: PR_HEAD_SHA,
      GREEN_RUNS: "0",
    });

    expect(output).toContain("ya_verificado=false");
  });

  it("dice que no cuando el commit no viene de un squash de PR", async () => {
    // Un push directo a main no tiene PR detrás, y nadie ha comprobado su
    // árbol: es exactamente la corrida que no se puede ahorrar.
    const { output } = await run({
      HEAD_COMMIT_MESSAGE: "Arreglo rápido a mano",
      PR_HEAD: PR_HEAD_SHA,
      GREEN_RUNS: "1",
    });

    expect(output).toContain("ya_verificado=false");
  });

  it("toma el número del PR que cierra el merge, no el que cita el título", async () => {
    // Los squash de esta fábrica arrastran el `(#N)` del commit original:
    // "Título (#174) (#176)". El PR que se acaba de mergear es el último.
    const { output } = await run({
      HEAD_COMMIT_MESSAGE:
        "Haz que los colores no dependan de un script (#174) (#176)",
      PR_HEAD: PR_HEAD_SHA,
      GREEN_RUNS: "1",
    });

    expect(output).toContain("ya_verificado=true");
    const log = await readFile(path.join(workDir, "gh-calls.log"), "utf8");
    expect(log).toMatch(/pulls\/176/);
    expect(log).not.toMatch(/pulls\/174/);
  });

  it("sólo cuenta como verde una corrida nacida de un pull request", async () => {
    // Una corrida cuyo único job quedó `skipped` concluye `success`, y desde
    // este mismo cambio eso es lo que `checks` produce en main. Contarla sería
    // dar por probado un árbol apoyándose en una corrida que no probó nada.
    await run({
      HEAD_COMMIT_MESSAGE: "Recorta lo que gasta CI (#193)",
      PR_HEAD: PR_HEAD_SHA,
      GREEN_RUNS: "1",
    });

    const log = await readFile(path.join(workDir, "gh-calls.log"), "utf8");
    expect(log).toMatch(/event=pull_request/);
  });

  it("dice que no cuando la API no contesta, en vez de ahorrarse la corrida", async () => {
    // Fallar hacia el lado caro: perder un minuto es recuperable, mergear sin
    // que nadie corriera los checks no.
    const { code, output } = await run({
      HEAD_COMMIT_MESSAGE: "Recorta lo que gasta CI (#193)",
      PR_HEAD: PR_HEAD_SHA,
      GREEN_RUNS: "1",
      GH_FAILS: "1",
    });

    expect(code).toBe(0);
    expect(output).toContain("ya_verificado=false");
  });

  it("dice que no cuando el PR del mensaje ya no existe", async () => {
    const { output } = await run({
      HEAD_COMMIT_MESSAGE: "Recorta lo que gasta CI (#193)",
      PR_HEAD: "",
      GREEN_RUNS: "1",
    });

    expect(output).toContain("ya_verificado=false");
  });

  it("explica en la salida por qué se salta o no se salta la corrida", async () => {
    const { stdout, stderr } = await run({
      HEAD_COMMIT_MESSAGE: "Recorta lo que gasta CI (#193)",
      PR_HEAD: PR_HEAD_SHA,
      GREEN_RUNS: "1",
    });

    expect(`${stdout}${stderr}`.trim()).not.toBe("");
  });
});
