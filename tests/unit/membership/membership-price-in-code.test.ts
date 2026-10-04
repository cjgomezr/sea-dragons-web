import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #486: los precios del club salen de Stripe. Esta guarda impide que vuelva a
 * escribirse a mano en `src/` un importe de membresía, como hacía
 * `MONTHLY_PRICE_CENTS`, que enseñaba un precio y Stripe cobraba otro.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SOURCE_ROOT = path.join(REPO_ROOT, "src");
const TYPESCRIPT_FILE_PATTERN = /\.tsx?$/;
/** Los importes que llegaron a estar escritos: 45, 32 y 15 AUD en centavos. */
const KNOWN_MEMBERSHIP_AMOUNT = /\b(?:4500|3200|1500)\b/;
const PRICE_WORDING = /price|cents|precio/i;
/** Cuántas líneas alrededor del importe se mira si se habla de precios: un
 * `Full: 4500,` dentro de una constante de precios no lleva la palabra en su
 * propia línea. */
const NEARBY_LINES = 3;
const RETIRED_CONSTANT = "MONTHLY_PRICE_CENTS";

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter(
      (entry) => entry.isFile() && TYPESCRIPT_FILE_PATTERN.test(entry.name),
    )
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function relativeToRepository(filePath: string): string {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
}

function isNearPriceWording(lines: readonly string[], index: number): boolean {
  return lines
    .slice(Math.max(0, index - NEARBY_LINES), index + NEARBY_LINES + 1)
    .some((line) => PRICE_WORDING.test(line));
}

function linesWithHandWrittenPrice(file: string): string[] {
  const lines = readFileSync(file, "utf8").split("\n");
  return lines
    .map((line, index) => ({ line, index }))
    .filter(
      ({ line, index }) =>
        KNOWN_MEMBERSHIP_AMOUNT.test(line) && isNearPriceWording(lines, index),
    )
    .map(({ index }) => `${relativeToRepository(file)}:${index + 1}`);
}

describe("los precios de la membresía fuera del código", () => {
  it("ningún archivo de src/ lleva un importe de membresía junto a un precio", () => {
    const offenders = listSourceFiles(SOURCE_ROOT).flatMap(
      linesWithHandWrittenPrice,
    );

    expect(offenders).toEqual([]);
  });

  it("ningún archivo de src/ declara MONTHLY_PRICE_CENTS", () => {
    const offenders = listSourceFiles(SOURCE_ROOT)
      .filter((file) => readFileSync(file, "utf8").includes(RETIRED_CONSTANT))
      .map(relativeToRepository);

    expect(offenders).toEqual([]);
  });
});
