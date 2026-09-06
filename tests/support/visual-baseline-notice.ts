const BINDING_PLATFORM: NodeJS.Platform = "linux";

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
    "(ver .github/workflows/visual-baselines.yml)."
  );
}
