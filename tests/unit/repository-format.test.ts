import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as prettier from "prettier";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../..");
const PRETTIER_CLI = path.join(
  REPO_ROOT,
  "node_modules/prettier/bin/prettier.cjs",
);
// El CLI lee los dos por defecto; la API no, así que hay que pasárselos.
const IGNORE_FILES = [".gitignore", ".prettierignore"].map((name) =>
  path.join(REPO_ROOT, name),
);

// Medido, no supuesto: a 80 columnas prettier sólo reformateaba 11 de los 244
// archivos TypeScript del repositorio; a 100, 195. El código ya vive a 80.
const CODE_LINE_WIDTH = 80;

// Formatear el repositorio entero tarda unos 7 s en solitario, pero bajo
// `npm test` compite con el resto de los workers y pasó de los 20 s globales.
const PRETTIER_CHECK_TIMEOUT_MS = 90_000;

function countChangedLines(before: string, after: string): number {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const longest = Math.max(beforeLines.length, afterLines.length);
  return Array.from({ length: longest }).filter(
    (_, index) => beforeLines[index] !== afterLines[index],
  ).length;
}

describe("formato del repositorio", () => {
  it("declares the line width the code is already written at", async () => {
    const config = await prettier.resolveConfig(
      path.join(REPO_ROOT, "src/lib/theme.ts"),
    );

    expect(config?.printWidth).toBe(CODE_LINE_WIDTH);
  });

  it(
    "passes prettier --check on every file without reformatting anything",
    { timeout: PRETTIER_CHECK_TIMEOUT_MS },
    () => {
      const result = spawnSync(
        process.execPath,
        [PRETTIER_CLI, "--check", "."],
        {
          cwd: REPO_ROOT,
          encoding: "utf8",
        },
      );

      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    },
  );

  it.each([
    "node_modules/prettier/index.js",
    ".next/server/app.js",
    "test-results/results.json",
    "playwright-report/index.html",
  ])("does not look inside the generated folder of %s", async (file) => {
    const info = await prettier.getFileInfo(path.join(REPO_ROOT, file), {
      ignorePath: IGNORE_FILES,
    });

    expect(info.ignored).toBe(true);
  });

  it("changes only the edited line when the hook formats an existing file", async () => {
    const filePath = path.join(REPO_ROOT, "src/lib/theme.ts");
    const original = readFileSync(filePath, "utf8");
    const edited = original.replace(
      '"seadragons-theme"',
      '"seadragons-theme-v2"',
    );
    const config = await prettier.resolveConfig(filePath);

    const formatted = await prettier.format(edited, {
      ...config,
      filepath: filePath,
    });

    expect(countChangedLines(original, formatted)).toBe(1);
  });
});
