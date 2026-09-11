import { mkdir, mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/check-worker-claimed.sh");

/** Lanza bash de verdad, así que compite por CPU con el resto de la suite.
 * Mismo motivo y mismo número que `process-backlog.test.ts` (issue #50). */
const REAL_PROCESS_TEST_TIMEOUT_MS = 20_000;

const REMOVE_TEMP_DIR_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 200,
} as const;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

function runScript(
  issueNumber: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [toBashPath(SCRIPT), issueNumber], {
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

/** `gh` de mentira, con el mismo patrón que los demás tests de scripts: responde
 * según variables de entorno y nunca toca GitHub. */
async function installFakeGh(cwd: string): Promise<string> {
  const binDir = path.join(cwd, "stub-bin");
  await mkdir(binDir, { recursive: true });
  const ghPath = path.join(binDir, "gh");
  const script = `#!/usr/bin/env bash
if [ "$1" = "issue" ] && [ "$2" = "view" ]; then
  if [ -n "\${FAIL_ISSUE_VIEW:-}" ]; then
    echo "gh: API rate limit exceeded" >&2
    exit 1
  fi
  echo "\${ISSUE_VIEW_JSON:-{\\"state\\":\\"OPEN\\",\\"labels\\":[]}}"
  exit 0
fi

if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  if [ -n "\${FAIL_PR_LIST:-}" ]; then
    echo "gh: API rate limit exceeded" >&2
    exit 1
  fi
  echo "\${PR_LIST_COUNT:-0}"
  exit 0
fi

exit 0
`;
  await writeFile(ghPath, script, { mode: 0o755 });
  await chmod(ghPath, 0o755);
  return binDir;
}

function issueJson(state: string, labels: string[]): string {
  return JSON.stringify({
    state,
    labels: labels.map((name) => ({ name })),
  });
}

describe("scripts/check-worker-claimed.sh", () => {
  let workDir: string;

  afterEach(async () => {
    if (workDir) await rm(workDir, REMOVE_TEMP_DIR_OPTIONS);
  });

  async function run(
    overrides: Record<string, string>,
    issueNumber = "140",
  ): Promise<RunResult> {
    workDir = await mkdtemp(path.join(tmpdir(), "claimed-"));
    const binDir = await installFakeGh(workDir);
    return runScript(issueNumber, workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      GITHUB_REPOSITORY: "acme/repo",
      ...overrides,
    });
  }

  it(
    "falla cuando el issue sigue abierto, sin etiquetas de trabajo y sin PR",
    async () => {
      const result = await run({ ISSUE_VIEW_JSON: issueJson("OPEN", []) });

      expect(result.code).toBe(1);
      expect(result.stdout).toContain("salió sin tocar el issue");
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "pasa cuando el issue quedó cerrado, que es el final por idempotencia",
    async () => {
      // El caso que un guardia basado en la etiqueta `pending` marcaría en
      // rojo: quien la quita es labels-cleanup.yml, otro workflow que tarda.
      const result = await run({
        ISSUE_VIEW_JSON: issueJson("CLOSED", ["pending"]),
      });

      expect(result.code).toBe(0);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it.each([["in-progress"], ["needs-human"], ["blocked-by-77"]])(
    "pasa cuando el issue lleva '%s', que es rastro de un final legítimo",
    async (label) => {
      const result = await run({
        ISSUE_VIEW_JSON: issueJson("OPEN", ["pending", label]),
      });

      expect(result.code).toBe(0);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "pasa cuando existe un PR que declara cerrar el issue",
    async () => {
      const result = await run({
        ISSUE_VIEW_JSON: issueJson("OPEN", []),
        PR_LIST_COUNT: "1",
      });

      expect(result.code).toBe(0);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "no culpa al worker cuando gh no responde al consultar el issue",
    async () => {
      const result = await run({ FAIL_ISSUE_VIEW: "1" });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("No pude comprobar");
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "no culpa al worker cuando gh no responde al buscar PRs",
    async () => {
      const result = await run({
        ISSUE_VIEW_JSON: issueJson("OPEN", []),
        FAIL_PR_LIST: "1",
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("No pude buscar PRs");
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "pide el número del issue en vez de adivinarlo",
    async () => {
      const result = await run({}, "");

      expect(result.code).toBe(2);
      expect(result.stderr).toContain("uso:");
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );
});
