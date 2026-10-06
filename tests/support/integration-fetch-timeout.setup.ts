import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, inject } from "vitest";
import { SUPABASE_URL_ENV } from "@/lib/supabase/config";
import { FETCH_TIMEOUT_REPORT_DIR_KEY } from "./fetch-timeout-report";
import {
  createFetchTimeoutTally,
  withFetchTimeout,
} from "./supabase-fetch-timeout";

// Sólo el proyecto `integration` carga este archivo (`test-projects.mts`).
// supabase-js usa el `fetch` global, así que el envoltorio alcanza también al
// código de la aplicación que corre dentro del test. `vitest.setup.ts`, que va
// antes, ya cargó `.env.local` y comprobó que apunta a dev.
// Sin URL ningún test alcanza Supabase (se saltan solos), y no hay nada que
// envolver.
const supabaseUrl = process.env[SUPABASE_URL_ENV]?.trim();
const tally = createFetchTimeoutTally();
if (supabaseUrl) {
  globalThis.fetch = withFetchTimeout(globalThis.fetch, {
    supabaseOrigin: supabaseUrl,
    tally,
  });
}

afterAll(() => {
  const reportDir = inject(FETCH_TIMEOUT_REPORT_DIR_KEY);
  writeFileSync(
    join(reportDir, `${randomUUID()}.json`),
    JSON.stringify(tally.counts()),
  );
});
