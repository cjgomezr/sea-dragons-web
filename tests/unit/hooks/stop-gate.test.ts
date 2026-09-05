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
const STOP_GATE_SCRIPT = path.join(REPO_ROOT, ".claude/hooks/stop-gate.sh");

interface RunResult {
  code: number | null;
}

function runStopGate(cwd: string, env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [STOP_GATE_SCRIPT], {
      cwd,
      env,
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code }));
  });
}

function counterFilePathFor(cwd: string): string {
  const sanitized = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  return path.join(tmpdir(), `claude-stop-gate-${sanitized}`);
}

/** Un `npx` de mentira: no instala nada, solo reporta si eslint "falló". */
async function installFakeEslintRunner(
  cwd: string,
  shouldFail: boolean,
): Promise<string> {
  const binDir = path.join(cwd, "stub-bin");
  await mkdir(binDir, { recursive: true });
  const npxPath = path.join(binDir, "npx");
  const calledMarker = path.join(cwd, "npx-was-called");
  await writeFile(
    npxPath,
    `#!/usr/bin/env bash\ntouch "${calledMarker.replace(/\\/g, "/")}"\nif [ "$1" = "eslint" ]; then\n  exit ${shouldFail ? 1 : 0}\nfi\nexit 0\n`,
  );
  await chmod(npxPath, 0o755);
  return binDir;
}

describe("stop gate", () => {
  let workDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
      workDir = "";
    }
  });

  it("sale 0 y no ejecuta ningún check cuando FACTORY_GATE=off", async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "seadragons-stop-gate-"));
    await writeFile(
      path.join(workDir, "eslint.config.js"),
      "module.exports = [];\n",
    );
    const binDir = await installFakeEslintRunner(workDir, true);

    const { code } = await runStopGate(workDir, {
      ...process.env,
      FACTORY_GATE: "off",
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    expect(code).toBe(0);
    await expect(
      readFile(path.join(workDir, "npx-was-called")),
    ).rejects.toThrow();
  });

  it("bloquea con código 2 cuando la variable no está y el lint falla", async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "seadragons-stop-gate-"));
    await writeFile(
      path.join(workDir, "eslint.config.js"),
      "module.exports = [];\n",
    );
    const binDir = await installFakeEslintRunner(workDir, true);

    const { code } = await runStopGate(workDir, {
      ...process.env,
      FACTORY_GATE: undefined,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    expect(code).toBe(2);
  });

  it("deja intacto el archivo contador cuando está desarmado", async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "seadragons-stop-gate-"));
    const counterFile = counterFilePathFor(workDir);
    await writeFile(counterFile, "3");

    try {
      const { code } = await runStopGate(workDir, {
        ...process.env,
        FACTORY_GATE: "off",
      });

      expect(code).toBe(0);
      expect(await readFile(counterFile, "utf8")).toBe("3");
    } finally {
      await rm(counterFile, { force: true });
    }
  });
});

describe("workflows", () => {
  it("claude-mentions.yml define FACTORY_GATE=off y claude-backlog.yml no", async () => {
    const mentionsYml = await readFile(
      path.join(REPO_ROOT, ".github/workflows/claude-mentions.yml"),
      "utf8",
    );
    const backlogYml = await readFile(
      path.join(REPO_ROOT, ".github/workflows/claude-backlog.yml"),
      "utf8",
    );

    expect(mentionsYml).toMatch(/FACTORY_GATE:\s*["']?off["']?/);
    expect(backlogYml).not.toMatch(/FACTORY_GATE/);
  });
});
