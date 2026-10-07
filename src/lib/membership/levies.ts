import type Stripe from "stripe";
import {
  type CatalogProduct,
  type ProductCatalogSource,
  listActiveProductsOfKind,
} from "@/lib/stripe/product-catalog";
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

export type Levy = {
  /** El id del `Price` de Stripe: con él se pide el Checkout. */
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  /** Centavos enteros (CON-005). */
  readonly amountCents: number;
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
  readonly paidProducts: {
    /** Los productos de Stripe de los pagos que el socio ya hizo. */
    findPaidProductIds(userId: string): Promise<ReadonlySet<string>>;
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

type OfferedLevy = CatalogProduct & { readonly isPaid: boolean };

async function readOfferedLevies(
  gateways: Pick<LevyGateways, "paidProducts">,
  catalog: ProductCatalogSource,
  userId: string,
): Promise<readonly OfferedLevy[]> {
  const [products, paidProductIds] = await Promise.all([
    listActiveProductsOfKind(catalog, LEVY_KIND),
    gateways.paidProducts.findPaidProductIds(userId),
  ]);
  return products.map((product) => ({
    ...product,
    isPaid: paidProductIds.has(product.productId),
  }));
}

export async function listLevies(
  gateways: Pick<LevyGateways, "paidProducts" | "stripe">,
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
      isPaid: levy.isPaid,
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

/** El nombre va en los metadatos para que el historial diga qué se pagó sin
 * volver a preguntarle a Stripe por el producto. */
async function buildSessionParams(
  levy: CatalogProduct,
  gateways: LevyGateways,
  request: LevyCheckoutRequest,
): Promise<Stripe.Checkout.SessionCreateParams> {
  return {
    mode: "payment",
    line_items: [{ price: levy.priceId, quantity: 1 }],
    client_reference_id: request.userId,
    ...(await buildLevyCustomerParams(gateways, request)),
    metadata: {
      user_id: request.userId,
      kind: LEVY_KIND,
      levy_product_id: levy.productId,
      levy_name: levy.name,
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
  if (levy.isPaid) {
    return { kind: "refused", reason: "levy_already_paid" };
  }
  const params = await buildSessionParams(levy, gateways, request);
  const session = await stripe.sessions.create(params, {
    idempotencyKey: idempotencyKeyFor(params, request.now),
  });
  if (session.url === null) {
    throw new Error(
      `Stripe creó la sesión de Checkout del levy de ${request.userId} sin dirección.`,
    );
  }
  return { kind: "created", url: session.url };
}
