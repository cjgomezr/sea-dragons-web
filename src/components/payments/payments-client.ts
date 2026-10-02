import { z } from "zod";
import {
  type ApiRequestFailure,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import {
  MEMBERSHIP_API_PATH,
  MEMBERSHIP_CHECKOUT_API_PATH,
} from "@/lib/auth/routes";
import { MEMBERSHIP_TYPES } from "@/lib/auth/registration";
import type { Translator } from "@/lib/i18n/translator";
import { MEMBERSHIP_STATUSES } from "@/lib/membership/membership";
import type { MembershipView } from "@/lib/membership/membership-view";

/**
 * Lo que Pagos (#454) pide a los endpoints de la membresía: abrir Checkout y
 * volver a leer el estado mientras espera el webhook. Son los mismos caminos
 * que usará la aplicación nativa de Release 2 (CON-002).
 */

const membershipViewSchema = z.object({
  paymentsConfigured: z.boolean(),
  membership: z
    .object({
      plan: z.enum(MEMBERSHIP_TYPES).nullable(),
      status: z.enum(MEMBERSHIP_STATUSES),
      trialEnd: z.iso.datetime({ offset: true }).nullable(),
    })
    .nullable(),
});

const membershipResponseSchema = z.object({ data: membershipViewSchema });

const checkoutResponseSchema = z.object({
  data: z.object({ url: z.url() }),
});

export type PaymentsFailure = ApiRequestFailure;

export type MembershipViewLoad =
  { readonly kind: "loaded"; readonly view: MembershipView } | PaymentsFailure;

export type CheckoutRequestOutcome =
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

export async function requestCheckout(): Promise<CheckoutRequestOutcome> {
  const read = readApiPayload(
    await requestApi(MEMBERSHIP_CHECKOUT_API_PATH, { method: "POST" }),
    checkoutResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "created", url: read.value.data.url };
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
