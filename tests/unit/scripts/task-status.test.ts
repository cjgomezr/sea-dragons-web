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
const TASK_STATUS_SCRIPT = path.join(REPO_ROOT, "scripts/task-status.sh");

const CONFIGURED_PROJECT_ID = "PVT_1";
const OTHER_PROJECT_ID = "PVT_OTHER";
const ISSUE_URL = "https://github.com/acme/repo/issues/7";
const ADDED_ITEM_ID = "ITEM_NEW";

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface ProjectItem {
  id: string;
  projectId: string;
}

function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

function runTaskStatus(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [TASK_STATUS_SCRIPT, ...args], {
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

function issueResponse(items: readonly ProjectItem[]): string {
  return JSON.stringify({
    data: {
      repository: {
        issue: {
          url: ISSUE_URL,
          projectItems: {
            nodes: items.map((item) => ({
              id: item.id,
              project: { id: item.projectId },
            })),
          },
        },
      },
    },
  });
}

const RATE_LIMIT_RESPONSE = JSON.stringify({
  data: null,
  errors: [
    {
      type: "RATE_LIMIT",
      code: "graphql_rate_limit",
      message: "API rate limit exceeded for user ID 1.",
    },
  ],
});

/**
 * `gh` de mentira: registra cada invocación en un log. `gh api graphql`
 * responde con el contenido de `graphql.json` (y sale con el código de
 * `graphql.exit`, si existe); `gh project item-add` reescribe ese archivo para
 * que la tarjeta nueva aparezca en la siguiente consulta, como en GitHub. El
 * patrón sigue el de `tests/unit/scripts/assign-epic.test.ts`.
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
  const addedResponse = issueResponse([
    { id: ADDED_ITEM_ID, projectId: CONFIGURED_PROJECT_ID },
  ]);
  // La consulta GraphQL ocupa varias líneas: se aplana para que cada
  // invocación quede en una sola línea del log.
  const script = `#!/usr/bin/env bash
echo "$*" | tr '\\n' ' ' | sed 's/ *$//' >> "${toBashPath(logFile)}"
echo >> "${toBashPath(logFile)}"
FIXTURES="${toBashPath(fixturesDir)}"

if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then
  cat "$FIXTURES/graphql.json"
  [ -f "$FIXTURES/graphql.exit" ] && exit "$(cat "$FIXTURES/graphql.exit")"
  exit 0
fi

if [ "$1" = "project" ] && [ "$2" = "item-add" ]; then
  echo '${addedResponse}' > "$FIXTURES/graphql.json"
  echo '{"id": "${ADDED_ITEM_ID}"}'
  exit 0
fi

exit 0
`;
  await writeFile(ghPath, script);
  await chmod(ghPath, 0o755);
  await writeFile(logFile, "");
  return { binDir, logFile, fixturesDir };
}

async function writeGraphqlResponse(
  fixturesDir: string,
  body: string,
  exitCode = 0,
): Promise<void> {
  await writeFile(path.join(fixturesDir, "graphql.json"), body);
  if (exitCode !== 0) {
    await writeFile(path.join(fixturesDir, "graphql.exit"), `${exitCode}`);
  }
}

async function writeProjectConfig(workDir: string): Promise<void> {
  await mkdir(path.join(workDir, ".plan"), { recursive: true });
  await writeFile(
    path.join(workDir, ".plan/project.json"),
    JSON.stringify({
      owner: "acme",
      projectNumber: 5,
      projectId: CONFIGURED_PROJECT_ID,
      statusFieldId: "FIELD_1",
      statusOptions: {
        Todo: "opt-todo",
        "In Progress": "opt-ip",
        Done: "opt-done",
        Blocked: "opt-blocked",
      },
    }),
  );
}

async function readCalls(logFile: string): Promise<string[]> {
  const log = await readFile(logFile, "utf8");
  return log.split("\n").filter((line) => line.length > 0);
}

describe("task-status.sh", () => {
  let workDir = "";

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
      workDir = "";
    }
  });

  async function setup(): Promise<{
    env: NodeJS.ProcessEnv;
    logFile: string;
    fixturesDir: string;
  }> {
    workDir = await mkdtemp(path.join(tmpdir(), "seadragons-task-status-"));
    const { binDir, logFile, fixturesDir } = await installFakeGh(workDir);
    const env = {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    };
    return { env, logFile, fixturesDir };
  }

  it("busca la tarjeta por issue en vez de listar el tablero entero", async () => {
    const script = await readFile(TASK_STATUS_SCRIPT, "utf8");

    expect(script).not.toMatch(/item-list/);
    expect(script).toMatch(/projectItems/);
  });

  it("sale sin error y sin llamar a GitHub cuando no hay .plan/project.json", async () => {
    const { env, logFile } = await setup();

    const { code } = await runTaskStatus(["7", "In Progress"], workDir, env);

    expect(code).toBe(0);
    expect(await readCalls(logFile)).toEqual([]);
  });

  it("rechaza un estado desconocido nombrando los válidos", async () => {
    const { env, logFile } = await setup();
    await writeProjectConfig(workDir);

    const { code, stderr } = await runTaskStatus(["7", "Hecho"], workDir, env);

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/Unknown status 'Hecho'/);
    expect(stderr).toMatch(/Known: .*Todo/);
    expect(stderr).toMatch(/In Progress/);
    expect(stderr).toMatch(/Blocked/);
    expect(await readCalls(logFile)).toEqual([]);
  });

  it("hace dos llamadas cuando el issue ya está en el tablero", async () => {
    const { env, logFile, fixturesDir } = await setup();
    await writeProjectConfig(workDir);
    await writeGraphqlResponse(
      fixturesDir,
      issueResponse([{ id: "ITEM_7", projectId: CONFIGURED_PROJECT_ID }]),
    );

    const { code, stdout } = await runTaskStatus(
      ["7", "In Progress"],
      workDir,
      env,
    );

    expect(code).toBe(0);
    expect(stdout).toMatch(/✓ #7 → In Progress/);
    const calls = await readCalls(logFile);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/^api graphql /);
    expect(calls[0]).toMatch(/number=7/);
    expect(calls[1]).toMatch(
      /^project item-edit --id ITEM_7 --project-id PVT_1 --field-id FIELD_1 --single-select-option-id opt-ip/,
    );
  });

  it("añade la tarjeta y le pone el estado cuando el issue no está en el tablero", async () => {
    const { env, logFile, fixturesDir } = await setup();
    await writeProjectConfig(workDir);
    await writeGraphqlResponse(fixturesDir, issueResponse([]));

    const { code, stdout } = await runTaskStatus(["7", "Todo"], workDir, env);

    expect(code).toBe(0);
    expect(stdout).toMatch(/✓ #7 → Todo/);
    const calls = await readCalls(logFile);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatch(/^api graphql /);
    expect(calls[1]).toBe(
      `project item-add 5 --owner acme --url ${ISSUE_URL} --format json`,
    );
    expect(calls[2]).toMatch(
      new RegExp(`^project item-edit --id ${ADDED_ITEM_ID} .*opt-todo`),
    );
  });

  it("no pide al tablero una lista de elementos, así que su tamaño no cuenta", async () => {
    const { env, logFile, fixturesDir } = await setup();
    await writeProjectConfig(workDir);
    await writeGraphqlResponse(
      fixturesDir,
      issueResponse([{ id: "ITEM_7", projectId: CONFIGURED_PROJECT_ID }]),
    );

    await runTaskStatus(["7", "Done"], workDir, env);

    const calls = await readCalls(logFile);
    expect(calls.some((call) => /item-list|--limit/.test(call))).toBe(false);
  });

  it("elige la tarjeta del proyecto configurado cuando el issue está en varios", async () => {
    const { env, logFile, fixturesDir } = await setup();
    await writeProjectConfig(workDir);
    await writeGraphqlResponse(
      fixturesDir,
      issueResponse([
        { id: "ITEM_OTHER", projectId: OTHER_PROJECT_ID },
        { id: "ITEM_OURS", projectId: CONFIGURED_PROJECT_ID },
      ]),
    );

    const { code } = await runTaskStatus(["7", "Blocked"], workDir, env);

    expect(code).toBe(0);
    const calls = await readCalls(logFile);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatch(/^project item-edit --id ITEM_OURS .*opt-blocked/);
  });

  it("añade la tarjeta cuando el issue solo está en otro proyecto", async () => {
    const { env, logFile, fixturesDir } = await setup();
    await writeProjectConfig(workDir);
    await writeGraphqlResponse(
      fixturesDir,
      issueResponse([{ id: "ITEM_OTHER", projectId: OTHER_PROJECT_ID }]),
    );

    const { code } = await runTaskStatus(["7", "Todo"], workDir, env);

    expect(code).toBe(0);
    const calls = await readCalls(logFile);
    expect(calls[1]).toMatch(/^project item-add /);
    expect(calls[2]).toMatch(
      new RegExp(`^project item-edit --id ${ADDED_ITEM_ID} `),
    );
  });

  it("aborta con un mensaje claro si GitHub limita aunque gh salga con 0", async () => {
    const { env, logFile, fixturesDir } = await setup();
    await writeProjectConfig(workDir);
    await writeGraphqlResponse(fixturesDir, RATE_LIMIT_RESPONSE);

    const { code, stderr } = await runTaskStatus(["7", "Todo"], workDir, env);

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/rate limit/i);
    expect(stderr).toMatch(/#7/);
    const calls = await readCalls(logFile);
    expect(calls.some((call) => /item-add|item-edit/.test(call))).toBe(false);
  });

  it("aborta con un mensaje claro si GitHub limita y gh sale con error", async () => {
    const { env, logFile, fixturesDir } = await setup();
    await writeProjectConfig(workDir);
    await writeGraphqlResponse(fixturesDir, RATE_LIMIT_RESPONSE, 1);

    const { code, stderr } = await runTaskStatus(["7", "Todo"], workDir, env);

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/rate limit/i);
    const calls = await readCalls(logFile);
    expect(calls.some((call) => /item-add|item-edit/.test(call))).toBe(false);
  });

  it("aborta sin añadir tarjeta cuando la consulta devuelve otro error", async () => {
    const { env, logFile, fixturesDir } = await setup();
    await writeProjectConfig(workDir);
    await writeGraphqlResponse(
      fixturesDir,
      JSON.stringify({
        data: { repository: { issue: null } },
        errors: [
          {
            type: "NOT_FOUND",
            message: "Could not resolve to an Issue with the number of 7.",
          },
        ],
      }),
    );

    const { code, stderr } = await runTaskStatus(["7", "Todo"], workDir, env);

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/Could not resolve to an Issue/);
    const calls = await readCalls(logFile);
    expect(calls.some((call) => /item-add|item-edit/.test(call))).toBe(false);
  });

  it("aborta sin añadir tarjeta cuando la respuesta llega vacía", async () => {
    const { env, logFile, fixturesDir } = await setup();
    await writeProjectConfig(workDir);
    await writeGraphqlResponse(fixturesDir, "");

    const { code, stderr } = await runTaskStatus(["7", "Todo"], workDir, env);

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/Could not look up #7/);
    const calls = await readCalls(logFile);
    expect(calls.some((call) => /item-add|item-edit/.test(call))).toBe(false);
  });

  it("no duplica la tarjeta al correrlo dos veces con el mismo estado", async () => {
    const { env, logFile, fixturesDir } = await setup();
    await writeProjectConfig(workDir);
    await writeGraphqlResponse(fixturesDir, issueResponse([]));

    const first = await runTaskStatus(["7", "Todo"], workDir, env);
    const second = await runTaskStatus(["7", "Todo"], workDir, env);

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(second.stdout).toMatch(/✓ #7 → Todo/);
    const calls = await readCalls(logFile);
    expect(
      calls.filter((call) => /^project item-add /.test(call)),
    ).toHaveLength(1);
    const edits = calls.filter((call) => /^project item-edit /.test(call));
    expect(edits).toHaveLength(2);
    expect(edits[1]).toBe(edits[0]);
  });
});
