/** Lleva el navegador a la dirección firmada de un adjunto. La firma trae el
 * nombre del archivo como descarga (#328), así que el navegador lo guarda en
 * vez de abandonar la pantalla. Vive aparte porque es el único efecto sobre
 * `window` de la sección, y los tests lo sustituyen. */
export function startDownload(url: string): void {
  window.location.assign(url);
}
