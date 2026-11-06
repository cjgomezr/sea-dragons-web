/**
 * El último ciclo que eligió el socio en Entrenamiento (#981, D7 de E38),
 * guardado en el dispositivo y no en la base: perderlo sólo cuesta volver a
 * elegir. Va por cuenta para que dos personas en el mismo navegador no se
 * pisen; el id de la cuenta es único en todos los clubes, así que basta.
 *
 * El almacenamiento puede no estar (modo privado, cuota llena, bloqueado).
 * Recordar es una comodidad: sin él la pantalla funciona igual, y por eso
 * cada fallo se trata como "no hay nada guardado".
 */

const STORAGE_KEY_PREFIX = "seadragons:training-cycle:";

export type CycleChoiceStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

function storageKeyOf(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

/** El `localStorage` del navegador; nulo en el servidor o si leerlo ya
 * falla. */
export function browserCycleChoiceStorage(): CycleChoiceStorage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readSavedCycleChoice(
  storage: CycleChoiceStorage | null,
  userId: string,
): string | null {
  try {
    return storage?.getItem(storageKeyOf(userId)) ?? null;
  } catch {
    return null;
  }
}

export function saveCycleChoice(
  storage: CycleChoiceStorage | null,
  choice: { readonly userId: string; readonly cycleId: string },
): void {
  try {
    storage?.setItem(storageKeyOf(choice.userId), choice.cycleId);
  } catch {
    // Sin almacenamiento se elige igual; sólo no se recuerda.
  }
}

/** Para una elección que ya no ve: archivada, o salió del grupo. */
export function forgetCycleChoice(
  storage: CycleChoiceStorage | null,
  userId: string,
): void {
  try {
    storage?.removeItem(storageKeyOf(userId));
  } catch {
    // Lo mismo que al guardar: nada que recordar, nada que olvidar.
  }
}
