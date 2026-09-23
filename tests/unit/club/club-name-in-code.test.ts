import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #292: el nombre del club sale de la base. Esta guarda impide que una
 * pantalla vuelva a escribirlo a mano. Los catálogos de idioma y los correos
 * todavía lo llevan dentro: salen en sus propios tickets de E18a, y entonces
 * esta guarda se ampliará a todo `src/`.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SOURCE_ROOT = path.join(REPO_ROOT, "src");
const SCREEN_DIRECTORIES = ["app", "components"].map((directory) =>
  path.join(SOURCE_ROOT, directory),
);
const SOURCE_FILE_PATTERN = /\.tsx?$/;
const HAND_WRITTEN_CLUB_NAME = /\bCLUB_NAME\s*=\s*["'`]/;
const SEEDED_CLUB_NAME = "Victoria Seadragons";

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && SOURCE_FILE_PATTERN.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function relativeToRepository(filePath: string): string {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
}

describe("el nombre del club fuera del código", () => {
  it("ningún archivo de src/ declara CLUB_NAME con un texto escrito a mano", () => {
    const offenders = listSourceFiles(SOURCE_ROOT)
      .filter((file) => HAND_WRITTEN_CLUB_NAME.test(readFileSync(file, "utf8")))
      .map(relativeToRepository);

    expect(offenders).toEqual([]);
  });

  it("ninguna pantalla lleva escrito el nombre del club sembrado", () => {
    const offenders = SCREEN_DIRECTORIES.flatMap(listSourceFiles)
      .filter((file) => readFileSync(file, "utf8").includes(SEEDED_CLUB_NAME))
      .map(relativeToRepository);

    expect(offenders).toEqual([]);
  });
});
