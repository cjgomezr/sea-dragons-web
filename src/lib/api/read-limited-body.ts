/** El cuerpo de una petición, o la señal de que pasaba del límite. */
export type LimitedBody =
  | { readonly kind: "complete"; readonly bytes: Uint8Array }
  | { readonly kind: "too_large" };

function concatenate(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Lee el cuerpo en binario y deja de leer en cuanto pasa de `maxBytes`, en
 * vez de cargarlo entero en memoria para medirlo después. No se fía de
 * `Content-Length`: la cabecera la escribe quien llama. */
export async function readLimitedBody(
  request: Request,
  maxBytes: number,
): Promise<LimitedBody> {
  if (request.body === null) {
    return { kind: "complete", bytes: new Uint8Array(0) };
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return { kind: "complete", bytes: concatenate(chunks, total) };
    }
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      return { kind: "too_large" };
    }
    chunks.push(value);
  }
}
