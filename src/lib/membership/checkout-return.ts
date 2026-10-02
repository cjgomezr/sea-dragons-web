/**
 * Con qué vuelve el socio de Stripe Checkout a Pagos (#454): `ok` le dice a
 * la pantalla que espere al webhook; `cancelado`, que salió sin poner la
 * tarjeta. Vive aparte de `checkout.ts` porque la pantalla también lo lee, y
 * aquél arrastra el SDK de Stripe.
 */
export const CHECKOUT_RETURN_QUERY_PARAM = "checkout";
export const CHECKOUT_RETURN_VALUES = ["ok", "cancelado"] as const;
export type CheckoutReturn = (typeof CHECKOUT_RETURN_VALUES)[number];

/** Un valor desconocido o repetido no dice nada: se pinta Pagos sin más. */
export function readCheckoutReturn(
  value: string | string[] | undefined,
): CheckoutReturn | null {
  return CHECKOUT_RETURN_VALUES.find((known) => known === value) ?? null;
}
