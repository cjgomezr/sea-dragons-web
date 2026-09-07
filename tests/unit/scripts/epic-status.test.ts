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
const SYNC_SCRIPT = path.join(REPO_ROOT, "scripts/sync-epic-status.sh");
const RECONCILE_ONE_SCRIPT = path.join(REPO_ROOT, "scripts/reconcile-epic.sh");
const RECONCILE_ALL_SCRIPT = path.join(
  REPO_ROOT,
  "scripts/reconcile-all-epics.sh",
);

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

function run(
  scriptPath: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [scriptPath, ...args], {
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
 * `gh` de mentira: registra cada invocación en un log y responde según las
 * variables de entorno.
 *
 * - `PARENT_NUMBER`: lo que devuelve `issue(number).parent.number` en la
 *   consulta de `sync-epic-status.sh`. Vacío significa "sin épica padre".
 * - `EPIC_STATE` / `EPIC_TOTAL` / `EPIC_COMPLETED`: lo que devuelve
 *   `issue(number).state` y `subIssuesSummary` para la épica consultada.
 * - `EPIC_NUMBERS`: lista separada por comas que devuelve
 *   `issue list --label epic` para la barrida completa.
 * - `FAIL_GRAPHQL=1` hace fallar toda llamada a `gh api graphql`.
 * - `FAIL_EPIC=N` hace fallar la consulta graphql cuando el número
 *   consultado es N (para probar que una barrida no cancela a las demás).
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

if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  echo "acme/repo"
  exit 0
fi

if [ "$1" = "issue" ] && [ "$2" = "list" ]; then
  IFS=',' read -ra nums <<< "\${EPIC_NUMBERS:-}"
  for n in "\${nums[@]}"; do
    [ -n "$n" ] && printf '%s\\r\\n' "$n"
  done
  exit 0
fi

if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then
  [ "\${FAIL_GRAPHQL:-0}" = "1" ] && exit 1

  query="$*"
  case "$query" in
    *subIssuesSummary*)
      number="\${QUERIED_NUMBER:-}"
      for arg in "$@"; do
        case "$arg" in
          number=*) number="\${arg#number=}" ;;
        esac
      done
      if [ -n "\${FAIL_EPIC:-}" ] && [ "$number" = "\${FAIL_EPIC}" ]; then
        exit 1
      fi
      printf '{"data":{"repository":{"issue":{"state":"%s","subIssuesSummary":{"total":%s,"completed":%s}}}}}' \\
        "\${EPIC_STATE:-OPEN}" "\${EPIC_TOTAL:-0}" "\${EPIC_COMPLETED:-0}"
      exit 0
      ;;
    *parent*)
      if [ -n "\${PARENT_NUMBER:-}" ]; then
        printf '{"data":{"repository":{"issue":{"parent":{"number":%s}}}}}' "\${PARENT_NUMBER}"
      else
        printf '{"data":{"repository":{"issue":{"parent":null}}}}'
      fi
      exit 0
      ;;
  esac
  exit 0
fi

if [ "$1" = "issue" ] && [ "$2" = "close" ]; then
  exit 0
fi

if [ "$1" = "issue" ] && [ "$2" = "reopen" ]; then
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

describe("cierre de épicas", () => {
  let workDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
      workDir = "";
    }
  });

  async function setupWorkDir(): Promise<{ binDir: string; logFile: string }> {
    workDir = await mkdtemp(path.join(tmpdir(), "seadragons-epic-status-"));
    return installFakeGh(workDir);
  }

  it("último sub-issue cerrado: cierra la épica y comenta una sola vez", async () => {
    const { binDir, logFile } = await setupWorkDir();

    const { code } = await run(SYNC_SCRIPT, ["53"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      PARENT_NUMBER: "1",
      EPIC_STATE: "OPEN",
      EPIC_TOTAL: "9",
      EPIC_COMPLETED: "9",
    });

    expect(code).toBe(0);
    const log = await readLog(logFile);
    const closeLines = log
      .split("\n")
      .filter((line) => line.startsWith("issue close 1 "));
    expect(closeLines).toHaveLength(1);
    expect(closeLines[0]).toMatch(/--comment/);
  });

  it("quedan sub-issues abiertos: no toca la épica", async () => {
    const { binDir, logFile } = await setupWorkDir();

    await run(SYNC_SCRIPT, ["53"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      PARENT_NUMBER: "1",
      EPIC_STATE: "OPEN",
      EPIC_TOTAL: "9",
      EPIC_COMPLETED: "8",
    });

    const log = await readLog(logFile);
    expect(log).not.toMatch(/issue close/);
    expect(log).not.toMatch(/issue reopen/);
  });

  it("issue sin épica padre: termina en verde sin hacer nada", async () => {
    const { binDir, logFile } = await setupWorkDir();

    const { code } = await run(SYNC_SCRIPT, ["53"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      PARENT_NUMBER: "",
    });

    expect(code).toBe(0);
    const log = await readLog(logFile);
    expect(log).not.toMatch(/issue close/);
    expect(log).not.toMatch(/issue reopen/);
  });

  it("sub-issue reabierto con la épica cerrada: reabre la épica", async () => {
    const { binDir, logFile } = await setupWorkDir();

    const { code } = await run(SYNC_SCRIPT, ["53"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      PARENT_NUMBER: "1",
      EPIC_STATE: "CLOSED",
      EPIC_TOTAL: "10",
      EPIC_COMPLETED: "9",
    });

    expect(code).toBe(0);
    const log = await readLog(logFile);
    expect(log).toMatch(/issue reopen 1/);
    expect(log).not.toMatch(/issue close/);
  });

  it("sub-issue reabierto con la épica ya abierta: no hace nada", async () => {
    const { binDir, logFile } = await setupWorkDir();

    await run(SYNC_SCRIPT, ["53"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      PARENT_NUMBER: "1",
      EPIC_STATE: "OPEN",
      EPIC_TOTAL: "10",
      EPIC_COMPLETED: "9",
    });

    const log = await readLog(logFile);
    expect(log).not.toMatch(/issue close/);
    expect(log).not.toMatch(/issue reopen/);
  });

  it("la consulta a gh falla: no cierra ni reabre nada", async () => {
    const { binDir, logFile } = await setupWorkDir();

    const { code } = await run(SYNC_SCRIPT, ["53"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      PARENT_NUMBER: "1",
      FAIL_GRAPHQL: "1",
    });

    expect(code).not.toBe(0);
    const log = await readLog(logFile);
    expect(log).not.toMatch(/issue close/);
    expect(log).not.toMatch(/issue reopen/);
  });

  it("reconcile-epic.sh reconcilia directamente una épica dada por número", async () => {
    const { binDir, logFile } = await setupWorkDir();

    const { code } = await run(RECONCILE_ONE_SCRIPT, ["1"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      EPIC_STATE: "CLOSED",
      EPIC_TOTAL: "3",
      EPIC_COMPLETED: "2",
    });

    expect(code).toBe(0);
    const log = await readLog(logFile);
    expect(log).toMatch(/issue reopen 1/);
  });

  describe("reconciliación periódica", () => {
    it("con todo cuadrado no escribe nada", async () => {
      const { binDir, logFile } = await setupWorkDir();

      const { code } = await run(RECONCILE_ALL_SCRIPT, [], workDir, {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        EPIC_NUMBERS: "1,32",
        EPIC_STATE: "OPEN",
        EPIC_TOTAL: "5",
        EPIC_COMPLETED: "3",
      });

      expect(code).toBe(0);
      const log = await readLog(logFile);
      expect(log).not.toMatch(/issue close/);
      expect(log).not.toMatch(/issue reopen/);
    });

    it("detecta un enganche manual y reabre la épica cerrada que corresponde", async () => {
      const { binDir, logFile } = await setupWorkDir();

      const { code } = await run(RECONCILE_ALL_SCRIPT, [], workDir, {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        EPIC_NUMBERS: "1",
        EPIC_STATE: "CLOSED",
        EPIC_TOTAL: "10",
        EPIC_COMPLETED: "9",
      });

      expect(code).toBe(0);
      const log = await readLog(logFile);
      expect(log).toMatch(/issue reopen 1/);
    });

    it("una épica sin sub-issues no se toca (guard contra épicas vacías)", async () => {
      const { binDir, logFile } = await setupWorkDir();

      const { code } = await run(RECONCILE_ALL_SCRIPT, [], workDir, {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        EPIC_NUMBERS: "7",
        EPIC_STATE: "OPEN",
        EPIC_TOTAL: "0",
        EPIC_COMPLETED: "0",
      });

      expect(code).toBe(0);
      const log = await readLog(logFile);
      expect(log).not.toMatch(/issue close/);
      expect(log).not.toMatch(/issue reopen/);
    });

    it("sigue con las demás épicas si una falla al consultar", async () => {
      const { binDir, logFile } = await setupWorkDir();

      const { code, stderr } = await run(RECONCILE_ALL_SCRIPT, [], workDir, {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        EPIC_NUMBERS: "1,32",
        FAIL_EPIC: "1",
        EPIC_STATE: "CLOSED",
        EPIC_TOTAL: "4",
        EPIC_COMPLETED: "3",
      });

      const log = await readLog(logFile);
      expect(log).toMatch(/issue reopen 32/);
      expect(stderr).toContain("#1");
      expect(code).not.toBe(0);
    });
  });
});
