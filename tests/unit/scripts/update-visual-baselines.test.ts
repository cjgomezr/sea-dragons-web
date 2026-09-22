import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/update-visual-baselines.sh");

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

function runScript(
  cwd: string,
  env: NodeJS.ProcessEnv,
  args: readonly string[] = [],
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [toBashPath(SCRIPT), ...args], {
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

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

/**
 * `npx` de mentira: registra cada invocación en un log y simula el
 * comportamiento real de `playwright test` que el script le pide.
 * `FAKE_FIRST_COMPARE_EXIT` controla si la comparación inicial (sin
 * `--update-snapshots`) encuentra una diferencia. Cuando el script pide
 * regenerar, `FAKE_REGENERATE_CHANGES_FILE` decide si esa regeneración
 * produce contenido distinto (una diferencia de píxeles real) o no
 * (un fallo que no era de captura, p. ej. la app no levantó).
 */
async function installFakeNpx(
  workDir: string,
  options: {
    firstCompareExit: 0 | 1;
    regenerateChangesFile: boolean;
  },
): Promise<{ binDir: string; logFile: string }> {
  const binDir = path.join(workDir, "fake-bin");
  const logFile = path.join(workDir, "npx.log");
  await mkdir(binDir, { recursive: true });
  await writeFile(logFile, "");

  const snapshotFile = path.join(
    workDir,
    "tests/ui.spec.ts-snapshots/home-desktop-light-chromium-linux.png",
  );

  const script = `#!/usr/bin/env bash
echo "$@" >> "${toBashPath(logFile)}"
if [ "$3" = "--update-snapshots" ]; then
  ${options.regenerateChangesFile ? `echo "regenerated-$RANDOM" > "${toBashPath(snapshotFile)}"` : "true"}
  exit 0
fi
exit ${options.firstCompareExit}
`;
  const npxPath = path.join(binDir, "npx");
  await writeFile(npxPath, script);
  await chmod(npxPath, 0o755);
  return { binDir, logFile };
}

async function initGitRepoWithCommittedSnapshot(
  workDir: string,
): Promise<void> {
  const snapshotDir = path.join(workDir, "tests/ui.spec.ts-snapshots");
  await mkdir(snapshotDir, { recursive: true });
  await writeFile(
    path.join(snapshotDir, "home-desktop-light-chromium-linux.png"),
    "original-baseline",
  );
  await run("git", ["init", "-q"], workDir);
  await run("git", ["config", "user.email", "test@example.com"], workDir);
  await run("git", ["config", "user.name", "test"], workDir);
  await run("git", ["add", "."], workDir);
  await run("git", ["commit", "-q", "-m", "línea base inicial"], workDir);
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} salió con ${code}`));
    });
  });
}

async function stagedFiles(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["diff", "--cached", "--name-only"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", () => resolve(stdout.trim()));
  });
}

describe("scripts/update-visual-baselines.sh", () => {
  let workDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, REMOVE_TEMP_DIR_OPTIONS);
      workDir = "";
    }
  });

  it("no toca nada cuando la comparación inicial ya coincide con la línea base", async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "update-baselines-"));
    await initGitRepoWithCommittedSnapshot(workDir);
    const { binDir, logFile } = await installFakeNpx(workDir, {
      firstCompareExit: 0,
      regenerateChangesFile: false,
    });
    const env = {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    };

    const { code } = await runScript(workDir, env);

    expect(code).toBe(0);
    const invocations = (await readFile(logFile, "utf8")).trim().split("\n");
    expect(invocations).toEqual(["playwright test"]);
    expect(await stagedFiles(workDir)).toBe("");
  });

  it("regenera y deja la línea base lista para commitear cuando hay una diferencia real", async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "update-baselines-"));
    await initGitRepoWithCommittedSnapshot(workDir);
    const { binDir, logFile } = await installFakeNpx(workDir, {
      firstCompareExit: 1,
      regenerateChangesFile: true,
    });
    const env = {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    };

    const { code } = await runScript(workDir, env);

    expect(code).toBe(1);
    const invocations = (await readFile(logFile, "utf8")).trim().split("\n");
    expect(invocations).toEqual([
      "playwright test",
      "playwright test --update-snapshots",
    ]);
    expect(await stagedFiles(workDir)).toBe(
      "tests/ui.spec.ts-snapshots/home-desktop-light-chromium-linux.png",
    );
  });

  it("falla sin dejar nada para commitear cuando el fallo inicial no era de píxeles", async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "update-baselines-"));
    await initGitRepoWithCommittedSnapshot(workDir);
    const { binDir } = await installFakeNpx(workDir, {
      firstCompareExit: 1,
      regenerateChangesFile: false,
    });
    const env = {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    };

    const { code } = await runScript(workDir, env);

    expect(code).toBe(1);
    expect(await stagedFiles(workDir)).toBe("");
  });

  // #255: `regenerate` corre el script en cada parte del reparto, y cada una
  // tiene que comparar y regenerar sólo lo suyo.
  it("pasa sus argumentos a las dos corridas de Playwright", async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "update-baselines-"));
    await initGitRepoWithCommittedSnapshot(workDir);
    const { binDir, logFile } = await installFakeNpx(workDir, {
      firstCompareExit: 1,
      regenerateChangesFile: true,
    });
    const env = {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    };

    await runScript(workDir, env, ["--shard=2/4"]);

    const invocations = (await readFile(logFile, "utf8")).trim().split("\n");
    expect(invocations).toEqual([
      "playwright test --shard=2/4",
      "playwright test --update-snapshots --shard=2/4",
    ]);
  });
});
