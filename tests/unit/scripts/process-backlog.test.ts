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
      await rm(workDir, { recursive: true, force: true });
      workDir = "";
    }
  });

  it("devuelve la etiqueta pending y mueve la tarjeta a Blocked", async () => {
    workDir = await setupWorkDir();
    await writeProjectConfig(workDir, FULL_STATUS_OPTIONS);
    const { binDir, logFile } = await installFakeGh(workDir);

    const { code } = await runBash(
      "source scripts/process-backlog.sh; N=5; ME=tester; cleanup",
      workDir,
      { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
    );

    expect(code).toBe(130);
    const log = await readLog(logFile);
    expect(log).toMatch(
      /issue edit 5 --add-label pending --remove-label in-progress/,
    );
    expect(log).toMatch(/issue edit 5 --remove-assignee @me/);
    expect(log).toMatch(/project item-edit --id ITEM123.*opt-blocked/);
  });

  it("termina bien aunque el tablero rechace el estado", async () => {
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
      { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
    );

    expect(code).toBe(130);
    const log = await readLog(logFile);
    expect(log).toMatch(
      /issue edit 5 --add-label pending --remove-label in-progress/,
    );
    expect(log).toMatch(/issue edit 5 --remove-assignee @me/);
  });

  it("no falla cuando no existe .plan/project.json", async () => {
    workDir = await setupWorkDir();
    const { binDir, logFile } = await installFakeGh(workDir);

    const { code } = await runBash(
      "source scripts/process-backlog.sh; N=5; ME=tester; cleanup",
      workDir,
      { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
    );

    expect(code).toBe(130);
    const log = await readLog(logFile);
    expect(log).toMatch(
      /issue edit 5 --add-label pending --remove-label in-progress/,
    );
  });
});

describe("reconcile_board", () => {
  let workDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
      workDir = "";
    }
  });

  it("ignora las tarjetas en Blocked con needs-human", async () => {
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
  });

  it("reencola una tarjeta que pasó de Blocked a Todo", async () => {
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
  });
});

describe("task-status", () => {
  let workDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
      workDir = "";
    }
  });

  it("falla con las opciones conocidas cuando el estado no existe", async () => {
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
      { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
    );

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/Unknown status 'Blocked'/);
    expect(stderr).toMatch(/Todo/);
    expect(stderr).toMatch(/In Progress/);
    expect(stderr).toMatch(/Done/);
  });
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

  it("aplica el mismo Blocked a todos los needs-human de Exceptional situations, no solo a uno", async () => {
    const claudeMd = await readFile(path.join(REPO_ROOT, "CLAUDE.md"), "utf8");
    const exceptionalSituations = claudeMd.slice(
      claudeMd.indexOf("## Exceptional situations"),
      claudeMd.indexOf("Board rules:"),
    );

    expect(exceptionalSituations).toMatch(
      /needs-human.*Blocked|Blocked.*needs-human/s,
    );
    expect(exceptionalSituations).toMatch(/Rebase conflict/);
    expect(exceptionalSituations).toMatch(/Flaky test/);
    expect(exceptionalSituations).toMatch(/Stop gate gave up/);
  });
});
