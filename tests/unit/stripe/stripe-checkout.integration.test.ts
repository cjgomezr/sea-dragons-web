// @vitest-environment node
import { describe, expect, it } from "vitest";
import { startCheckout } from "@/lib/membership/checkout";
import type { MembershipRecord } from "@/lib/membership/membership";
import { createStripeSetup } from "@/lib/stripe/stripe-client";

/**
 * Checkout contra la cuenta de Stripe del club en modo de prueba (#454). Crea
 * una sesión de verdad con el dominio y lee de Stripe los parámetros con los
 * que quedó. La base va doblada: lo que se prueba es que Stripe acepta lo que
 * se le pide. Sin llaves de prueba se salta con aviso; con una llave real no
 * corre nunca, para no abrir sesiones en la cuenta de producción.
 */

const TEST_MODE_KEY_PREFIX = "sk_test_";
const ORIGIN = "http://localhost:3417";
const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const NETWORK_TEST_TIMEOUT_MS = 30_000;

const stripe = createStripeSetup(process.env);
const isTestMode =
  stripe.kind === "configured" &&
  (process.env.STRIPE_SECRET_KEY ?? "").startsWith(TEST_MODE_KEY_PREFIX);
if (!isTestMode) {
  console.warn(
    "⚠ Checkout contra Stripe: test saltado, faltan las llaves de prueba de Stripe",
  );
}

const PENDING_FULL: MembershipRecord = {
  userId: USER_ID,
  clubId: "c1ab0000-0000-4000-8000-000000000001",
  plan: "Full",
  status: "pending",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  currentPeriodEnd: null,
  trialEnd: null,
  card: null,
  waiver: null,
  scheduledChange: null,
};

/** La dirección de Checkout lleva el id de la sesión en la ruta. */
function sessionIdFrom(url: string): string {
  const id = new URL(url).pathname
    .split("/")
    .find((segment) => segment.startsWith("cs_"));
  if (id === undefined) {
    throw new Error(`La dirección de Checkout no lleva el id: ${url}`);
  }
  return id;
}

describe.skipIf(!isTestMode)("Checkout en Stripe (modo de prueba)", () => {
  it(
    "Stripe acepta la sesión: suscripción, tarjeta obligatoria, el socio y el precio del plan",
    async () => {
      if (stripe.kind !== "configured") {
        throw new Error("unreachable: describe.skipIf ya saltó la suite");
      }
      const outcome = await startCheckout(
        {
          membership: { findByUserId: async () => PENDING_FULL },
          memberEmails: {
            findEmail: async () => "checkout-integracion@example.com",
          },
          stripe: {
            kind: "configured",
            prices: stripe.prices,
            sessions: stripe.client.checkout.sessions,
          },
        },
        { userId: USER_ID, origin: ORIGIN, now: new Date() },
      );
      if (outcome.kind !== "created") {
        throw new Error(`Checkout rechazado: ${outcome.reason}`);
      }
      const session = await stripe.client.checkout.sessions.retrieve(
        sessionIdFrom(outcome.url),
        { expand: ["line_items"] },
      );

      try {
        expect(session).toMatchObject({
          mode: "subscription",
          payment_method_collection: "always",
          client_reference_id: USER_ID,
          customer_email: "checkout-integracion@example.com",
          success_url: `${ORIGIN}/pagos?checkout=ok`,
          cancel_url: `${ORIGIN}/pagos?checkout=cancelado`,
        });
        expect(session.line_items?.data[0]?.price?.id).toBe(stripe.prices.full);
      } finally {
        await stripe.client.checkout.sessions.expire(session.id);
      }
    },
    NETWORK_TEST_TIMEOUT_MS,
  );
});
