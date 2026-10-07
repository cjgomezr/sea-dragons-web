/**
 * Guarda en el equipo un archivo que no viene de navegar: el CSV del
 * directorio (#500) y el de quién pagó un levy (#531).
 */

/** Un enlace que nadie ve, pulsado una vez: es como el navegador guarda un
 * archivo que no viene de navegar. */
export function saveFile(file: Blob, filename: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Después del clic y no en él: algún navegador cancela la descarga si la
  // dirección desaparece antes de que empiece.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
