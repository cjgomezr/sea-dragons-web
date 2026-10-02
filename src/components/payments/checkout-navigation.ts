/** Sale de la aplicación hacia Stripe Checkout (#454). Va aparte para que los
 * tests de la pantalla la doblen: jsdom no navega. */
export function openCheckout(url: string): void {
  window.location.assign(url);
}
