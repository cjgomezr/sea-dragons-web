/** Lee un texto en una ruta de un JSON que llega como unknown, sin confiar en
 * su forma: la respuesta viene de la red y podría ser cualquier cosa. Lo
 * comparten los formularios de cuentas, que leen así `error.message` y los
 * campos de `data` de la convención de la API. */
export function readStringAt(
  payload: unknown,
  path: readonly string[],
): string | null {
  let current: unknown = payload;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : null;
}
