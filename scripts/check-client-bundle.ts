import {
  CLIENT_BUNDLE_DIR,
  describeLeaks,
  findClientBundleLeaks,
  forbiddenNeedles,
} from "./lib/client-bundle.ts";
import { readEnvironmentManifest } from "./lib/entornos-manifest.ts";

/** Revisa el JavaScript que Next.js sirve al navegador y falla si contiene el
 * nombre de una variable secreta o una clave de servidor. Corre después de
 * `npm run build`, sobre el artefacto de verdad: comprobarlo en el código
 * fuente diría qué se pretendía, no qué se publicó. */
function main(): void {
  const leaks = findClientBundleLeaks({
    bundleDir: CLIENT_BUNDLE_DIR,
    needles: forbiddenNeedles(readEnvironmentManifest()),
  });

  if (leaks.length > 0) {
    console.error(describeLeaks(leaks));
    process.exitCode = 1;
    return;
  }
  console.log(
    `bundle de cliente limpio: ninguna variable secreta en ${CLIENT_BUNDLE_DIR}`,
  );
}

main();
