import type Stripe from "stripe";
import {
  type CatalogProduct,
  type ProductCatalogSource,
  SINGLE_UNIT,
  listActiveProductsOfKind,
} from "@/lib/stripe/product-catalog";
import { toOptionCustomField } from "@/lib/stripe/product-options";
import {
  type CheckoutRequest,
  type CheckoutSessions,
  type MemberEmailGateway,
  buildCustomerParams,
  buildPaymentsReturnUrl,
  idempotencyKeyFor,
} from "./checkout";
import { LEVY_RETURN_QUERY_PARAM } from "./checkout-return";
import { type MembershipGateway, readMembership } from "./membership";

/**
 * Los levies (#473, RF-6 del PRD de E13, D4 y D8): cobros sueltos que el
 * comité crea en Stripe, como la inscripción a un torneo. Los ve y los paga
 * cualquier socio con la cuenta activa, esté o no al día, y pagarlos no toca
 * la membresía. Aquí no se escribe nada: el pago lo guarda el webhook.
 */

/** La clase de producto en Stripe y lo que el webhook busca en los
 * metadatos de la sesión para reconocer un levy. */
export const LEVY_KIND = "levy";

/** Los metadatos de la sesión que dicen hasta cuántas unidades se pudieron
 * elegir (#632). Con una sola, el webhook no tiene que preguntar cuántas. */
export const LEVY_MAX_QUANTITY_METADATA_KEY = "levy_max_quantity";

export type Levy = {
  /** El id del `Price` de Stripe: con él se pide el Checkout. */
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  /** Centavos enteros (CON-005). */
  readonly amountCents: number;
  /** Cuántas unidades se pueden elegir en un Checkout (#632, D2). */
  readonly maxQuantity: number;
  /** La suma de las unidades de los pagos cobrados. */
  readonly purchasedQuantity: number;
  readonly isPaid: boolean;
};

export type LevyStripe =
  | {
      readonly kind: "configured";
      readonly catalog: ProductCatalogSource;
      readonly sessions: CheckoutSessions;
    }
  | { readonly kind: "unconfigured" };

export type LevyGateways = {
  readonly membership: MembershipGateway;
  readonly memberEmails: MemberEmailGateway;
  readonly purchases: {
    /** Las unidades cobradas de cada producto de Stripe que el socio ya
     * compró, por id del producto. */
    findPurchasedQuantities(
      userId: string,
    ): Promise<ReadonlyMap<string, number>>;
  };
  readonly stripe: LevyStripe;
};

export type LevyListing =
  | { readonly kind: "listed"; readonly levies: readonly Levy[] }
  | { readonly kind: "refused"; readonly reason: "stripe_not_configured" };

export type LevyCheckoutRefusal =
  "stripe_not_configured" | "levy_not_found" | "levy_already_paid";

export type LevyCheckoutStart =
  | { readonly kind: "created"; readonly url: string }
  | { readonly kind: "refused"; readonly reason: LevyCheckoutRefusal };

export type LevyCheckoutRequest = CheckoutRequest & {
  readonly priceId: string;
};

type OfferedLevy = CatalogProduct & { readonly purchasedQuantity: number };

const NOTHING_PURCHASED = 0;

async function readOfferedLevies(
  gateways: Pick<LevyGateways, "purchases">,
  catalog: ProductCatalogSource,
  userId: string,
): Promise<readonly OfferedLevy[]> {
  const [products, purchasedQuantities] = await Promise.all([
    listActiveProductsOfKind(catalog, LEVY_KIND),
    gateways.purchases.findPurchasedQuantities(userId),
  ]);
  return products.map((product) => ({
    ...product,
    purchasedQuantity:
      purchasedQuantities.get(product.productId) ?? NOTHING_PURCHASED,
  }));
}

function isPurchased(levy: OfferedLevy): boolean {
  return levy.purchasedQuantity > NOTHING_PURCHASED;
}

/** Un extra de una unidad se compra una vez; uno de varias, las que quiera
 * (D2). */
function isSingleUnit(levy: CatalogProduct): boolean {
  return levy.maxQuantity === SINGLE_UNIT;
}

export async function listLevies(
  gateways: Pick<LevyGateways, "purchases" | "stripe">,
  request: { readonly userId: string },
): Promise<LevyListing> {
  const { stripe } = gateways;
  if (stripe.kind === "unconfigured") {
    return { kind: "refused", reason: "stripe_not_configured" };
  }
  const offered = await readOfferedLevies(
    gateways,
    stripe.catalog,
    request.userId,
  );
  return {
    kind: "listed",
    levies: offered.map((levy) => ({
      id: levy.priceId,
      name: levy.name,
      description: levy.description,
      amountCents: levy.amountCents,
      maxQuantity: levy.maxQuantity,
      purchasedQuantity: levy.purchasedQuantity,
      isPaid: isPurchased(levy),
    })),
  };
}

/** El cliente que ya tiene en Stripe o su correo, como en las demás
 * compras. Quien no tiene membresía paga igual con su correo (D4). */
async function buildLevyCustomerParams(
  gateways: LevyGateways,
  request: LevyCheckoutRequest,
): Promise<
  Pick<Stripe.Checkout.SessionCreateParams, "customer" | "customer_email">
> {
  const reading = await readMembership(gateways.membership, request);
  if (reading.kind === "none") {
    return {
      customer_email: await gateways.memberEmails.findEmail(request.userId),
    };
  }
  return buildCustomerParams(reading.membership, gateways.memberEmails);
}

/** De varias unidades, el socio elige cuántas en Checkout. */
function buildLevyLineItem(
  levy: CatalogProduct,
): Stripe.Checkout.SessionCreateParams.LineItem {
  const lineItem = { price: levy.priceId, quantity: SINGLE_UNIT };
  return isSingleUnit(levy)
    ? lineItem
    : {
        ...lineItem,
        adjustable_quantity: {
          enabled: true,
          minimum: SINGLE_UNIT,
          maximum: levy.maxQuantity,
        },
      };
}

/** El nombre va en los metadatos para que el historial diga qué se pagó sin
 * volver a preguntarle a Stripe por el producto. */
async function buildSessionParams(
  levy: CatalogProduct,
  gateways: LevyGateways,
  request: LevyCheckoutRequest,
): Promise<Stripe.Checkout.SessionCreateParams> {
  return {
    mode: "payment",
    line_items: [buildLevyLineItem(levy)],
    ...(levy.options === null
      ? {}
      : { custom_fields: [toOptionCustomField(levy.options)] }),
    client_reference_id: request.userId,
    ...(await buildLevyCustomerParams(gateways, request)),
    metadata: {
      user_id: request.userId,
      kind: LEVY_KIND,
      levy_product_id: levy.productId,
      levy_name: levy.name,
      [LEVY_MAX_QUANTITY_METADATA_KEY]: String(levy.maxQuantity),
    },
    success_url: buildPaymentsReturnUrl(
      request.origin,
      LEVY_RETURN_QUERY_PARAM,
      "ok",
    ),
    cancel_url: buildPaymentsReturnUrl(
      request.origin,
      LEVY_RETURN_QUERY_PARAM,
      "cancelado",
    ),
  };
}

/** Quien vuelve a comprar un extra dentro de la ventana de idempotencia
 * tiene que abrir otra sesión, no recibir la que ya pagó. Lo que cambia entre
 * las dos es cuántas unidades lleva compradas. */
function levyIdempotencyKey(
  params: Stripe.Checkout.SessionCreateParams,
  levy: OfferedLevy,
  now: Date,
): string {
  return idempotencyKeyFor(
    {
      ...params,
      metadata: {
        ...params.metadata,
        purchased_quantity: String(levy.purchasedQuantity),
      },
    },
    now,
  );
}

export async function startLevyCheckout(
  gateways: LevyGateways,
  request: LevyCheckoutRequest,
): Promise<LevyCheckoutStart> {
  const { stripe } = gateways;
  if (stripe.kind === "unconfigured") {
    return { kind: "refused", reason: "stripe_not_configured" };
  }
  const offered = await readOfferedLevies(
    gateways,
    stripe.catalog,
    request.userId,
  );
  const levy = offered.find(({ priceId }) => priceId === request.priceId);
  if (levy === undefined) {
    return { kind: "refused", reason: "levy_not_found" };
  }
  if (isSingleUnit(levy) && isPurchased(levy)) {
    return { kind: "refused", reason: "levy_already_paid" };
  }
  const params = await buildSessionParams(levy, gateways, request);
  const session = await stripe.sessions.create(params, {
    idempotencyKey: levyIdempotencyKey(params, levy, request.now),
  });
  if (session.url === null) {
    throw new Error(
      `Stripe creó la sesión de Checkout del levy de ${request.userId} sin dirección.`,
    );
  }
  return { kind: "created", url: session.url };
}
