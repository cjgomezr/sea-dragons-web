import {
  clientBundleScans,
  describeLeaks,
  scanForLeaks,
} from "./lib/client-bundle.ts";
import { readEnvironmentManifest } from "./lib/entornos-manifest.ts";

/** Revisa lo que Next.js sirve al navegador y falla si contiene el nombre de
 * una variable secreta o una clave de servidor. Corre después de
 * `npm run build`, sobre el artefacto de verdad: comprobarlo en el código
 * fuente diría qué se pretendía publicar, no qué se publicó. */
function main(): void {
  let clean = true;

  for (const scan of clientBundleScans(readEnvironmentManifest())) {
    const { filesRead, leaks } = scanForLeaks(scan);

    if (leaks.length > 0) {
      console.error(describeLeaks(scan.dir, leaks));
      clean = false;
      continue;
    }
    // Cuántos archivos se miraron, no sólo que no se encontró nada: un
    // directorio que encoge en silencio se ve igual que uno limpio.
    console.log(`${scan.dir}: ${filesRead} archivos revisados, sin secretos`);
  }

  if (!clean) {
    process.exitCode = 1;
  }
}

main();
