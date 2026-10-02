import Stripe from "stripe";
import type { SetupCard, StripeApi } from "./stripe-webhook";
import { type StripePrices, readCard } from "./webhook-events";

/**
 * El cliente de Stripe del servidor (#452, RF-9 del PRD de E12). Sin sus
 * variables no hay pagos, y el resto de la aplicación no se entera: quien lo
 * pide recibe `unconfigured` con lo que falta, como
 * `readSupabaseServiceRoleConfig`. La llave secreta nunca sale del servidor.
 */

export const STRIPE_SECRET_KEY_ENV = "STRIPE_SECRET_KEY";
export const STRIPE_WEBHOOK_SECRET_ENV = "STRIPE_WEBHOOK_SECRET";
export const STRIPE_PRICE_FULL_ENV = "STRIPE_PRICE_FULL";
export const STRIPE_PRICE_STUDENT_ENV = "STRIPE_PRICE_STUDENT";

const STRIPE_ENV_KEYS = [
  STRIPE_SECRET_KEY_ENV,
  STRIPE_WEBHOOK_SECRET_ENV,
  STRIPE_PRICE_FULL_ENV,
  STRIPE_PRICE_STUDENT_ENV,
] as const;

export type StripeSetup =
  | {
      readonly kind: "configured";
      readonly client: Stripe;
      readonly webhookSecret: string;
      readonly prices: StripePrices;
    }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

type Environment = Readonly<Record<string, string | undefined>>;

function readRequired(env: Environment, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

/** Si están las cuatro variables, sin crear el cliente: lo que pregunta Pagos
 * para decir que los pagos no están configurados (RF-9). */
export function isStripeConfigured(env: Environment): boolean {
  return STRIPE_ENV_KEYS.every((key) => readRequired(env, key) !== null);
}

export function createStripeSetup(env: Environment): StripeSetup {
  const missingKeys = STRIPE_ENV_KEYS.filter(
    (key) => readRequired(env, key) === null,
  );
  const secretKey = readRequired(env, STRIPE_SECRET_KEY_ENV);
  const webhookSecret = readRequired(env, STRIPE_WEBHOOK_SECRET_ENV);
  const full = readRequired(env, STRIPE_PRICE_FULL_ENV);
  const student = readRequired(env, STRIPE_PRICE_STUDENT_ENV);
  if (
    secretKey === null ||
    webhookSecret === null ||
    full === null ||
    student === null
  ) {
    return { kind: "unconfigured", missingKeys };
  }
  return {
    kind: "configured",
    client: new Stripe(secretKey),
    webhookSecret,
    prices: { full, student },
  };
}

async function readSetupCard(
  client: Stripe,
  setupIntentId: string,
): Promise<SetupCard | null> {
  const setupIntent = await client.setupIntents.retrieve(setupIntentId, {
    expand: ["payment_method"],
  });
  const paymentMethod = setupIntent.payment_method;
  if (paymentMethod === null || typeof paymentMethod === "string") {
    return null;
  }
  const card = readCard(paymentMethod);
  return card === null ? null : { paymentMethodId: paymentMethod.id, card };
}

/** Lo que el webhook pide a la API de Stripe. La suscripción viene con su
 * método de pago expandido, para no tener que pedir la tarjeta aparte. */
export function createStripeApi(client: Stripe): StripeApi {
  return {
    readSetupCard: (setupIntentId) => readSetupCard(client, setupIntentId),
    async makeDefaultPaymentMethod({
      customerId,
      subscriptionId,
      paymentMethodId,
    }) {
      await client.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
      if (subscriptionId !== null) {
        await client.subscriptions.update(subscriptionId, {
          default_payment_method: paymentMethodId,
        });
      }
    },
    async readCard(paymentMethodId) {
      return readCard(await client.paymentMethods.retrieve(paymentMethodId));
    },
    readSubscription(subscriptionId) {
      return client.subscriptions.retrieve(subscriptionId, {
        expand: ["default_payment_method"],
      });
    },
  };
}
