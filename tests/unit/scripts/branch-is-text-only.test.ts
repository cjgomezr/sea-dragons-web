import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const TEXT_ONLY_SCRIPT = path.join(REPO_ROOT, "scripts/branch-is-text-only.sh");

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

const TEXT_ONLY_EXIT_CODE = 0;
const NOT_TEXT_ONLY_EXIT_CODE = 1;

type ProcessResult = {
  readonly code: number | null;
  readonly output: string;
};

function runProcess(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env?: Readonly<Record<string, string>>;
  },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
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

type BranchOptions = {
  /** Sin remoto: el caso del clon sin base con la que comparar. */
  readonly withOrigin: boolean;
  /** Un archivo que ya está en main y la rama mueve con `git mv`. */
  readonly move?: { readonly from: string; readonly to: string };
};

/** Un repo con `origin/main` de verdad y una rama `impl` con un commit que
 * toca `files` y, si se pide, mueve un archivo de main. */
async function createBranchTouching(
  files: readonly string[],
  options: BranchOptions,
): Promise<readonly string[]> {
  const move = options.move ?? { from: "", to: "" };
  const originDir = await mkdtemp(path.join(tmpdir(), "seadragons-origin-"));
  const workDir = await mkdtemp(path.join(tmpdir(), "seadragons-work-"));
  const script = `
    set -e
    git init --bare -q "${toBashPath(originDir)}"
    git clone -q "${toBashPath(originDir)}" .
    git config user.email test@example.com
    git config user.name Test
    echo '{"name": "fixture"}' > package.json
    if [ -n "$MOVE_FROM" ]; then
      mkdir -p "$(dirname "$MOVE_FROM")"
      echo 'original' > "$MOVE_FROM"
    fi
    git add -A
    git commit -q -m baseline
    ${options.withOrigin ? "git push -q -u origin HEAD:main" : "git remote remove origin"}
    git checkout -q -b impl
    if [ -n "$MOVE_FROM" ]; then
      mkdir -p "$(dirname "$MOVE_TO")"
      git mv "$MOVE_FROM" "$MOVE_TO"
    fi
    for file in "$@"; do
      mkdir -p "$(dirname "$file")"
      echo 'cambio' >> "$file"
    done
    git add -A
    git commit -q -m cambio
  `;
  const { code, output } = await runProcess(
    "bash",
    ["-c", script, "_", ...files],
    { cwd: workDir, env: { MOVE_FROM: move.from, MOVE_TO: move.to } },
  );
  if (code !== 0) {
    throw new Error(`No se pudo preparar el repo de prueba: ${output}`);
  }
  return [workDir, originDir];
}

describe("branch-is-text-only.sh", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, REMOVE_TEMP_DIR_OPTIONS);
    }
  });

  async function exitCodeForBranchTouching(
    files: readonly string[],
    options: BranchOptions = { withOrigin: true },
  ): Promise<number | null> {
    const dirs = await createBranchTouching(files, options);
    tempDirs.push(...dirs);
    const [workDir] = dirs;
    if (workDir === undefined) {
      throw new Error("createBranchTouching no devolvió el repo de trabajo");
    }

    const { code } = await runProcess("bash", [toBashPath(TEXT_ONLY_SCRIPT)], {
      cwd: workDir,
    });
    return code;
  }

  it.each([
    ["un PRD", ["docs/prd/x.md"]],
    ["una skill", [".claude/skills/x/SKILL.md"]],
    ["un markdown en la raíz", ["README.md"]],
    ["una plantilla de issue", [".github/ISSUE_TEMPLATE/bug.yml"]],
    ["varios documentos a la vez", ["docs/x.md", "CLAUDE.md"]],
  ])(
    "responde que es solo texto cuando la rama cambia %s",
    async (_description, files) => {
      expect(await exitCodeForBranchTouching(files)).toBe(TEXT_ONLY_EXIT_CODE);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it.each([
    ["un documento y código", ["docs/x.md", "src/a.ts"]],
    ["el package.json", ["package.json"]],
    ["una migración", ["supabase/migrations/x.sql"]],
    ["un markdown dentro de src", ["src/app/notas.md"]],
    ["un markdown dentro de tests", ["tests/fixtures/x.md"]],
    ["un markdown dentro de scripts", ["scripts/README.md"]],
    ["un markdown dentro de workflows", [".github/workflows/README.md"]],
  ])(
    "responde que no es solo texto cuando la rama cambia %s",
    async (_description, files) => {
      expect(await exitCodeForBranchTouching(files)).toBe(
        NOT_TEXT_ONLY_EXIT_CODE,
      );
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  // `git diff` lista un renombrado por su ruta nueva; la vieja, fuera de la
  // lista, también cuenta: el PR borra código.
  it(
    "responde que no es solo texto cuando la rama mueve código a docs/",
    async () => {
      expect(
        await exitCodeForBranchTouching([], {
          withOrigin: true,
          move: { from: "src/a.ts", to: "docs/a.ts" },
        }),
      ).toBe(NOT_TEXT_ONLY_EXIT_CODE);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "responde que no es solo texto cuando no hay origin/main con el que comparar",
    async () => {
      expect(
        await exitCodeForBranchTouching(["docs/prd/x.md"], {
          withOrigin: false,
        }),
      ).toBe(NOT_TEXT_ONLY_EXIT_CODE);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );
});
