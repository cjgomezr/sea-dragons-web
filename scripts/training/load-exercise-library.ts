import { createServiceRoleClient } from "../../src/lib/supabase/service-client";
import { readSupabaseServiceRoleConfig } from "../../src/lib/supabase/config";
import { loadExerciseLibrary } from "../../src/lib/training/exercise-library-loader";
import {
  FREE_EXERCISE_DB_SHA,
  createFreeExerciseDbSource,
} from "../../src/lib/training/free-exercise-db-source";
import { createSupabaseExerciseLibraryStore } from "../../src/lib/training/supabase-exercise-library-gateways";

/**
 * `npm run training:load-library`: carga la biblioteca de free-exercise-db
 * en `training_exercises` y en Storage (#897, D12 del PRD de E35). Un script
 * y no una migración: producción reaplica las migraciones en cada merge, y
 * las fotos no caben ahí.
 *
 * Lee `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` del entorno,
 * nunca de un archivo: quien lo corre elige la base a propósito. Repetirlo
 * no duplica nada.
 */

async function main(): Promise<void> {
  const config = readSupabaseServiceRoleConfig(process.env);
  if (config.kind === "missing") {
    console.error(
      `error: faltan variables de entorno: ${config.missingKeys.join(", ")}. No se cargó nada.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Cargando free-exercise-db ${FREE_EXERCISE_DB_SHA} en ${config.url}`,
  );
  const report = await loadExerciseLibrary({
    source: createFreeExerciseDbSource(),
    store: createSupabaseExerciseLibraryStore(
      createServiceRoleClient(process.env),
    ),
    log: (line) => console.warn(line),
  });
  console.log(
    `Ejercicios: ${report.inserted} nuevos, ${report.updated} actualizados, ` +
      `${report.unchanged} sin cambios, ${report.skipped} saltados. ` +
      `Fotos: ${report.photosUploaded} subidas, ${report.photosKept} ya estaban.`,
  );
}

main().catch((error: unknown) => {
  console.error(
    `error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
