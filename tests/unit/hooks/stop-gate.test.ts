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

interface BashScriptResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runBashScript(cwd: string, script: string): Promise<BashScriptResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", script], {
      cwd,
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
 * Repo con upstream real: el guard necesita `@{upstream}` para decidir si hay
 * commits por delante, así que un `git init` suelto no alcanza. El commit
 * base deja sucios (trackeados) los cuatro archivos de ruido más uno de
 * producto, para que los tests solo tengan que decidir cuáles tocar.
 */
async function createFixtureRepo(): Promise<{
  workDir: string;
  originDir: string;
}> {
  const originDir = await mkdtemp(path.join(tmpdir(), "seadragons-origin-"));
  const workDir = await mkdtemp(path.join(tmpdir(), "seadragons-work-"));
  const script = `
    set -e
    git init --bare -q "${toBashPath(originDir)}"
    git clone -q "${toBashPath(originDir)}" .
    git config user.email test@example.com
    git config user.name Test
    mkdir -p src/lib
    echo '{"include": ["**/*.ts"]}' > tsconfig.json
    echo '{"name": "fixture", "lockfileVersion": 3}' > package-lock.json
    echo '# CLAUDE' > CLAUDE.md
    echo '# AGENTS' > AGENTS.md
    echo 'module.exports = [];' > eslint.config.js
    echo '{"name": "fixture", "scripts": {"test": "true"}}' > package.json
    echo 'export const foo = 1;' > src/lib/foo.ts
    git add -A
    git commit -q -m baseline
    git push -q -u origin HEAD:main
  `;
  const { code, stderr } = await runBashScript(workDir, script);
  if (code !== 0) {
    throw new Error(`No se pudo preparar el repo de prueba: ${stderr}`);
  }
  return { workDir, originDir };
}

/**
 * `npm`/`npx` de mentira: registran que corrieron y siempre "pasan". Viven
 * fuera de `workDir` a propósito: si el bin stub estuviera dentro del árbol
 * git, `git status` lo vería como archivo sin seguimiento y el guard tendría
 * razón en no aplicar, invalidando el test.
 */
async function installChecksRanMarkerBin(): Promise<{
  binDir: string;
  markerFile: string;
}> {
  const binDir = await mkdtemp(path.join(tmpdir(), "seadragons-stub-bin-"));
  const markerFile = path.join(binDir, "checks-ran");
  const marker = toBashPath(markerFile);
  for (const name of ["npm", "npx"]) {
    const binPath = path.join(binDir, name);
    await writeFile(
      binPath,
      `#!/usr/bin/env bash\ntouch "${marker}"\nexit 0\n`,
    );
    await chmod(binPath, 0o755);
  }
  return { binDir, markerFile };
}

async function checksRan(markerFile: string): Promise<boolean> {
  try {
    await readFile(markerFile);
    return true;
  } catch {
    return false;
  }
}

describe("guard de árbol limpio", () => {
  let workDir = "";
  let originDir = "";
  let stubBinDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
      workDir = "";
    }
    if (originDir) {
      await rm(originDir, { recursive: true, force: true });
      originDir = "";
    }
    if (stubBinDir) {
      await rm(stubBinDir, { recursive: true, force: true });
      stubBinDir = "";
    }
  });

  it("pasa cuando el árbol está completamente limpio", async () => {
    ({ workDir, originDir } = await createFixtureRepo());
    const { binDir, markerFile } = await installChecksRanMarkerBin();
    stubBinDir = binDir;

    const { code } = await runStopGate(workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    expect(code).toBe(0);
    expect(await checksRan(markerFile)).toBe(false);
  });

  it.each(["tsconfig.json", "package-lock.json", "CLAUDE.md", "AGENTS.md"])(
    "pasa cuando la única suciedad es ruido generado (%s)",
    async (noiseFile) => {
      ({ workDir, originDir } = await createFixtureRepo());
      await writeFile(path.join(workDir, noiseFile), "cambiado por next dev\n");
      const { binDir, markerFile } = await installChecksRanMarkerBin();
      stubBinDir = binDir;

      const { code } = await runStopGate(workDir, {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      });

      expect(code).toBe(0);
      expect(await checksRan(markerFile)).toBe(false);
    },
  );

  it("no pasa cuando además hay un archivo de producto", async () => {
    ({ workDir, originDir } = await createFixtureRepo());
    await writeFile(path.join(workDir, "tsconfig.json"), "cambiado\n");
    await writeFile(
      path.join(workDir, "src/lib/foo.ts"),
      "export const foo = 2;\n",
    );
    const { binDir, markerFile } = await installChecksRanMarkerBin();
    stubBinDir = binDir;

    await runStopGate(workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    expect(await checksRan(markerFile)).toBe(true);
  });

  it("no pasa cuando hay commits sobre upstream, aunque la suciedad sea ruido", async () => {
    ({ workDir, originDir } = await createFixtureRepo());
    await runBashScript(
      workDir,
      `git config user.email test@example.com
       git config user.name Test
       echo 'export const foo = 2;' > src/lib/foo.ts
       git commit -aqm "commit sin pushear"`,
    );
    await writeFile(path.join(workDir, "tsconfig.json"), "cambiado\n");
    const { binDir, markerFile } = await installChecksRanMarkerBin();
    stubBinDir = binDir;

    await runStopGate(workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    expect(await checksRan(markerFile)).toBe(true);
  });

  it("no pasa ante un archivo sin seguimiento fuera de la lista", async () => {
    ({ workDir, originDir } = await createFixtureRepo());
    await writeFile(path.join(workDir, "src/lib/scratch.ts"), "export {};\n");
    const { binDir, markerFile } = await installChecksRanMarkerBin();
    stubBinDir = binDir;

    await runStopGate(workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    expect(await checksRan(markerFile)).toBe(true);
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
