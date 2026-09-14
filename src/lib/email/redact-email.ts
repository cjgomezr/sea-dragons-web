/** Lo que queda en lugar de la dirección. Los mensajes de Supabase Auth y de
 * Resend a veces la citan ("Email address ... is invalid"), y los registros
 * del servidor no son sitio para un dato personal. */
export const REDACTED_EMAIL = "<correo>";

export function redactEmail(text: string, email: string): string {
  // Reemplazar la cadena vacía sembraría la marca entre cada carácter.
  if (email === "") {
    return text;
  }
  return text.replaceAll(email, REDACTED_EMAIL);
}

/** El error listo para el registro del servidor: con su pila si la tiene, que
 * es lo que sirve para arreglarlo, y sin la dirección. */
export function describeErrorWithoutEmail(
  error: unknown,
  email: string,
): string {
  const text =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  return redactEmail(text, email);
}
