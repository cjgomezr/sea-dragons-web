import type Stripe from "stripe";
import checkoutSessionCompleted from "./checkout-session-completed.json";
import checkoutSessionLevyCompleted from "./checkout-session-levy-completed.json";
import checkoutSessionPackCompleted from "./checkout-session-pack-completed.json";
import customerSubscriptionDeleted from "./customer-subscription-deleted.json";
import customerSubscriptionUpdated from "./customer-subscription-updated.json";
import invoicePaid from "./invoice-paid.json";
import invoicePaymentFailed from "./invoice-payment-failed.json";
import invoiceUpcoming from "./invoice-upcoming.json";

/**
 * Eventos de ejemplo de Stripe (#452), con la forma de la versión de la API
 * del SDK. Todos son del mismo socio, cliente y suscripción, para poder
 * encadenarlos. Cada llamada devuelve una copia: un test que la cambia no
 * toca la del siguiente.
 */

export const FIXTURE_USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
export const FIXTURE_CUSTOMER_ID = "cus_TestSeadragons";
export const FIXTURE_SUBSCRIPTION_ID = "sub_TestSeadragons";
export const FIXTURE_PRICES = {
  full: "price_full_test",
  student: "price_student_test",
} as const;

/** El pack de sesiones del Checkout en modo `payment` de #471. */
export const FIXTURE_PAYMENT_INTENT_ID = "pi_TestSeadragonsPack";
export const FIXTURE_PACK_SESSIONS = 5;

/** El levy del Checkout en modo `payment` de #473. */
export const FIXTURE_LEVY_PAYMENT_INTENT_ID = "pi_TestSeadragonsLevy";
export const FIXTURE_LEVY_PRODUCT_ID = "prod_TestNationals";
export const FIXTURE_LEVY_NAME = "Nationals 2026";

/** Las claves nombran el ejemplo; el tipo del evento va dentro de cada uno. */
const FIXTURES = {
  "checkout.session.completed": checkoutSessionCompleted,
  "checkout.session.completed (pack)": checkoutSessionPackCompleted,
  "checkout.session.completed (levy)": checkoutSessionLevyCompleted,
  "customer.subscription.updated": customerSubscriptionUpdated,
  "customer.subscription.deleted": customerSubscriptionDeleted,
  "invoice.paid": invoicePaid,
  "invoice.payment_failed": invoicePaymentFailed,
  "invoice.upcoming": invoiceUpcoming,
} as const;

export type FixtureEventType = keyof typeof FIXTURES;

type EventChange = {
  readonly id?: string;
  readonly type?: string;
  readonly created?: number;
  /** Se mezcla sobre `data.object`. */
  readonly object?: Record<string, unknown>;
};

export function stripeEvent(
  fixture: FixtureEventType,
  change: EventChange = {},
): Stripe.Event {
  const base = structuredClone(FIXTURES[fixture]);
  return {
    ...base,
    ...(change.id === undefined ? {} : { id: change.id }),
    ...(change.type === undefined ? {} : { type: change.type }),
    ...(change.created === undefined ? {} : { created: change.created }),
    data: { object: { ...base.data.object, ...change.object } },
  } as unknown as Stripe.Event;
}
