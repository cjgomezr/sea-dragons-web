/** Ruta pública del registro y del aterrizaje del enlace de confirmación. La
 * comparten la ruta que canjea el enlace y la pantalla que muestra el
 * resultado, para que no se puedan desincronizar. */
export const REGISTRATION_PATH = "/registro";

export const CONFIRMATION_QUERY_PARAM = "confirmacion";

/**
 * - ok: el correo quedó confirmado y la cuenta pasó a activa.
 * - pendiente: el correo quedó confirmado pero a la cuenta le falta algo más.
 * - invalida: el enlace caducó, ya se usó o no es de aquí.
 * - error: el servidor no pudo resolverlo, y no es culpa del enlace.
 */
export const CONFIRMATION_STATES = [
  "ok",
  "pendiente",
  "invalida",
  "error",
] as const;

export type ConfirmationState = (typeof CONFIRMATION_STATES)[number];

/** Estrecha lo que venga en la URL. Un valor desconocido no es un estado: la
 * pantalla muestra el formulario, no un panel inventado. */
export function parseConfirmationState(
  value: string | readonly string[] | undefined,
): ConfirmationState | null {
  if (typeof value !== "string") {
    return null;
  }
  return CONFIRMATION_STATES.find((state) => state === value) ?? null;
}

export function registrationPathWithConfirmation(
  state: ConfirmationState,
): string {
  return `${REGISTRATION_PATH}?${CONFIRMATION_QUERY_PARAM}=${state}`;
}
