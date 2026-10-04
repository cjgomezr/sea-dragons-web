import { z } from "zod";
import {
  type ApiRequestFailure,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import {
  MEMBERSHIP_API_PATH,
  MEMBERSHIP_CARD_API_PATH,
  MEMBERSHIP_CHECKOUT_API_PATH,
  MEMBERSHIP_PLAN_API_PATH,
} from "@/lib/auth/routes";
import { MEMBERSHIP_TYPES } from "@/lib/auth/registration";
import type { Translator } from "@/lib/i18n/translator";
import {
  MEMBERSHIP_STATUSES,
  type MembershipPlan,
} from "@/lib/membership/membership";
import {
  type MembershipView,
  PAYMENT_STATUSES,
} from "@/lib/membership/membership-view";

/**
 * Lo que Pagos (#454, #455) pide a los endpoints de la membresía: el panel,
 * abrir Checkout para suscribirse o para cambiar la tarjeta, y volver a leer
 * el estado mientras espera el webhook. Son los mismos caminos que usará la
 * aplicación nativa de Release 2 (CON-002).
 */

const isoInstantSchema = z.iso.datetime({ offset: true });

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
