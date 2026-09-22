import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareShardCoverage,
  parseListedTestCount,
  readShardMatrix,
} from "../../../scripts/lib/shard-coverage";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOW_PATH = path.join(
  REPO_ROOT,
  ".github/workflows/visual-baselines.yml",
);

function workflowWithShards(compare: string, regenerate: string): string {
  return [
    "jobs:",
    "  compare:",
    "    strategy:",
    "      matrix:",
    `        shard: ${compare}`,
    "  regenerate:",
    "    strategy:",
    "      matrix:",
    `        shard: ${regenerate}`,
  ].join("\n");
}

describe("parseListedTestCount", () => {
  it("lee el total que imprime playwright test --list", () => {
    const output = [
      "Listing tests:",
      "  [chromium] › ui.spec.ts:10:3 › home › matches approved baseline",
      "Total: 1234 tests in 5 files",
    ].join("\n");

    expect(parseListedTestCount(output)).toBe(1234);
  });

  it("entiende el singular de una parte con una sola prueba", () => {
    expect(parseListedTestCount("Total: 1 test in 1 file")).toBe(1);
  });

  it("falla con claridad si la salida no trae el total", () => {
    expect(() => parseListedTestCount("Error: no tests found")).toThrow(
      /Total/,
    );
  });
});

describe("compareShardCoverage", () => {
  it("da por cubierta la suite cuando las partes suman el total", () => {
    expect(compareShardCoverage(10, [3, 3, 4])).toEqual({
      kind: "complete",
      total: 10,
    });
  });

  it("señala el hueco cuando las partes suman menos que el total", () => {
    expect(compareShardCoverage(10, [3, 3])).toEqual({
      kind: "mismatch",
      total: 10,
      covered: 6,
    });
  });

  it("señala también las partes que suman de más", () => {
    expect(compareShardCoverage(10, [5, 6])).toEqual({
      kind: "mismatch",
      total: 10,
      covered: 11,
    });
  });
});

describe("readShardMatrix", () => {
  it("devuelve las partes que declara el workflow", () => {
    expect(
      readShardMatrix(workflowWithShards("[1, 2, 3]", "[1, 2, 3]")),
    ).toEqual([1, 2, 3]);
  });

  it("rechaza una matriz con un hueco, que dejaría una parte sin correr", () => {
    expect(() =>
      readShardMatrix(workflowWithShards("[1, 2, 4]", "[1, 2, 4]")),
    ).toThrow(/1\.\.3/);
  });

  it("rechaza que comparar y aceptar se repartan distinto", () => {
    expect(() =>
      readShardMatrix(workflowWithShards("[1, 2, 3]", "[1, 2]")),
    ).toThrow(/regenerate/);
  });

  it("el workflow de verdad reparte la suite en más de una parte", () => {
    const shards = readShardMatrix(readFileSync(WORKFLOW_PATH, "utf8"));

    expect(shards.length).toBeGreaterThan(1);
  });
});
