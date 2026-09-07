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
const FILE_INCIDENT_SCRIPT = path.join(REPO_ROOT, "scripts/file-incident.sh");

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

function runFileIncident(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [FILE_INCIDENT_SCRIPT, ...args], {
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
 * `tests/unit/hooks/stop-gate.test.ts`.
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
  [ "\${EPIC_EXISTS:-1}" = "1" ] && exit 0 || exit 1
fi

if [ "$1" = "issue" ] && [ "$2" = "create" ]; then
  echo "https://github.com/acme/repo/issues/\${CREATED_ISSUE_NUMBER:-42}"
  exit 0
fi

if [ "$1" = "api" ]; then
  for arg in "$@"; do
    case "$arg" in
      *sub_issues*) exit 0 ;;
    esac
  done
  echo "\${DB_ID:-9001}"
  exit 0
fi

if [ "$1" = "project" ] && [ "$2" = "item-list" ]; then
  echo '{"items": []}'
  exit 0
fi

if [ "$1" = "project" ] && [ "$2" = "item-add" ]; then
  echo '{"id": "ITEM123"}'
  exit 0
fi

if [ "$1" = "project" ] && [ "$2" = "item-edit" ]; then
  [ "\${PROJECT_UPDATE_FAILS:-0}" = "1" ] && exit 1
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

describe("file-incident", () => {
  let workDir = "";
  let bodyFile = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
      workDir = "";
    }
    bodyFile = "";
  });

  async function setupWorkDir(
    withBoard: boolean,
  ): Promise<{ binDir: string; logFile: string }> {
    workDir = await mkdtemp(path.join(tmpdir(), "seadragons-incident-"));
    bodyFile = path.join(workDir, "body.md");
    await writeFile(bodyFile, "## Contexto\n\nMain se rompió.\n");
    if (withBoard) {
      await mkdir(path.join(workDir, ".plan"), { recursive: true });
      await writeFile(
        path.join(workDir, ".plan", "project.json"),
        JSON.stringify({
          owner: "acme",
          projectNumber: 5,
          projectId: "PVT_1",
          statusFieldId: "FIELD_1",
          statusOptions: { Todo: "opt-todo", "In Progress": "opt-ip" },
        }),
      );
    }
    return installFakeGh(workDir);
  }

  it("crea el issue con pending y priority:high", async () => {
    const { binDir, logFile } = await setupWorkDir(false);

    const { code, stdout } = await runFileIncident(
      ["12", "main roto por #22", bodyFile],
      workDir,
      { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
    );

    expect(code).toBe(0);
    expect(stdout.trim()).toBe("42");
    const log = await readLog(logFile);
    expect(log).toMatch(/issue create/);
    expect(log).toMatch(/--label pending/);
    expect(log).toMatch(/--label priority:high/);
  });

  it("lo enlaza como sub-issue de la épica indicada", async () => {
    const { binDir, logFile } = await setupWorkDir(false);

    await runFileIncident(["12", "main roto por #22", bodyFile], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    const log = await readLog(logFile);
    expect(log).toMatch(/repos\/acme\/repo\/issues\/12\/sub_issues/);
    expect(log).toMatch(/sub_issue_id=9001/);
  });

  it("lo agrega al tablero en Todo cuando hay project.json", async () => {
    const { binDir, logFile } = await setupWorkDir(true);

    await runFileIncident(["12", "main roto por #22", bodyFile], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    const log = await readLog(logFile);
    expect(log).toMatch(/project item-edit/);
    expect(log).toMatch(/opt-todo/);
  });

  it("no falla ni menciona el tablero cuando no hay project.json", async () => {
    const { binDir, logFile } = await setupWorkDir(false);

    const { code, stdout } = await runFileIncident(
      ["12", "main roto por #22", bodyFile],
      workDir,
      { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
    );

    expect(code).toBe(0);
    expect(stdout.trim()).toBe("42");
    const log = await readLog(logFile);
    expect(log).not.toMatch(/project/);
  });

  it("imprime solo el número del issue en stdout", async () => {
    const { binDir } = await setupWorkDir(true);

    const { stdout } = await runFileIncident(
      ["12", "main roto por #22", bodyFile],
      workDir,
      {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      },
    );

    expect(stdout).toBe("42\n");
  });

  it("sale distinto de 0 y no crea nada si falta un argumento", async () => {
    const { binDir, logFile } = await setupWorkDir(false);

    const { code, stderr } = await runFileIncident(
      ["12", "main roto por #22"],
      workDir,
      {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      },
    );

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/usage/i);
    const log = await readLog(logFile);
    expect(log).toBe("");
  });

  it("igual crea e imprime el issue si el tablero falla (token sin permiso project)", async () => {
    const { binDir } = await setupWorkDir(true);

    const { code, stdout, stderr } = await runFileIncident(
      ["12", "main roto por #22", bodyFile],
      workDir,
      {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        PROJECT_UPDATE_FAILS: "1",
      },
    );

    expect(code).toBe(0);
    expect(stdout.trim()).toBe("42");
    expect(stderr).toMatch(/no pude actualizar el tablero/);
  });

  it("sale distinto de 0 y no crea nada si la épica no existe", async () => {
    const { binDir, logFile } = await setupWorkDir(false);

    const { code, stderr } = await runFileIncident(
      ["999", "main roto por #22", bodyFile],
      workDir,
      {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        EPIC_EXISTS: "0",
      },
    );

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/épica/i);
    const log = await readLog(logFile);
    expect(log).not.toMatch(/issue create/);
  });
});

describe("CLAUDE.md", () => {
  it("manda usar file-incident.sh y escribir el cuerpo con write-ticket", async () => {
    const claudeMd = await readFile(path.join(REPO_ROOT, "CLAUDE.md"), "utf8");

    expect(claudeMd).toMatch(/scripts\/file-incident\.sh/);
    expect(claudeMd).toMatch(/write-ticket/);
  });

  it("aclara que la épica del incidente es la del código roto, no la del ticket que lo descubrió", async () => {
    const claudeMd = await readFile(path.join(REPO_ROOT, "CLAUDE.md"), "utf8");
    const exceptionalSituations = claudeMd.slice(
      claudeMd.indexOf("## Exceptional situations"),
    );
    const mainIsBrokenBullet = exceptionalSituations.slice(
      exceptionalSituations.indexOf("**Main is broken"),
      exceptionalSituations.indexOf("**Rebase conflict"),
    );

    expect(mainIsBrokenBullet).toMatch(/code that broke/);
    expect(mainIsBrokenBullet).not.toMatch(/return it to `pending`/);
  });
});
