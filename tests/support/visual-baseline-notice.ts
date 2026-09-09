/** La única plataforma con línea base versionada y revisada (issue #58). */
export const BINDING_PLATFORM: NodeJS.Platform = "linux";

/**
 * Sólo Linux compara contra la línea base vinculante (la que CI regenera y
 * commitea; issue #58). En cualquier otra plataforma no hay una línea base
 * versionada: Playwright crea una la primera vez y compara contra ella en
 * corridas siguientes, pero es local y nadie la revisó, así que el
 * resultado es sólo informativo. Devuelve `null` cuando no hace falta avisar.
 */
export function visualBaselineNotice(platform: NodeJS.Platform): string | null {
  if (platform === BINDING_PLATFORM) {
    return null;
  }
  return (
    `⚠ Capturas locales (${platform}): informativas, no vinculantes. ` +
    "La comparación que cuenta corre en CI sobre Linux tras abrir el PR " +
    "(ver .github/workflows/visual-baselines.yml).\n" +
    "  La primera corrida de un checkout limpio no tiene con qué comparar: " +
    "crea las capturas que falten, lo dice una por una y no falla por ello."
  );
}

/**
 * Lo que se imprime cuando una captura no existía y se acaba de escribir.
 *
 * El aviso existe porque los dos casos se confundían: 16 capturas recién
 * creadas en un checkout limpio se leían como 16 regresiones visuales, y el
 * remedio (correr Playwright dos veces) no estaba escrito en ninguna parte
 * (issue #96).
 */
export function snapshotCreatedNotice(name: string): string {
  return (
    `ℹ Captura creada por primera vez: ${name}. No es una regresión: ` +
    "no había línea base local con la que comparar. La siguiente corrida ya " +
    "compara contra ella."
  );
}
