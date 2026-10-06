import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import {
  describeFetchTimeoutSummary,
  type FetchTimeoutCounts,
} from "./supabase-fetch-timeout";

/** Cada archivo de integración corre aislado y deja aquí lo que contó; el
 * resumen se suma al final, en el proceso principal (#506). */
export const FETCH_TIMEOUT_REPORT_DIR_KEY = "fetchTimeoutReportDir";

declare module "vitest" {
  export interface ProvidedContext {
    [FETCH_TIMEOUT_REPORT_DIR_KEY]: string;
  }
}

function readReports(dir: string): readonly FetchTimeoutCounts[] {
  return readdirSync(dir).map(
    (file) =>
      JSON.parse(readFileSync(join(dir, file), "utf8")) as FetchTimeoutCounts,
  );
}

export default function prepareFetchTimeoutReport(
  project: TestProject,
): () => void {
  const dir = mkdtempSync(join(tmpdir(), "seadragons-fetch-timeouts-"));
  project.provide(FETCH_TIMEOUT_REPORT_DIR_KEY, dir);
  return () => {
    const summary = describeFetchTimeoutSummary(readReports(dir));
    rmSync(dir, { recursive: true, force: true });
    if (summary !== null) {
      console.info(summary);
    }
  };
}
