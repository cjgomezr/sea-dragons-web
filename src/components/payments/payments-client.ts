import { z } from "zod";
import {
  type ApiRequestFailure,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import {
  CLUB_SESSION_PACKS_API_PATH,
  LEVIES_API_PATH,
  LEVY_CHECKOUT_API_PATH,
  LEVY_PAYERS_API_PATH,
  MEMBERSHIP_API_PATH,
  MEMBERSHIP_CARD_API_PATH,
  MEMBERSHIP_CHECKOUT_API_PATH,
  MEMBERSHIP_PLAN_API_PATH,
  MEMBERSHIP_RETRY_PAYMENT_API_PATH,
  MEMBERSHIP_SESSION_PACK_CHECKOUT_API_PATH,
} from "@/lib/auth/routes";
import { MEMBERSHIP_TYPES } from "@/lib/auth/registration";
import type { SessionPackOffers } from "@/lib/club/session-packs";
import type { Translator } from "@/lib/i18n/translator";
import {
  MEMBERSHIP_STATUSES,
  type MembershipPlan,
} from "@/lib/membership/membership";
import {
  type MembershipView,
  PAYMENT_STATUSES,
} from "@/lib/membership/membership-view";
import type { Levy } from "@/lib/membership/levies";
import type { LevyPayersReport } from "@/lib/membership/levy-payers";
import type { ClubPrice } from "@/lib/membership/stripe-prices";

/**
 * Lo que Pagos (#454, #455) pide a los endpoints de la membresía: el panel,
 * abrir Checkout para suscribirse o para cambiar la tarjeta, y volver a leer
 * el estado mientras espera el webhook. Son los mismos caminos que usará la
 * aplicación nativa de Release 2 (CON-002).
 */

const isoInstantSchema = z.iso.datetime({ offset: true });

const calendarDaySchema = z.iso.date();

const sessionMovementSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pack_purchase"),
    id: z.string(),
    sessions: z.number().int().positive(),
    date: isoInstantSchema,
  }),
  z.object({
    kind: z.literal("attendance"),
    id: z.string(),
    sessions: z.literal(-1),
    date: isoInstantSchema,
    training: z
      .object({ title: z.string(), startsOn: calendarDaySchema })
      .nullable(),
  }),
]);

const membershipViewSchema = z.object({
  paymentsConfigured: z.boolean(),
  membership: z
    .object({
      plan: z.enum(MEMBERSHIP_TYPES).nullable(),
      status: z.enum(MEMBERSHIP_STATUSES),
      monthlyPriceCents: z.number().int().nullable(),
      trialEnd: isoInstantSchema.nullable(),
      nextChargeAt: isoInstantSchema.nullable(),
      card: z
        .object({
          brand: z.string(),
          last4: z.string(),
          expMonth: z.number().int(),
          expYear: z.number().int(),
        })
        .nullable(),
      waiver: z
        .object({ reason: z.string(), until: isoInstantSchema.nullable() })
        .nullable(),
      scheduledChange: z
        .object({
          plan: z.enum(MEMBERSHIP_TYPES),
          effectiveAt: isoInstantSchema,
        })
        .nullable(),
      canChangePlan: z.boolean(),
      planPrices: z.object({
        Full: z.number().int().nullable(),
        Student: z.number().int().nullable(),
      }),
      canChoosePlan: z.boolean(),
      casualSessionPriceCents: z.number().int().nullable(),
      subscriptionEndsAt: isoInstantSchema.nullable(),
    })
    .nullable(),
  payments: z.array(
    z.object({
      id: z.string(),
      date: isoInstantSchema,
      description: z.string().nullable(),
      amountCents: z.number().int(),
      status: z.enum(PAYMENT_STATUSES),
    }),
  ),
  sessionBalance: z.object({
    sessions: z.number().int(),
    movements: z.array(sessionMovementSchema),
  }),
});

const membershipResponseSchema = z.object({ data: membershipViewSchema });

const stripeSessionResponseSchema = z.object({
  data: z.object({ url: z.url() }),
});

const planChangeResponseSchema = z.object({
  data: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("scheduled"),
      plan: z.enum(MEMBERSHIP_TYPES),
      effectiveAt: isoInstantSchema,
    }),
    z.object({ kind: z.literal("checkout"), url: z.url() }),
  ]),
});

const planChangeCancellationResponseSchema = z.object({
  data: z.object({ scheduledChange: z.null() }),
});

export type PaymentsFailure = ApiRequestFailure;

export type MembershipViewLoad =
  { readonly kind: "loaded"; readonly view: MembershipView } | PaymentsFailure;

/** Una sesión de Stripe Checkout abierta, para suscribirse o para cambiar la
 * tarjeta. */
export type StripeSessionOutcome =
  { readonly kind: "created"; readonly url: string } | PaymentsFailure;

/** La membresía de quien mira. Nunca rechaza: un fallo de red sale como
 * fallo. */
export async function loadMembershipView(): Promise<MembershipViewLoad> {
  const read = readApiPayload(
    await requestApi(MEMBERSHIP_API_PATH),
    membershipResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", view: read.value.data };
}

async function requestStripeSession(
  path: string,
): Promise<StripeSessionOutcome> {
  const read = readApiPayload(
    await requestApi(path, { method: "POST" }),
    stripeSessionResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "created", url: read.value.data.url };
}

export function requestCheckout(): Promise<StripeSessionOutcome> {
  return requestStripeSession(MEMBERSHIP_CHECKOUT_API_PATH);
}

export function requestCardUpdate(): Promise<StripeSessionOutcome> {
  return requestStripeSession(MEMBERSHIP_CARD_API_PATH);
}

/** La página de Stripe de la factura abierta, para reintentar un cobro
 * fallido (#474). No es Checkout, pero se abre igual: dejando la aplicación. */
export function requestPaymentRetry(): Promise<StripeSessionOutcome> {
  return requestStripeSession(MEMBERSHIP_RETRY_PAYMENT_API_PATH);
}

/** Abre Checkout para pagar un pack de `sessions` sesiones (#471). */
export async function requestSessionPackCheckout(
  sessions: number,
): Promise<StripeSessionOutcome> {
  const read = readApiPayload(
    await requestApi(MEMBERSHIP_SESSION_PACK_CHECKOUT_API_PATH, {
      method: "POST",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify({ sessions }),
    }),
    stripeSessionResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "created", url: read.value.data.url };
}

const clubPriceSchema: z.ZodType<ClubPrice> = z.union([
  z.object({ amountCents: z.number().int(), currency: z.literal("AUD") }),
  z.object({
    amountCents: z.null(),
    reason: z.enum(["not_configured", "stripe_unavailable", "misconfigured"]),
  }),
]);

const sessionPacksResponseSchema = z.object({
  data: z.object({
    packs: z.array(
      z.object({ sessions: z.number().int(), price: clubPriceSchema }),
    ),
  }),
});

export type SessionPackOffersLoad =
  | { readonly kind: "loaded"; readonly packs: SessionPackOffers }
  | PaymentsFailure;

/** Los packs que el club ofrece, con el precio de cada uno (#469). */
export async function loadSessionPackOffers(): Promise<SessionPackOffersLoad> {
  const read = readApiPayload(
    await requestApi(CLUB_SESSION_PACKS_API_PATH),
    sessionPacksResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", packs: read.value.data.packs };
}

const leviesResponseSchema = z.object({
  data: z.object({
    levies: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        amountCents: z.number().int(),
        isPaid: z.boolean(),
      }),
    ),
  }),
});

export type LeviesLoad =
  | { readonly kind: "loaded"; readonly levies: readonly Levy[] }
  | PaymentsFailure;

/** Los levies que el comité creó en Stripe, con los que ya pagó (#473). */
export async function loadLevies(): Promise<LeviesLoad> {
  const read = readApiPayload(
    await requestApi(LEVIES_API_PATH),
    leviesResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", levies: read.value.data.levies };
}

const levyMemberSchema = {
  userId: z.string(),
  fullName: z.string(),
  email: z.string(),
};

const levyPayersResponseSchema = z.object({
  data: z.object({
    levy: z.object({
      id: z.string(),
      name: z.string(),
      amountCents: z.number().int(),
    }),
    summary: z.object({
      paidCount: z.number().int(),
      missingCount: z.number().int(),
      collectedCents: z.number().int(),
    }),
    payers: z.array(
      z.object({
        ...levyMemberSchema,
        paidAt: isoInstantSchema,
        amountCents: z.number().int(),
      }),
    ),
    missing: z.array(z.object(levyMemberSchema)),
  }),
});

export type LevyPayersLoad =
  | { readonly kind: "loaded"; readonly report: LevyPayersReport }
  | PaymentsFailure;

/** Quién pagó el levy del precio `priceId` y quién falta (#531). Sólo lo
 * responde a un Admin o a un Committee. */
export async function loadLevyPayers(priceId: string): Promise<LevyPayersLoad> {
  const read = readApiPayload(
    await requestApi(
      LEVY_PAYERS_API_PATH.replace("[priceId]", encodeURIComponent(priceId)),
    ),
    levyPayersResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", report: read.value.data };
}

/** Abre Checkout para pagar el levy del precio `priceId` (#473). */
export function requestLevyCheckout(
  priceId: string,
): Promise<StripeSessionOutcome> {
  return requestStripeSession(
    LEVY_CHECKOUT_API_PATH.replace("[priceId]", encodeURIComponent(priceId)),
  );
}

/** Lo que respondió el cambio de plan (#456): programado, que Pagos vuelve
 * a leer, o Checkout para el Casual que pasa a Full o Student. */
export type PlanChangeSubmission =
  | { readonly kind: "scheduled" }
  | { readonly kind: "checkout"; readonly url: string }
  | PaymentsFailure;

export async function requestPlanChange(
  plan: MembershipPlan,
): Promise<PlanChangeSubmission> {
  const read = readApiPayload(
    await requestApi(MEMBERSHIP_PLAN_API_PATH, {
      method: "POST",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify({ plan }),
    }),
    planChangeResponseSchema,
  );
  if (read.kind === "failed") {
    return read;
  }
  const { data } = read.value;
  return data.kind === "checkout"
    ? { kind: "checkout", url: data.url }
    : { kind: "scheduled" };
}

/** Lo que respondió la elección de plan antes del primer pago (#479): la
 * membresía con el plan guardado, como la sirve `GET`. */
export type PlanChoiceSubmission =
  { readonly kind: "saved"; readonly view: MembershipView } | PaymentsFailure;

export async function requestPlanChoice(
  plan: MembershipPlan,
): Promise<PlanChoiceSubmission> {
  const read = readApiPayload(
    await requestApi(MEMBERSHIP_PLAN_API_PATH, {
      method: "PUT",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify({ plan }),
    }),
    membershipResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "saved", view: read.value.data };
}

export async function requestPlanChangeCancellation(): Promise<
  { readonly kind: "cancelled" } | PaymentsFailure
> {
  const read = readApiPayload(
    await requestApi(MEMBERSHIP_PLAN_API_PATH, { method: "DELETE" }),
    planChangeCancellationResponseSchema,
  );
  return read.kind === "failed" ? read : { kind: "cancelled" };
}

/** Por qué no se cambió el plan. Un 409 es que la membresía cambió desde
 * que se cargó la pantalla: recargarla dice por qué. */
export function describePlanChangeFailure(
  translate: Translator,
  { failure }: PaymentsFailure,
): string {
  switch (failure) {
    case "network":
      return translate("auth.error.network");
    case "service_unavailable":
      return translate("payments.planChange.unavailable");
    default:
      return translate("payments.planChange.failed");
  }
}

/** Por qué no se guardó el plan elegido (#479). */
export function describePlanChoiceFailure(
  translate: Translator,
  { failure }: PaymentsFailure,
): string {
  return failure === "network"
    ? translate("auth.error.network")
    : translate("payments.choice.failed");
}

/** Por qué no se pudo cargar la membresía, en el idioma de la pantalla. */
export function describeLoadFailure(
  translate: Translator,
  { failure }: PaymentsFailure,
): string {
  return failure === "network"
    ? translate("auth.error.network")
    : translate("payments.load.failed");
}

/** Por qué no se abrió Checkout, en el idioma de la pantalla. */
export function describeCheckoutFailure(
  translate: Translator,
  { failure }: PaymentsFailure,
): string {
  switch (failure) {
    case "network":
      return translate("auth.error.network");
    case "service_unavailable":
      return translate("payments.error.unavailable");
    default:
      return translate("payments.error.unexpected");
  }
}

/** Por qué no se abrió el reintento (#474): sin factura abierta no hay nada
 * que pagar, y un 502 es que Stripe falló. */
export function describePaymentRetryFailure(
  translate: Translator,
  failure: PaymentsFailure,
): string {
  switch (failure.failure) {
    case "conflict":
      return translate("failedPayment.error.nothingPending");
    case "bad_gateway":
      return translate("failedPayment.error.stripeFailed");
    default:
      return describeCheckoutFailure(translate, failure);
  }
}
