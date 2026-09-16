/** Lo que queda en lugar de la dirección. Los mensajes de Supabase Auth y de
 * Resend a veces la citan ("Email address ... is invalid"), y los registros
 * del servidor no son sitio para un dato personal. */
export const REDACTED_EMAIL = "<correo>";

const REGEXP_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g;

/** La dirección como texto literal: un punto o un `+` son corrientes en un
 * correo, y dentro de un patrón significarían otra cosa. */
function escapeForPattern(text: string): string {
  return text.replace(REGEXP_SPECIAL_CHARACTERS, "\\$&");
}

/** Quita del texto la dirección, la escriba como la escriba. Las direcciones
 * no distinguen mayúsculas y las rutas las normalizan antes de dárselas a
 * Supabase, así que el mensaje del proveedor puede citarla con otra caja que
 * la que llegó en el cuerpo. */
export function redactEmail(text: string, email: string): string {
  const address = email.trim();
  // Reemplazar la cadena vacía sembraría la marca entre cada carácter.
  if (address === "") {
    return text;
  }
  return text.replace(
    new RegExp(escapeForPattern(address), "gi"),
    REDACTED_EMAIL,
  );
}

/** Cuántas causas se siguen. Una cadena real rara vez pasa de tres niveles, y
 * el tope evita colgarse con una causa que apunta a sí misma. */
const MAX_CAUSE_DEPTH = 5;

/** El error con sus causas. Un fallo de red de Resend dice sólo "fetch
 * failed"; el motivo real (`ECONNRESET`, un timeout, el DNS) está dos causas
 * más abajo, y sin él no hay nada que diagnosticar. */
function describeErrorChain(error: unknown, depth = 0): string {
  const text =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause === undefined || cause === null || depth + 1 >= MAX_CAUSE_DEPTH) {
    return text;
  }
  return `${text}\nCausado por: ${describeErrorChain(cause, depth + 1)}`;
}

/** El error listo para el registro del servidor: con su pila y sus causas, que
 * es lo que sirve para arreglarlo, y sin la dirección. */
export function describeErrorWithoutEmail(
  error: unknown,
  email: string,
): string {
  return redactEmail(describeErrorChain(error), email);
}
