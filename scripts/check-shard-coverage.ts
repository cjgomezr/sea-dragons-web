import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  compareShardCoverage,
  parseListedTestCount,
  readShardMatrix,
} from "./lib/shard-coverage.ts";

const WORKFLOW_PATH = ".github/workflows/visual-baselines.yml";

/** Lista las pruebas sin correrlas. Con `--reporter=list` a propósito: la
 * línea "Total" que se lee es la de ese reporter. */
function countListedTests(extraArgs: readonly string[]): number {
  const output = execFileSync(
    "npx",
    ["playwright", "test", "--list", "--reporter=list", ...extraArgs],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  return parseListedTestCount(output);
}

/** Comprueba que las partes de visual-baselines.yml suman la suite entera
 * (#255): una prueba que no cae en ninguna parte nunca se compara. */
function main(): void {
  const shards = readShardMatrix(readFileSync(WORKFLOW_PATH, "utf8"));
  const total = countListedTests([]);
  const perShard = shards.map((shard) =>
    countListedTests([`--shard=${shard}/${shards.length}`]),
  );
  const coverage = compareShardCoverage(total, perShard);

  if (coverage.kind === "mismatch") {
    console.error(
      `Las ${shards.length} partes suman ${coverage.covered} pruebas y la suite tiene ${coverage.total}: [${perShard.join(", ")}].`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Las ${shards.length} partes cubren las ${coverage.total} pruebas: [${perShard.join(", ")}].`,
  );
}

main();
