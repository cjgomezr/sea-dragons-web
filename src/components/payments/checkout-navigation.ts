/** Sale de la aplicación hacia Stripe Checkout (#454). Va aparte para que los
 * tests de la pantalla la doblen: jsdom no navega. */
export function openCheckout(url: string): void {
  window.location.assign(url);
}

/** Abre el recibo de Stripe de un pago (#630, #631) en una pestaña nueva, sin
 * dejar a esa página tocar la de Pagos (`noopener`). */
export function openReceipt(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.click();
}
