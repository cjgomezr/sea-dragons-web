/** Ejecuta `run` y siempre intenta `cleanup` después, sin dejar que un fallo
 * de limpieza tape la razón real por la que `run` falló: si las dos fallan,
 * la de `run` es la que se relanza y la de limpieza queda registrada aparte.
 * `cleanup` devuelve el mensaje de su fallo, o `null` si limpió. */
export async function runWithCleanup<T>(
  run: () => Promise<T>,
  cleanup: () => Promise<string | null>,
  cleanupFailureMessage: string,
): Promise<T> {
  let result: T;
  try {
    result = await run();
  } catch (runError) {
    const cleanupFailure = await cleanup();
    if (cleanupFailure !== null) {
      console.error(`${cleanupFailureMessage}: ${cleanupFailure}`);
    }
    throw runError;
  }

  const cleanupFailure = await cleanup();
  if (cleanupFailure !== null) {
    throw new Error(`${cleanupFailureMessage}: ${cleanupFailure}`);
  }
  return result;
}
