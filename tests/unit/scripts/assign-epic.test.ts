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
const ASSIGN_EPIC_SCRIPT = path.join(REPO_ROOT, "scripts/assign-epic.sh");

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

function runAssignEpic(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [ASSIGN_EPIC_SCRIPT, ...args], {
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

interface IssueFixture {
  state: "OPEN" | "CLOSED";
  labels?: { name: string }[];
  assignees?: { login: string }[];
}

/**
 * `gh` de mentira: registra cada invocación en un log y responde leyendo
 * fixtures de issues desde disco, para no tocar GitHub real. El patrón sigue
 * el de `tests/unit/scripts/file-incident.test.ts`.
 */
async function installFakeGh(
  cwd: string,
): Promise<{ binDir: string; logFile: string; fixturesDir: string }> {
  const binDir = path.join(cwd, "stub-bin");
  const fixturesDir = path.join(cwd, "fixtures");
  await mkdir(binDir, { recursive: true });
  await mkdir(fixturesDir, { recursive: true });
  const ghPath = path.join(binDir, "gh");
  const logFile = path.join(cwd, "gh-calls.log");
  const script = `#!/usr/bin/env bash
echo "$@" >> "${toBashPath(logFile)}"
FIXTURES="${toBashPath(fixturesDir)}"

if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  echo "acme/repo"
  exit 0
fi

if [ "$1" = "issue" ] && [ "$2" = "view" ]; then
  n="$3"
  if [ -f "$FIXTURES/$n.json" ]; then
    cat "$FIXTURES/$n.json"
    exit 0
  else
    exit 1
  fi
fi

if [ "$1" = "issue" ] && [ "$2" = "edit" ]; then
  exit 0
fi

if [ "$1" = "api" ]; then
  for arg in "$@"; do
    case "$arg" in
      */sub_issues)
        epic=$(echo "$arg" | sed -n 's#.*issues/\\([0-9]*\\)/sub_issues#\\1#p')
        if [ -f "$FIXTURES/sub_issues_$epic.txt" ]; then
          cat "$FIXTURES/sub_issues_$epic.txt"
        fi
        exit 0
        ;;
    esac
  done
  exit 0
fi

exit 0
`;
  await writeFile(ghPath, script);
  await chmod(ghPath, 0o755);
  await writeFile(logFile, "");
  return { binDir, logFile, fixturesDir };
}

async function readLog(logFile: string): Promise<string> {
  return readFile(logFile, "utf8");
}

async function writeIssueFixture(
  fixturesDir: string,
  number: number,
  fixture: IssueFixture,
): Promise<void> {
  await writeFile(
    path.join(fixturesDir, `${number}.json`),
    JSON.stringify({
      state: fixture.state,
      labels: fixture.labels ?? [],
      assignees: fixture.assignees ?? [],
    }),
  );
}

async function writeSubIssues(
  fixturesDir: string,
  epic: number,
  subIssueNumbers: readonly number[],
): Promise<void> {
  await writeFile(
    path.join(fixturesDir, `sub_issues_${epic}.txt`),
    subIssueNumbers.map((n) => `${n}`).join("\n") +
      (subIssueNumbers.length ? "\n" : ""),
  );
}

describe("reparto de épica", () => {
  let workDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
      workDir = "";
    }
  });

  async function setup() {
    workDir = await mkdtemp(path.join(tmpdir(), "seadragons-assign-epic-"));
    return installFakeGh(workDir);
  }

  it("asigna todos los sub-issues abiertos al usuario indicado", async () => {
    const { binDir, logFile, fixturesDir } = await setup();
    await writeIssueFixture(fixturesDir, 7, {
      state: "OPEN",
      labels: [{ name: "epic" }],
    });
    await writeSubIssues(fixturesDir, 7, [101, 102]);
    await writeIssueFixture(fixturesDir, 101, { state: "OPEN" });
    await writeIssueFixture(fixturesDir, 102, { state: "OPEN" });

    const { code } = await runAssignEpic(["7", "alice"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    expect(code).toBe(0);
    const log = await readLog(logFile);
    expect(log).toMatch(/issue edit 101 --add-assignee alice/);
    expect(log).toMatch(/issue edit 102 --add-assignee alice/);
  });

  it("respeta un sub-issue que ya tiene otro assignee y lo reporta", async () => {
    const { binDir, logFile, fixturesDir } = await setup();
    await writeIssueFixture(fixturesDir, 7, {
      state: "OPEN",
      labels: [{ name: "epic" }],
    });
    await writeSubIssues(fixturesDir, 7, [101, 102]);
    await writeIssueFixture(fixturesDir, 101, {
      state: "OPEN",
      assignees: [{ login: "bob" }],
    });
    await writeIssueFixture(fixturesDir, 102, { state: "OPEN" });

    const { code, stderr } = await runAssignEpic(["7", "alice"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    expect(code).toBe(0);
    expect(stderr).toMatch(/101/);
    expect(stderr).toMatch(/bob/);
    const log = await readLog(logFile);
    expect(log).not.toMatch(/issue edit 101 --add-assignee/);
    expect(log).toMatch(/issue edit 102 --add-assignee alice/);
  });

  it("ignora los sub-issues cerrados", async () => {
    const { binDir, logFile, fixturesDir } = await setup();
    await writeIssueFixture(fixturesDir, 7, {
      state: "OPEN",
      labels: [{ name: "epic" }],
    });
    await writeSubIssues(fixturesDir, 7, [101, 102]);
    await writeIssueFixture(fixturesDir, 101, { state: "CLOSED" });
    await writeIssueFixture(fixturesDir, 102, { state: "OPEN" });

    const { code } = await runAssignEpic(["7", "alice"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    expect(code).toBe(0);
    const log = await readLog(logFile);
    expect(log).not.toMatch(/issue edit 101 --add-assignee/);
    expect(log).toMatch(/issue edit 102 --add-assignee alice/);
  });

  it("falla con mensaje claro si la épica no existe", async () => {
    const { binDir, logFile } = await setup();

    const { code, stderr } = await runAssignEpic(["999", "alice"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/999/);
    expect(stderr).toMatch(/no existe/i);
    const log = await readLog(logFile);
    expect(log).not.toMatch(/issue edit/);
  });

  it("falla con mensaje claro si el número no corresponde a una épica", async () => {
    const { binDir, logFile, fixturesDir } = await setup();
    await writeIssueFixture(fixturesDir, 7, { state: "OPEN", labels: [] });

    const { code, stderr } = await runAssignEpic(["7", "alice"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/no es una épica/i);
    const log = await readLog(logFile);
    expect(log).not.toMatch(/issue edit/);
  });

  it("es idempotente al correrlo dos veces", async () => {
    const { binDir, logFile, fixturesDir } = await setup();
    await writeIssueFixture(fixturesDir, 7, {
      state: "OPEN",
      labels: [{ name: "epic" }],
    });
    await writeSubIssues(fixturesDir, 7, [101]);
    await writeIssueFixture(fixturesDir, 101, { state: "OPEN" });

    const env = {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    };
    const first = await runAssignEpic(["7", "alice"], workDir, env);
    expect(first.code).toBe(0);

    await writeIssueFixture(fixturesDir, 101, {
      state: "OPEN",
      assignees: [{ login: "alice" }],
    });
    const second = await runAssignEpic(["7", "alice"], workDir, env);

    expect(second.code).toBe(0);
    const log = await readLog(logFile);
    const assignCalls = log
      .split("\n")
      .filter((line) => line === "issue edit 101 --add-assignee alice");
    expect(assignCalls).toHaveLength(2);
  });

  it("sale distinto de 0 y no asigna nada si falta un argumento", async () => {
    const { binDir, logFile } = await setup();

    const { code, stderr } = await runAssignEpic(["7"], workDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/usage/i);
    const log = await readLog(logFile);
    expect(log).toBe("");
  });
});

describe("CLAUDE.md", () => {
  it("explica que la unidad de reparto es el ticket y cómo repartir una épica entera", async () => {
    const claudeMd = await readFile(path.join(REPO_ROOT, "CLAUDE.md"), "utf8");

    expect(claudeMd).toMatch(/scripts\/assign-epic\.sh/);
    expect(claudeMd).toMatch(/unidad de reparto es el ticket/i);
  });
});
