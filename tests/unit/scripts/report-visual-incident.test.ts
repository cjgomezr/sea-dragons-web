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
const SCRIPT = path.join(REPO_ROOT, "scripts/report-visual-incident.sh");
/**
 * La épica que este proyecto usa por defecto. Los tests que la mencionan
 * comprueban el MECANISMO, no el número: el que decide de qué épica cuelga el
 * incidente es `FACTORY_EPIC`, y en la plantilla ni siquiera hay un valor por
 * defecto hasta que el bootstrap lo rellena (issue #122).
 */
const DEFAULT_EPIC_OF_THIS_PROJECT = 32;
const ANOTHER_EPIC = 777;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

function runScript(
  cwd: string,
  env: NodeJS.ProcessEnv,
  extraFiles: readonly string[] = [],
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [toBashPath(SCRIPT), ...extraFiles], {
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
 * `gh` de mentira: registra cada invocación y responde según variables de
 * entorno, siguiendo el mismo patrón que `tests/unit/scripts/file-incident.test.ts`.
 * `EXISTING_INCIDENT_COUNT` controla cuántos incidentes abiertos encuentra la
 * búsqueda por título. `ISSUE_LIST_FAILS` simula que la búsqueda misma falla.
 */
async function installFakeGh(
  workDir: string,
): Promise<{ binDir: string; logFile: string }> {
  const binDir = path.join(workDir, "stub-bin");
  await mkdir(binDir, { recursive: true });
  const ghPath = path.join(binDir, "gh");
  const logFile = path.join(workDir, "gh-calls.log");
  const script = `#!/usr/bin/env bash
echo "$@" >> "${toBashPath(logFile)}"

if [ "$1" = "issue" ] && [ "$2" = "list" ]; then
  [ "\${ISSUE_LIST_FAILS:-0}" = "1" ] && exit 1
  echo "\${EXISTING_INCIDENT_COUNT:-0}"
  exit 0
fi

if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  echo "acme/repo"
  exit 0
fi

if [ "$1" = "issue" ] && [ "$2" = "view" ]; then
  exit 0
fi

if [ "$1" = "issue" ] && [ "$2" = "create" ]; then
  echo "https://github.com/acme/repo/issues/\${CREATED_ISSUE_NUMBER:-42}"
  exit 0
fi

if [ "$1" = "api" ]; then
  echo "\${DB_ID:-9001}"
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

describe("report-visual-incident", () => {
  let workDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
      workDir = "";
    }
  });

  async function setup(
    env: Record<string, string> = {},
  ): Promise<{ binDir: string; logFile: string; env: NodeJS.ProcessEnv }> {
    workDir = await mkdtemp(path.join(tmpdir(), "seadragons-visual-incident-"));
    const { binDir, logFile } = await installFakeGh(workDir);
    return {
      binDir,
      logFile,
      env: {
        ...process.env,
        ...env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      },
    };
  }

  it("abre un incidente cuando no hay uno abierto para la misma causa", async () => {
    const { logFile, env } = await setup({ EXISTING_INCIDENT_COUNT: "0" });

    const { code, stdout } = await runScript(workDir, env);

    expect(code).toBe(0);
    expect(stdout.trim()).toBe("42");
    const log = await readLog(logFile);
    expect(log).toMatch(/issue list/);
    expect(log).toMatch(/issue create/);
    expect(log).toMatch(
      new RegExp(`issues/${DEFAULT_EPIC_OF_THIS_PROJECT}/sub_issues`),
    );
  });

  it("cuelga el incidente de la épica que diga FACTORY_EPIC", async () => {
    // El número no puede vivir quemado en el script: cada proyecto tiene la
    // suya, y la plantilla no tiene ninguna hasta que el bootstrap la crea.
    const { logFile, env } = await setup({
      EXISTING_INCIDENT_COUNT: "0",
      FACTORY_EPIC: String(ANOTHER_EPIC),
    });

    const { code } = await runScript(workDir, env);

    expect(code).toBe(0);
    const log = await readLog(logFile);
    expect(log).toMatch(new RegExp(`issues/${ANOTHER_EPIC}/sub_issues`));
    expect(log).not.toMatch(
      new RegExp(`issues/${DEFAULT_EPIC_OF_THIS_PROJECT}/sub_issues`),
    );
  });

  it("falla diciéndolo si nadie ha rellenado la épica", async () => {
    // Es el caso de la plantilla recién clonada. Colgar el incidente de un
    // issue ajeno sería peor que no abrirlo: nadie lo encontraría, y de paso
    // ensuciaría un issue que no tiene nada que ver.
    const { logFile, env } = await setup({
      EXISTING_INCIDENT_COUNT: "0",
      FACTORY_EPIC: "{{FACTORY_EPIC}}",
    });

    const { code, stderr } = await runScript(workDir, env);

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/FACTORY_EPIC/);
    const log = await readLog(logFile);
    expect(log).not.toMatch(/issue create/);
  });

  it("no abre un segundo incidente cuando ya hay uno abierto para la misma causa", async () => {
    const { logFile, env } = await setup({ EXISTING_INCIDENT_COUNT: "1" });

    const { code } = await runScript(workDir, env);

    expect(code).toBe(0);
    const log = await readLog(logFile);
    expect(log).toMatch(/issue list/);
    expect(log).not.toMatch(/issue create/);
  });

  it("no crea nada si la búsqueda de duplicados falla, del lado seguro", async () => {
    const { logFile, env } = await setup({ ISSUE_LIST_FAILS: "1" });

    const { code } = await runScript(workDir, env);

    expect(code).toBe(0);
    const log = await readLog(logFile);
    expect(log).not.toMatch(/issue create/);
  });

  it("usa scripts/file-incident.sh, no gh issue create a pelo", async () => {
    const source = await readFile(SCRIPT, "utf8");

    expect(source).toMatch(/file-incident\.sh/);
  });
});
