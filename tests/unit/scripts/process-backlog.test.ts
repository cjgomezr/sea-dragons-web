import {
  chmod,
  copyFile,
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
const PROCESS_BACKLOG_SCRIPT = path.join(
  REPO_ROOT,
  "scripts/process-backlog.sh",
);
const TASK_STATUS_SCRIPT = path.join(REPO_ROOT, "scripts/task-status.sh");

/**
 * Estos tests lanzan bash y git de verdad, no los imitan. Bajo `npm test`
 * completo compiten por CPU con el resto de los workers de Vitest (y en CI,
 * con antivirus/indexado de Windows), así que el timeout de 5 s pensado para
 * tests puros no alcanza: ver issue #50.
 */
const REAL_PROCESS_TEST_TIMEOUT_MS = 20_000;

/**
 * En Windows, `git.exe` puede tardar en soltar el handle del directorio de
 * trabajo después de que su proceso reporta `close`, y un `rm` inmediato
 * falla con `EBUSY: resource busy or locked`. `maxRetries`/`retryDelay` hacen
 * que `fs.rm` reintente en vez de tumbar el test por un problema de limpieza
 * ajeno a lo que el test verifica.
 */
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

function runBash(
  script: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", script], {
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
 * variables de entorno, para no tocar GitHub real. El patrón sigue el de
 * `tests/unit/scripts/file-incident.test.ts`.
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

if [ "$1" = "issue" ] && [ "$2" = "view" ]; then
  if [ -n "\${FAIL_ISSUE_VIEW_FOR:-}" ] && [ "$3" = "$FAIL_ISSUE_VIEW_FOR" ]; then
    echo "GraphQL: Could not resolve to an issue (issue #$3)" >&2
    exit 1
  fi
  if [ -n "\${ISSUE_VIEW_JSON:-}" ]; then
    echo "$ISSUE_VIEW_JSON"
  else
    echo '{"state":"OPEN","labels":[]}'
  fi
  exit 0
fi

if [ "$1" = "issue" ]; then
  exit 0
fi

if [ "$1" = "project" ] && [ "$2" = "item-list" ]; then
  if [ -n "\${ITEM_LIST_JSON:-}" ]; then
    echo "$ITEM_LIST_JSON"
  else
    echo '{"items": []}'
  fi
  exit 0
fi

if [ "$1" = "project" ] && [ "$2" = "item-add" ]; then
  echo '{"id": "ITEM123"}'
  exit 0
fi

if [ "$1" = "project" ] && [ "$2" = "item-edit" ]; then
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

/**
 * `jq` de mentira que reproduce el bug real: el binario de `jq` en Windows
 * termina líneas con CRLF. Solo afecta al filtro de `reconcile_board` (el
 * único que menciona `Todo`); todo lo demás se delega al `jq` real del PATH,
 * para no romper el resto del script.
 */
async function installFakeJq(binDir: string): Promise<void> {
  const jqPath = path.join(binDir, "jq");
  const script = `#!/usr/bin/env bash
stub_dir=$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)
real_jq=""
IFS=':' read -ra parts <<< "$PATH"
for p in "\${parts[@]}"; do
  [ "$p" = "$stub_dir" ] && continue
  if [ -x "$p/jq" ]; then real_jq="$p/jq"; break; fi
done
[ -n "$real_jq" ] || { echo "fake jq: no encontré el jq real en el PATH" >&2; exit 1; }

if printf '%s\\n' "$@" | grep -q 'status=="Todo"'; then
  "$real_jq" "$@" | sed 's/$/\\r/'
else
  exec "$real_jq" "$@"
fi
`;
  await writeFile(jqPath, script);
  await chmod(jqPath, 0o755);
}

async function setupWorkDir(): Promise<string> {
  const workDir = await mkdtemp(path.join(tmpdir(), "seadragons-backlog-"));
  await mkdir(path.join(workDir, "scripts"), { recursive: true });
  await copyFile(
    PROCESS_BACKLOG_SCRIPT,
    path.join(workDir, "scripts/process-backlog.sh"),
  );
  await copyFile(
    TASK_STATUS_SCRIPT,
    path.join(workDir, "scripts/task-status.sh"),
  );
  await runBash("git init -q", workDir, process.env);
  return workDir;
}

async function writeProjectConfig(
  workDir: string,
  statusOptions: Record<string, string>,
): Promise<void> {
  await mkdir(path.join(workDir, ".plan"), { recursive: true });
  await writeFile(
    path.join(workDir, ".plan/project.json"),
    JSON.stringify({
      owner: "acme",
      projectNumber: 5,
      projectId: "PVT_1",
      statusFieldId: "FIELD_1",
      statusOptions,
    }),
  );
}

const FULL_STATUS_OPTIONS = {
  Todo: "opt-todo",
  "In Progress": "opt-ip",
  Done: "opt-done",
  Blocked: "opt-blocked",
};

describe("cleanup de process-backlog", () => {
  let workDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, REMOVE_TEMP_DIR_OPTIONS);
      workDir = "";
    }
  });

  it(
    "devuelve la etiqueta pending y mueve la tarjeta a Blocked",
    async () => {
      workDir = await setupWorkDir();
      await writeProjectConfig(workDir, FULL_STATUS_OPTIONS);
      const { binDir, logFile } = await installFakeGh(workDir);

      const { code } = await runBash(
        "source scripts/process-backlog.sh; N=5; ME=tester; cleanup",
        workDir,
        {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        },
      );

      expect(code).toBe(130);
      const log = await readLog(logFile);
      expect(log).toMatch(
        /issue edit 5 --add-label pending --remove-label in-progress/,
      );
      expect(log).toMatch(/issue edit 5 --remove-assignee @me/);
      expect(log).toMatch(/project item-edit --id ITEM123.*opt-blocked/);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "termina bien aunque el tablero rechace el estado",
    async () => {
      workDir = await setupWorkDir();
      // Sin la opción Blocked: task-status.sh debe fallar, pero cleanup() no.
      await writeProjectConfig(workDir, {
        Todo: "opt-todo",
        "In Progress": "opt-ip",
        Done: "opt-done",
      });
      const { binDir, logFile } = await installFakeGh(workDir);

      const { code } = await runBash(
        "source scripts/process-backlog.sh; N=5; ME=tester; cleanup",
        workDir,
        {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        },
      );

      expect(code).toBe(130);
      const log = await readLog(logFile);
      expect(log).toMatch(
        /issue edit 5 --add-label pending --remove-label in-progress/,
      );
      expect(log).toMatch(/issue edit 5 --remove-assignee @me/);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "no falla cuando no existe .plan/project.json",
    async () => {
      workDir = await setupWorkDir();
      const { binDir, logFile } = await installFakeGh(workDir);

      const { code } = await runBash(
        "source scripts/process-backlog.sh; N=5; ME=tester; cleanup",
        workDir,
        {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        },
      );

      expect(code).toBe(130);
      const log = await readLog(logFile);
      expect(log).toMatch(
        /issue edit 5 --add-label pending --remove-label in-progress/,
      );
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );
});

describe("reconcile_board", () => {
  let workDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, REMOVE_TEMP_DIR_OPTIONS);
      workDir = "";
    }
  });

  it(
    "ignora las tarjetas en Blocked con needs-human",
    async () => {
      workDir = await setupWorkDir();
      await writeProjectConfig(workDir, FULL_STATUS_OPTIONS);
      const { binDir, logFile } = await installFakeGh(workDir);
      const itemListJson = JSON.stringify({
        items: [
          {
            status: "Blocked",
            content: { number: 22 },
          },
        ],
      });

      await runBash(
        "source scripts/process-backlog.sh; reconcile_board",
        workDir,
        {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          ITEM_LIST_JSON: itemListJson,
        },
      );

      const log = await readLog(logFile);
      expect(log).not.toMatch(/issue view 22/);
      expect(log).not.toMatch(/issue edit 22/);
      expect(log).not.toMatch(/issue reopen 22/);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "reencola una tarjeta que pasó de Blocked a Todo",
    async () => {
      workDir = await setupWorkDir();
      await writeProjectConfig(workDir, FULL_STATUS_OPTIONS);
      const { binDir, logFile } = await installFakeGh(workDir);
      const itemListJson = JSON.stringify({
        items: [
          {
            status: "Todo",
            content: { number: 22 },
          },
        ],
      });
      const issueViewJson = JSON.stringify({
        state: "OPEN",
        labels: [{ name: "needs-human" }],
      });

      await runBash(
        "source scripts/process-backlog.sh; reconcile_board",
        workDir,
        {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          ITEM_LIST_JSON: itemListJson,
          ISSUE_VIEW_JSON: issueViewJson,
        },
      );

      const log = await readLog(logFile);
      expect(log).toMatch(
        /issue edit 22 --add-label pending --remove-label needs-human --remove-label in-progress/,
      );
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "encola un issue abierto que no tiene etiqueta de cola",
    async () => {
      workDir = await setupWorkDir();
      await writeProjectConfig(workDir, FULL_STATUS_OPTIONS);
      const { binDir, logFile } = await installFakeGh(workDir);
      const itemListJson = JSON.stringify({
        items: [{ status: "Todo", content: { number: 31 } }],
      });
      const issueViewJson = JSON.stringify({ state: "OPEN", labels: [] });

      await runBash(
        "source scripts/process-backlog.sh; reconcile_board",
        workDir,
        {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          ITEM_LIST_JSON: itemListJson,
          ISSUE_VIEW_JSON: issueViewJson,
        },
      );

      const log = await readLog(logFile);
      expect(log).toMatch(/issue edit 31 --add-label pending/);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "reabre y encola un issue cerrado que está en Todo",
    async () => {
      workDir = await setupWorkDir();
      await writeProjectConfig(workDir, FULL_STATUS_OPTIONS);
      const { binDir, logFile } = await installFakeGh(workDir);
      const itemListJson = JSON.stringify({
        items: [{ status: "Todo", content: { number: 22 } }],
      });
      const issueViewJson = JSON.stringify({ state: "CLOSED", labels: [] });

      await runBash(
        "source scripts/process-backlog.sh; reconcile_board",
        workDir,
        {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          ITEM_LIST_JSON: itemListJson,
          ISSUE_VIEW_JSON: issueViewJson,
        },
      );

      const log = await readLog(logFile);
      expect(log).toMatch(/issue reopen 22/);
      expect(log).toMatch(
        /issue edit 22 --add-label pending --remove-label in-progress --remove-label needs-human/,
      );
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "ignora las tarjetas de epics",
    async () => {
      workDir = await setupWorkDir();
      await writeProjectConfig(workDir, FULL_STATUS_OPTIONS);
      const { binDir, logFile } = await installFakeGh(workDir);
      const itemListJson = JSON.stringify({
        items: [{ status: "Todo", content: { number: 7 } }],
      });
      const issueViewJson = JSON.stringify({
        state: "OPEN",
        labels: [{ name: "epic" }],
      });

      await runBash(
        "source scripts/process-backlog.sh; reconcile_board",
        workDir,
        {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          ITEM_LIST_JSON: itemListJson,
          ISSUE_VIEW_JSON: issueViewJson,
        },
      );

      const log = await readLog(logFile);
      expect(log).not.toMatch(/issue edit 7/);
      expect(log).not.toMatch(/issue reopen 7/);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "procesa todas las tarjetas cuando la entrada llega con CRLF",
    async () => {
      workDir = await setupWorkDir();
      await writeProjectConfig(workDir, FULL_STATUS_OPTIONS);
      const { binDir, logFile } = await installFakeGh(workDir);
      await installFakeJq(binDir);
      const itemListJson = JSON.stringify({
        items: [
          { status: "Todo", content: { number: 31 } },
          { status: "Todo", content: { number: 33 } },
        ],
      });
      const issueViewJson = JSON.stringify({ state: "OPEN", labels: [] });

      await runBash(
        "source scripts/process-backlog.sh; reconcile_board",
        workDir,
        {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          ITEM_LIST_JSON: itemListJson,
          ISSUE_VIEW_JSON: issueViewJson,
        },
      );

      const log = await readLog(logFile);
      // El bug real: con \r pegado, "31\r" no matchea y la tarjeta se salta en
      // silencio. Si las dos aparecen limpias, el CRLF no rompió el bucle.
      expect(log).toMatch(/issue edit 31 --add-label pending/);
      expect(log).toMatch(/issue edit 33 --add-label pending/);
      expect(log).not.toMatch(/issue view 31\r/);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "avisa por stderr cuando gh falla para un issue concreto",
    async () => {
      workDir = await setupWorkDir();
      await writeProjectConfig(workDir, FULL_STATUS_OPTIONS);
      const { binDir, logFile } = await installFakeGh(workDir);
      const itemListJson = JSON.stringify({
        items: [
          { status: "Todo", content: { number: 40 } },
          { status: "Todo", content: { number: 41 } },
        ],
      });
      const issueViewJson = JSON.stringify({ state: "OPEN", labels: [] });

      const { stderr } = await runBash(
        "source scripts/process-backlog.sh; reconcile_board",
        workDir,
        {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          ITEM_LIST_JSON: itemListJson,
          ISSUE_VIEW_JSON: issueViewJson,
          FAIL_ISSUE_VIEW_FOR: "40",
        },
      );

      expect(stderr).toMatch(/#40/);
      const log = await readLog(logFile);
      expect(log).toMatch(/issue edit 41 --add-label pending/);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );
});

describe("task-status", () => {
  let workDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, REMOVE_TEMP_DIR_OPTIONS);
      workDir = "";
    }
  });

  it(
    "falla con las opciones conocidas cuando el estado no existe",
    async () => {
      workDir = await setupWorkDir();
      await writeProjectConfig(workDir, {
        Todo: "opt-todo",
        "In Progress": "opt-ip",
        Done: "opt-done",
      });
      const { binDir } = await installFakeGh(workDir);

      const { code, stderr } = await runBash(
        "bash scripts/task-status.sh 5 Blocked",
        workDir,
        {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        },
      );

      expect(code).not.toBe(0);
      expect(stderr).toMatch(/Unknown status 'Blocked'/);
      expect(stderr).toMatch(/Todo/);
      expect(stderr).toMatch(/In Progress/);
      expect(stderr).toMatch(/Done/);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );
});

describe("CLAUDE.md", () => {
  it("documenta que el agente también escribe el estado Blocked", async () => {
    const claudeMd = await readFile(path.join(REPO_ROOT, "CLAUDE.md"), "utf8");
    const boardRules = claudeMd.slice(claudeMd.indexOf("Board rules:"));

    expect(boardRules).toMatch(/"Blocked"/);
    expect(boardRules).toMatch(/reconcile_board/);
  });

  it("instruye mover la tarjeta a Blocked al parar por un blocker", async () => {
    const claudeMd = await readFile(path.join(REPO_ROOT, "CLAUDE.md"), "utf8");
    const blockersStep = claudeMd.slice(
      claudeMd.indexOf("8. **Blockers.**"),
      claudeMd.indexOf("## Project skills"),
    );

    expect(blockersStep).toMatch(/task-status\.sh N Blocked/);
  });

  it("instruye mover a Blocked el propio ticket al volver a pending por blocked-by-N", async () => {
    const claudeMd = await readFile(path.join(REPO_ROOT, "CLAUDE.md"), "utf8");
    const mainIsBrokenBullet = claudeMd.slice(
      claudeMd.indexOf("**Main is broken"),
      claudeMd.indexOf("**Rebase conflict"),
    );

    expect(mainIsBrokenBullet).toMatch(/blocked-by-<that incident>/);
    expect(mainIsBrokenBullet).toMatch(/return.*to `pending`/s);
    expect(mainIsBrokenBullet).toMatch(/task-status\.sh N Blocked/);
  });

  it("aplica el mismo Blocked a todos los needs-human de Exceptional situations, no solo a uno", async () => {
    const claudeMd = await readFile(path.join(REPO_ROOT, "CLAUDE.md"), "utf8");
    const exceptionalSituations = claudeMd.slice(
      claudeMd.indexOf("## Exceptional situations"),
      claudeMd.indexOf("Board rules:"),
    );
    const blanketSentenceIndex = exceptionalSituations.indexOf(
      "carries the same board update as step 8",
    );

    expect(blanketSentenceIndex).toBeGreaterThan(-1);
    // La frase paraguas debe preceder a las viñetas que cubre: si alguien la
    // borra o la mueve después de "Rebase conflict", esas viñetas vuelven a
    // quedar con needs-human sin ligar a Blocked (el hallazgo original).
    expect(blanketSentenceIndex).toBeLessThan(
      exceptionalSituations.indexOf("Rebase conflict"),
    );
    expect(blanketSentenceIndex).toBeLessThan(
      exceptionalSituations.indexOf("Flaky test"),
    );
    expect(blanketSentenceIndex).toBeLessThan(
      exceptionalSituations.indexOf("Stop gate gave up"),
    );
    expect(blanketSentenceIndex).toBeLessThan(
      exceptionalSituations.indexOf("Integration tests without credentials"),
    );
  });
});
