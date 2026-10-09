import { existsSync, readFileSync } from "node:fs";
import {
  parseK6Results,
  renderLoadTestSummary,
  summarizeLoadTest,
} from "./load-report.ts";
import { MEASURED_REQUESTS } from "./load-test-config.ts";

/**
 * `tsx scripts/load-test/report.ts <resultados.json>`: escribe en la salida
 * el resumen de la prueba de carga (#525), en Markdown. El workflow lo lleva
 * al resumen del job. Sale con 1 si la prueba no cumple o si midió menos de
 * lo pedido.
 */

function main(): void {
  const resultsFile = process.argv[2];
  if (!resultsFile || !existsSync(resultsFile)) {
    console.log(
      `### ❌ La prueba de carga no dejó resultados\n\nNo existe ${resultsFile ?? "el archivo de resultados"}: k6 no llegó a arrancar o el runner lo cortó antes de escribir nada.\n`,
    );
    process.exitCode = 1;
    return;
  }
  const report = summarizeLoadTest(
    parseK6Results(readFileSync(resultsFile, "utf8")),
    Object.values(MEASURED_REQUESTS),
  );
  console.log(renderLoadTestSummary(report));
  if (report.verdict.kind === "failed") process.exitCode = 1;
}

try {
  main();
} catch (error: unknown) {
  console.log(
    `### ❌ No se pudo leer la prueba de carga\n\n${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
