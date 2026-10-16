/**
 * Con qué vuelve el socio de Stripe Checkout a Pagos (#454): `ok` le dice a
 * la pantalla que espere al webhook; `cancelado`, que salió sin poner la
 * tarjeta. Vive aparte de `checkout.ts` porque la pantalla también lo lee, y
 * aquél arrastra el SDK de Stripe.
 */
export const CHECKOUT_RETURN_QUERY_PARAM = "checkout";
/** La vuelta del cambio de tarjeta (#455), otra sesión de Checkout en modo
 * `setup`: `ok` le dice a la pantalla que espere la tarjeta nueva. */
export const CARD_RETURN_QUERY_PARAM = "tarjeta";
/** La vuelta de la compra de un pack de sesiones (#471), una sesión de
 * Checkout en modo `payment`: `ok` le dice a la pantalla que espere el pago. */
export const PACK_RETURN_QUERY_PARAM = "pack";
/** La vuelta del pago de un levy (#473), otra sesión en modo `payment`. */
export const LEVY_RETURN_QUERY_PARAM = "levy";
/** Con `levy=ok` vuelven también el producto del extra pagado y cuántas
 * unidades tenía el socio al abrir Checkout (#692): la pantalla espera hasta
 * verlas subir. */
export const LEVY_PRODUCT_QUERY_PARAM = "extra";
export const LEVY_PURCHASED_BEFORE_QUERY_PARAM = "antes";
export const CHECKOUT_RETURN_VALUES = ["ok", "cancelado"] as const;
export type CheckoutReturn = (typeof CHECKOUT_RETURN_VALUES)[number];

/** Un valor desconocido o repetido no dice nada: se pinta Pagos sin más. */
export function readCheckoutReturn(
  value: string | string[] | undefined,
): CheckoutReturn | null {
  return CHECKOUT_RETURN_VALUES.find((known) => known === value) ?? null;
}

/** La vuelta del pago de un extra (#692): pagado, con el producto y las
 * unidades que el socio tenía al abrir Checkout, o cancelado. */
export type LevyReturn =
  | {
      readonly kind: "paid";
      readonly productId: string;
      readonly purchasedBefore: number;
    }
  | { readonly kind: "cancelled" };

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

const NON_NEGATIVE_INTEGER = /^\d+$/;

/** `levy=ok` sin un producto o unas unidades que se sepan leer vale tanto
 * como no haber vuelto: la pantalla no sabría qué esperar. */
export function readLevyReturn(params: SearchParams): LevyReturn | null {
  const levyReturn = readCheckoutReturn(params[LEVY_RETURN_QUERY_PARAM]);
  if (levyReturn === "cancelado") {
    return { kind: "cancelled" };
  }
  const productId = params[LEVY_PRODUCT_QUERY_PARAM];
  const purchasedBefore = params[LEVY_PURCHASED_BEFORE_QUERY_PARAM];
  if (
    levyReturn !== "ok" ||
    typeof productId !== "string" ||
    productId === "" ||
    typeof purchasedBefore !== "string" ||
    !NON_NEGATIVE_INTEGER.test(purchasedBefore)
  ) {
    return null;
  }
  return { kind: "paid", productId, purchasedBefore: Number(purchasedBefore) };
}
