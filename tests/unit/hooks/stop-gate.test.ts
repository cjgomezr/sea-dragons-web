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

/**
 * Le pregunta a bash cuál es el path del contador, en vez de reimplementar la
 * sanitización en TS: `pwd | tr -c "[:alnum:]" "-"` convierte también el
 * salto de línea final de `pwd` en un guión, así que duplicar la fórmula con
 * un `.replace` en JS calcula un path distinto (sin ese guión final) y el
 * test terminaría verificando un archivo que el script real nunca toca.
 */
function counterFilePathFor(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "bash",
      ["-c", 'echo "/tmp/claude-stop-gate-$(pwd | tr -c "[:alnum:]" "-")"'],
      { cwd, stdio: ["ignore", "pipe", "ignore"] },
    );
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", () => resolve(stdout.trim()));
  });
}

function readViaBash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", 'cat "$1"', "_", filePath], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", () => resolve(stdout));
  });
}

function writeViaBash(filePath: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "bash",
      ["-c", 'printf "%s" "$1" > "$2"', "_", content, filePath],
      {
        stdio: "ignore",
      },
    );
    child.on("error", reject);
    child.on("close", () => resolve());
  });
}

function removeViaBash(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", 'rm -f "$1"', "_", filePath], {
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("close", () => resolve());
  });
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
    const counterFile = await counterFilePathFor(workDir);
    await writeViaBash(counterFile, "3");

    try {
      const { code } = await runStopGate(workDir, {
        ...process.env,
        FACTORY_GATE: "off",
      });

      expect(code).toBe(0);
      expect(await readViaBash(counterFile)).toBe("3");
    } finally {
      await removeViaBash(counterFile);
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
