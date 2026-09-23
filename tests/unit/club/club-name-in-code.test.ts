import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #292 y #293: el nombre del club sale de la base. Esta guarda impide que
 * vuelva a escribirse a mano en cualquier archivo de `src/`.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SOURCE_ROOT = path.join(REPO_ROOT, "src");
const TYPESCRIPT_FILE_PATTERN = /\.tsx?$/;
const ANY_FILE_PATTERN = /./;
const HAND_WRITTEN_CLUB_NAME = /\bCLUB_NAME\s*=\s*["'`]/;
const SEEDED_CLUB_NAME = "Victoria Seadragons";
/** El respaldo de RF-2 tiene que pintar algo si la base no contesta, y los
 * correos (#297) todavía lo usan como nombre. Es el único sitio permitido. */
const FALLBACK_BRAND_FILE = "src/lib/club/club-brand.ts";

function listSourceFiles(directory: string, filePattern: RegExp): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && filePattern.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function relativeToRepository(filePath: string): string {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
}

describe("el nombre del club fuera del código", () => {
  it("ningún archivo de src/ declara CLUB_NAME con un texto escrito a mano", () => {
    const offenders = listSourceFiles(SOURCE_ROOT, TYPESCRIPT_FILE_PATTERN)
      .filter((file) => HAND_WRITTEN_CLUB_NAME.test(readFileSync(file, "utf8")))
      .map(relativeToRepository);

    expect(offenders).toEqual([]);
  });

  it("ningún archivo de src/ lleva escrito el nombre del club sembrado, salvo el respaldo", () => {
    const offenders = listSourceFiles(SOURCE_ROOT, ANY_FILE_PATTERN)
      .filter((file) => readFileSync(file, "utf8").includes(SEEDED_CLUB_NAME))
      .map(relativeToRepository)
      .filter((file) => file !== FALLBACK_BRAND_FILE);

    expect(offenders).toEqual([]);
  });
});
