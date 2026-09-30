import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const TEXT_ONLY_PATHS_LIST = path.join(
  REPO_ROOT,
  ".github/text-only-paths.txt",
);

const EXCLUSION_PREFIX = "!";

const REQUIRED_TEXT_PATTERNS = [
  "docs/**",
  "**/*.md",
  ".claude/skills/**",
  ".github/ISSUE_TEMPLATE/**",
];

/** Lo que nunca puede contar como texto: un PR que lo toca tiene que correr
 * los tests de red (#439). */
const FORBIDDEN_DIRECTORIES = [
  "src/",
  "tests/",
  "supabase/",
  "scripts/",
  ".github/workflows/",
];
const FORBIDDEN_FILE = "package.json";

/** Las rutas del archivo, sin comentarios ni líneas vacías. */
function readTextOnlyPatterns(): string[] {
  return readFileSync(TEXT_ONLY_PATHS_LIST, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

function inclusions(): string[] {
  return readTextOnlyPatterns().filter(
    (pattern) => !pattern.startsWith(EXCLUSION_PREFIX),
  );
}

function exclusions(): string[] {
  return readTextOnlyPatterns()
    .filter((pattern) => pattern.startsWith(EXCLUSION_PREFIX))
    .map((pattern) => pattern.slice(EXCLUSION_PREFIX.length));
}

describe("la lista de rutas de solo texto", () => {
  it("contiene los documentos, los markdown, las skills y las plantillas de issue", () => {
    expect(inclusions()).toEqual(
      expect.arrayContaining(REQUIRED_TEXT_PATTERNS),
    );
  });

  it("no incluye nada bajo los directorios de código ni el package.json", () => {
    const forbiddenInclusions = inclusions().filter(
      (pattern) =>
        pattern === FORBIDDEN_FILE ||
        FORBIDDEN_DIRECTORIES.some((directory) =>
          pattern.startsWith(directory),
        ),
    );

    expect(forbiddenInclusions).toEqual([]);
  });

  // `**/*.md` alcanzaría un markdown dentro de src/ o de los workflows; la
  // exclusión explícita lo devuelve al lado del código.
  it("excluye cada directorio de código aunque un patrón amplio lo alcance", () => {
    expect(exclusions()).toEqual(
      expect.arrayContaining(
        FORBIDDEN_DIRECTORIES.map((directory) => `${directory}**`),
      ),
    );
  });

  it("pone las exclusiones después de las inclusiones, porque gana la última que coincide", () => {
    const patterns = readTextOnlyPatterns();
    const isExclusion = (pattern: string): boolean =>
      pattern.startsWith(EXCLUSION_PREFIX);
    const firstExclusion = patterns.findIndex(isExclusion);
    const inclusionsAfterIt = patterns
      .slice(firstExclusion)
      .filter((pattern) => !isExclusion(pattern));

    expect(firstExclusion).toBeGreaterThanOrEqual(0);
    expect(inclusionsAfterIt).toEqual([]);
  });
});
