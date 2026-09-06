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
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const CLEAR_BLOCKERS_SCRIPT = path.join(REPO_ROOT, "scripts/clear-blockers.sh");
const WORKFLOW_PATH = path.join(
  REPO_ROOT,
  ".github/workflows/labels-cleanup.yml",
);

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

function runClearBlockers(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [CLEAR_BLOCKERS_SCRIPT, ...args], {
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

/**
 * `gh` de mentira: registra cada invocación en un log y responde según
 * ISSUE_NUMBERS (lista separada por comas de los issues que "tienen" la
 * etiqueta buscada). Emite los números con \r\n a propósito: el --jq
 * interno de gh usa gojq y hoy emite LF, pero pipear a un jq externo sí
 * metía \r en Windows (#39). El script tolera ambos y este falso lo fija.
 *
 * FAIL_ISSUE hace que `issue edit` falle para ese número, para probar qué
 * pasa cuando un dependiente se cae y los demás no.
 */
async function installFakeGh(
  cwd: string,
): Promise<{ binDir: string; logFile: string }> {
  const binDir = path.join(cwd, "stub-bin");
  await mkdir(binDir, { recursive: true });
  const ghPath = path.join(binDir, "gh");
  const logFile = path.join(cwd, "gh-calls.log");
  const script = `#!/usr/bin/env bash
echo "$@" >> "${toBashPath(logFile)}"

if [ "$1" = "issue" ] && [ "$2" = "list" ]; then
  IFS=',' read -ra nums <<< "\${ISSUE_NUMBERS:-}"
  for n in "\${nums[@]}"; do
    [ -n "$n" ] && printf '%s\\r\\n' "$n"
  done
  exit 0
fi

if [ "$1" = "issue" ] && [ "$2" = "edit" ]; then
  if [ -n "\${FAIL_ISSUE:-}" ] && [ "$3" = "\${FAIL_ISSUE}" ]; then
    echo "gh: fallo al editar el issue $3" >&2
    exit 1
  fi
  exit 0
fi

exit 0
`;
  await writeFile(ghPath, script);
  await chmod(ghPath, 0o755);
  await writeFile(logFile, "");
  return { binDir, logFile };
}

async function readLog(logFile: string): Promise<string> {
  return readFile(logFile, "utf8");
}

describe("clear-blockers", () => {
  let workDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
      workDir = "";
    }
  });

  async function setupWorkDir(): Promise<{ binDir: string; logFile: string }> {
    workDir = await mkdtemp(path.join(tmpdir(), "seadragons-clear-blockers-"));
    return installFakeGh(workDir);
  }

  it("quita blocked-by-N de todos los issues abiertos que la tengan", async () => {
    const { binDir, logFile } = await setupWorkDir();

    const { code } = await runClearBlockers(["17"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      ISSUE_NUMBERS: "22,23",
    });

    expect(code).toBe(0);
    const log = await readLog(logFile);
    expect(log).toMatch(/issue list --label blocked-by-17 --state open/);
    expect(log).toMatch(/issue edit 22 --remove-label blocked-by-17/);
    expect(log).toMatch(/issue edit 23 --remove-label blocked-by-17/);
  });

  it("conserva las demás etiquetas de bloqueo del mismo issue", async () => {
    const { binDir, logFile } = await setupWorkDir();

    await runClearBlockers(["17"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      ISSUE_NUMBERS: "22",
    });

    const log = await readLog(logFile);
    const editLine = log
      .split("\n")
      .find((line) => line.startsWith("issue edit 22"));
    expect(editLine).toBe("issue edit 22 --remove-label blocked-by-17");
  });

  it("sale 0 cuando ningún issue la tiene", async () => {
    const { binDir, logFile } = await setupWorkDir();

    const { code } = await runClearBlockers(["17"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      ISSUE_NUMBERS: "",
    });

    expect(code).toBe(0);
    const log = await readLog(logFile);
    expect(log).not.toMatch(/issue edit/);
  });

  it("sale distinto de 0 y no toca nada si falta el argumento", async () => {
    const { binDir, logFile } = await setupWorkDir();

    const { code, stderr } = await runClearBlockers([], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      ISSUE_NUMBERS: "22",
    });

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/usage/i);
    const log = await readLog(logFile);
    expect(log).toBe("");
  });

  it("imprime los issues que modificó", async () => {
    const { binDir } = await setupWorkDir();

    const { stdout } = await runClearBlockers(["17"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      ISSUE_NUMBERS: "22,23",
    });

    expect(stdout).toMatch(/#22/);
    expect(stdout).toMatch(/#23/);
  });

  it("limpia los dependientes que puede aunque uno de ellos falle", async () => {
    const { binDir, logFile } = await setupWorkDir();

    const { code, stderr } = await runClearBlockers(["17"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      ISSUE_NUMBERS: "22,23,24",
      FAIL_ISSUE: "23",
    });

    const log = await readLog(logFile);
    expect(log).toMatch(/issue edit 22 --remove-label blocked-by-17/);
    expect(log).toMatch(/issue edit 24 --remove-label blocked-by-17/);
    expect(stderr).toContain("#23");
    expect(code).not.toBe(0);
  });

  it("pide todos los dependientes, no solo la primera página", async () => {
    const { binDir, logFile } = await setupWorkDir();

    await runClearBlockers(["17"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      ISSUE_NUMBERS: "22",
    });

    const log = await readLog(logFile);
    const listLine = log
      .split("\n")
      .find((line) => line.startsWith("issue list"));
    expect(listLine).toMatch(/--limit \d+/);
  });
});

describe("labels-cleanup.yml", () => {
  function readWorkflowSource(): string {
    return readFileSync(WORKFLOW_PATH, "utf8");
  }

  it("llama a clear-blockers.sh con el número del issue que cerró", () => {
    const source = readWorkflowSource();

    expect(source).toMatch(/scripts\/clear-blockers\.sh/);
    expect(source).toMatch(
      /clear-blockers\.sh"?\s+\$\{\{\s*github\.event\.issue\.number\s*\}\}/,
    );
  });
});
