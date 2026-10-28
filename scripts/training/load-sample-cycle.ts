import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "../../src/lib/supabase/service-client";
import { readSupabaseServiceRoleConfig } from "../../src/lib/supabase/config";
import { buildSampleCyclePlan } from "../../src/lib/training/sample-cycle";
import {
  createSampleCycleGateways,
  loadSampleCycle,
} from "../../src/lib/training/sample-cycle-loader";

/**
 * `npm run training:load-sample -- <correo>`: carga el plan de muestra de UWR
 * como un ciclo en borrador del club de quien firma el correo, un Admin o un
 * Coach (#912, RF-13 y D16 del PRD de E35). Todo queda a su nombre en la
 * bitácora, como si lo hubiera escrito en Planificar. Activarlo lo hace el
 * Coach desde ahí.
 *
 * Lee `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` del entorno,
 * nunca de un archivo: quien lo corre elige la base a propósito. Repetirlo
 * no duplica nada: si el club ya tiene el ciclo, lo dice y no toca nada. Si
 * una corrida se corta a medias, el borrador queda incompleto: archívalo y
 * renómbralo en Planificar antes de volver a correrlo.
 */

const SAMPLE_PATH = path.join(
  process.cwd(),
  "docs/design/design_handoff_training/muestra/plan-uwr-sep-2026.json",
);

/** El usuario de Auth del socio con ese correo. Uno solo: con el correo en
 * dos clubes no se sabe a cuál cargarlo. */
async function findCallerId(
  serviceClient: SupabaseClient,
  email: string,
): Promise<string> {
  const { data, error } = await serviceClient
    .from("members")
    .select("user_id")
    .eq("email", email);
  if (error) {
    throw new Error(`No se pudo buscar al socio ${email}: ${error.message}`);
  }
  const accounts = data.flatMap((row) =>
    row.user_id === null ? [] : [String(row.user_id)],
  );
  const [callerId] = accounts;
  if (callerId === undefined || accounts.length > 1) {
    throw new Error(
      `Hay ${accounts.length} socios con cuenta y el correo ${email}; tiene que haber uno.`,
    );
  }
  return callerId;
}

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (email === undefined || email === "") {
    console.error(
      "error: falta el correo del Admin o Coach. Uso: npm run training:load-sample -- <correo>",
    );
    process.exitCode = 1;
    return;
  }
  const config = readSupabaseServiceRoleConfig(process.env);
  if (config.kind === "missing") {
    console.error(
      `error: faltan variables de entorno: ${config.missingKeys.join(", ")}. No se cargó nada.`,
    );
    process.exitCode = 1;
    return;
  }

  const plan = buildSampleCyclePlan(
    JSON.parse(await readFile(SAMPLE_PATH, "utf8")),
  );
  const serviceClient = createServiceRoleClient(process.env);
  const callerId = await findCallerId(serviceClient, email);
  console.log(`Cargando "${plan.cycle.name}" en ${config.url}`);
  const report = await loadSampleCycle(
    createSampleCycleGateways(serviceClient),
    { callerId, plan },
  );
  if (report.kind === "already_loaded") {
    console.log(
      `El club ya tiene "${plan.cycle.name}" (${report.cycleId}). No se cargó nada.`,
    );
    return;
  }
  console.log(
    `Ciclo ${report.cycleId} en borrador: ${report.routines} rutinas, ` +
      `${report.days} días con sesión. Marcas nuevas: ${report.marksCreated}. ` +
      `Ejercicios del club nuevos: ${report.exercisesCreated}.`,
  );
}

main().catch((error: unknown) => {
  console.error(
    `error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
