import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const STOP_GATE_SCRIPT = path.join(REPO_ROOT, ".claude/hooks/stop-gate.sh");

/** Lanzan bash y git de verdad: el plazo de los tests en memoria no alcanza
 * bajo `npm test` completo (#50). */
const REAL_PROCESS_TEST_TIMEOUT_MS = 30_000;

/** Windows tarda en soltar los handles de git tras cerrar (ver stop-gate.test). */
const REMOVE_TEMP_DIR_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 200,
} as const;

type ProcessResult = {
  readonly code: number | null;
  readonly output: string;
};

function runProcess(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk: Buffer): void => {
      output += chunk.toString();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

/**
 * Un repo con `origin/main` de verdad, que ya tiene configuración de
 * Playwright y de tests, y una rama `impl` con un commit que toca `file`.
 */
async function createBranchTouching(
  file: string,
): Promise<{ readonly workDir: string; readonly originDir: string }> {
  const originDir = await mkdtemp(path.join(tmpdir(), "seadragons-origin-"));
  const workDir = await mkdtemp(path.join(tmpdir(), "seadragons-work-"));
  const script = `
    set -e
    git init --bare -q "${toBashPath(originDir)}"
    git clone -q "${toBashPath(originDir)}" .
    git config user.email test@example.com
    git config user.name Test
    echo '{"name": "fixture", "scripts": {"test": "true"}}' > package.json
    echo 'export default {};' > playwright.config.ts
    git add -A
    git commit -q -m baseline
    git push -q -u origin HEAD:main
    git checkout -q -b impl
    mkdir -p "$(dirname "$1")"
    echo 'cambio' > "$1"
    git add -A
    git commit -q -m cambio
  `;
  const { code, output } = await runProcess("bash", ["-c", script, "_", file], {
    cwd: workDir,
  });
  if (code !== 0) {
    throw new Error(`No se pudo preparar el repo de prueba: ${output}`);
  }
  return { workDir, originDir };
}

/** `npm`/`npx` de mentira que apuntan con qué los llamaron y siempre pasan. */
async function installCommandRecorder(): Promise<{
  readonly binDir: string;
  readonly logFile: string;
}> {
  const binDir = await mkdtemp(path.join(tmpdir(), "seadragons-npx-log-"));
  const logFile = path.join(binDir, "calls");
  for (const name of ["npm", "npx"]) {
    const binPath = path.join(binDir, name);
    await writeFile(
      binPath,
      [
        "#!/usr/bin/env bash",
        `echo "${name} $* [RUN_INTEGRATION_TESTS=\${RUN_INTEGRATION_TESTS:-}]" >> "${toBashPath(logFile)}"`,
        "exit 0",
        "",
      ].join("\n"),
    );
    await chmod(binPath, 0o755);
  }
  return { binDir, logFile };
}

async function recordedCalls(logFile: string): Promise<string> {
  try {
    return await readFile(logFile, "utf8");
  } catch {
    return "";
  }
}

describe("el Stop gate y Playwright", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, REMOVE_TEMP_DIR_OPTIONS);
    }
  });

  async function runGateOnBranchTouching(
    file: string,
  ): Promise<{ readonly calls: string; readonly output: string }> {
    const { workDir, originDir } = await createBranchTouching(file);
    const { binDir, logFile } = await installCommandRecorder();
    tempDirs.push(workDir, originDir, binDir);

    const { code, output } = await runProcess("bash", [STOP_GATE_SCRIPT], {
      cwd: workDir,
      env: {
        ...process.env,
        FACTORY_GATE: undefined,
        // CI corre esta suite con la variable puesta: sin quitarla, el test
        // no sabría si la puso el gate o venía de fuera.
        RUN_INTEGRATION_TESTS: undefined,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      },
    });

    expect(code).toBe(0);
    return { calls: await recordedCalls(logFile), output };
  }

  it(
    "no corre Playwright cuando la rama sólo toca docs/",
    async () => {
      const { calls } = await runGateOnBranchTouching("docs/nota.md");

      expect(calls).not.toContain("playwright test");
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "no corre Playwright cuando la rama sólo toca supabase/migrations/",
    async () => {
      const { calls } = await runGateOnBranchTouching(
        "supabase/migrations/0099_algo.sql",
      );

      expect(calls).not.toContain("playwright test");
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "dice en una línea que no corrió Playwright y por qué",
    async () => {
      const { output } = await runGateOnBranchTouching("docs/nota.md");

      expect(output).toMatch(/Playwright[^\n]*no corre/);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "corre Playwright cuando la rama toca src/",
    async () => {
      const { calls } = await runGateOnBranchTouching("src/app/page.tsx");

      expect(calls).toContain("playwright test");
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "corre Playwright cuando la rama toca el arranque de sesión de tests/support/",
    async () => {
      const { calls } = await runGateOnBranchTouching(
        "tests/support/e2e-session.ts",
      );

      expect(calls).toContain("playwright test");
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "no corre Playwright cuando la rama sólo toca un test unitario",
    async () => {
      const { calls } = await runGateOnBranchTouching(
        "tests/unit/algo.test.ts",
      );

      expect(calls).not.toContain("playwright test");
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "corre Playwright cuando la rama toca un spec dentro de una carpeta",
    async () => {
      const { calls } = await runGateOnBranchTouching(
        "tests/flujo/algo.spec.ts",
      );

      expect(calls).toContain("playwright test");
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "corre npm test sin pedir los tests de integración",
    async () => {
      const { calls } = await runGateOnBranchTouching("docs/nota.md");

      expect(calls).toContain("npm test [RUN_INTEGRATION_TESTS=]");
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );
});
