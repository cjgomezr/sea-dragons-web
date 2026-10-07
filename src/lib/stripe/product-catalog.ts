import type Stripe from "stripe";

/**
 * Los productos que el club crea en Stripe para venderlos sueltos (#473,
 * INT-007, D8 del PRD de E13): activos, con `metadata.seadragons_kind` igual a
 * una clase y un precio por defecto de pago único en AUD. Los levies son la
 * clase `levy`; otra clase de producto reutiliza esto sin tocarlo. Puro: quién
 * le pide los productos a Stripe es de `stripe-client.ts`.
 */

/** La marca que el comité pone en el producto, en el panel de Stripe. */
export const PRODUCT_KIND_METADATA_KEY = "seadragons_kind";

/** El club cobra en dólares australianos (CON-005). */
const CLUB_CURRENCY = "aud";

/** Los productos activos de la cuenta, con su precio por defecto expandido.
 * Sin expandir, el precio llega como id y el producto no se puede vender. */
export type ProductCatalogSource = {
  listActiveProducts(): Promise<readonly Stripe.Product[]>;
};

export type CatalogProduct = {
  readonly productId: string;
  readonly priceId: string;
  readonly name: string;
  readonly description: string | null;
  /** Centavos enteros, como los manda Stripe (CON-005). */
  readonly amountCents: number;
};

function readOneTimeClubPrice(
  product: Stripe.Product,
): { readonly id: string; readonly amountCents: number } | null {
  const price = product.default_price;
  if (
    price === null ||
    price === undefined ||
    typeof price === "string" ||
    !price.active ||
    price.type !== "one_time" ||
    price.currency !== CLUB_CURRENCY ||
    price.unit_amount === null
  ) {
    return null;
  }
  return { id: price.id, amountCents: price.unit_amount };
}

function toCatalogProduct(
  product: Stripe.Product,
  kind: string,
): CatalogProduct | null {
  if (!product.active || product.metadata[PRODUCT_KIND_METADATA_KEY] !== kind) {
    return null;
  }
  const price = readOneTimeClubPrice(product);
  if (price === null) {
    return null;
  }
  return {
    productId: product.id,
    priceId: price.id,
    name: product.name,
    description: product.description,
    amountCents: price.amountCents,
  };
}

export async function listActiveProductsOfKind(
  source: ProductCatalogSource,
  kind: string,
): Promise<readonly CatalogProduct[]> {
  const products = await source.listActiveProducts();
  return products.flatMap((product) => {
    const listed = toCatalogProduct(product, kind);
    return listed === null ? [] : [listed];
  });
}
