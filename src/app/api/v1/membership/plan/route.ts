import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError, type ApiErrorCode } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { MEMBERSHIP_TYPES } from "@/lib/auth/registration";
import type { MembershipPlan } from "@/lib/membership/membership";
import {
  type PlanChangeCancellationRefusal,
  type PlanChangeGateways,
  type PlanChangeRefusal,
  cancelPlanChange,
  requestPlanChange,
} from "@/lib/membership/plan-change";
import {
  createMemberEmailGateway,
  createMembershipGateway,
  createScheduledPlanChangeGateway,
} from "@/lib/membership/supabase-membership-gateways";
import {
  asStripeUnavailable,
  resolveRoutePlanChangeStripe,
} from "@/lib/stripe/stripe-route";
import { createServiceRoleClient } from "@/lib/supabase/service-client";

/**
 * Cambiar de plan al siguiente ciclo (#456, RF-6 del PRD de E12, D5).
 * `POST` lo programa en Stripe para el fin del periodo, sin prorrateo, o lleva
 * a Checkout al Casual que elige Full o Student. `DELETE` lo anula. La
 * membresía guarda el cambio con la llave de servicio, porque `authenticated`
 * no escribe en `memberships`.
 */

// Cada petición pide algo a Stripe para quien llama.
export const dynamic = "force-dynamic";

export type MembershipPlanResponse =
  | {
      readonly kind: "scheduled";
      readonly plan: MembershipPlan;
      /** ISO 8601: cuándo Stripe aplica el cambio. */
      readonly effectiveAt: string;
    }
  | { readonly kind: "checkout"; readonly url: string };

export type MembershipPlanCancellationResponse = {
  readonly scheduledChange: null;
};

const planBodySchema = z.object({ plan: z.enum(MEMBERSHIP_TYPES) }).strict();

type PlanBody = z.infer<typeof planBodySchema>;

type Refusal = { readonly code: ApiErrorCode; readonly message: string };

const REFUSALS: Record<
  PlanChangeRefusal | PlanChangeCancellationRefusal,
  Refusal
> = {
  stripe_not_configured: {
    code: "service_unavailable",
    message: "Los pagos no están configurados.",
  },
  no_plan: { code: "conflict", message: "Tu membresía no tiene plan todavía." },
  membership_waived: {
    code: "conflict",
    message: "Tu membresía está exenta: no hay plan que cambiar.",
  },
  membership_not_current: {
    code: "conflict",
    message: "Ponte al día antes de cambiar de plan.",
  },
  no_subscription: {
    code: "conflict",
    message: "Tu membresía no tiene suscripción en Stripe.",
  },
  same_plan: { code: "conflict", message: "Ya tienes ese plan." },
  change_already_scheduled: {
    code: "conflict",
    message: "Ya hay otro cambio de plan programado: anúlalo antes.",
  },
  no_scheduled_change: {
    code: "conflict",
    message: "No hay ningún cambio de plan programado.",
  },
};

const LOG_PREFIX = "[membership/plan]";

function refuse(reason: keyof typeof REFUSALS): never {
  const refusal = REFUSALS[reason];
  throw new ApiError(refusal.code, refusal.message, reason);
}

function planChangeGateways(): PlanChangeGateways {
  const serviceClient = createServiceRoleClient(process.env);
  return {
    membership: createMembershipGateway(serviceClient),
    scheduledChanges: createScheduledPlanChangeGateway(serviceClient),
    memberEmails: createMemberEmailGateway(serviceClient),
    stripe: resolveRoutePlanChangeStripe(LOG_PREFIX),
  };
}

const postPlan = createApiRoute<MembershipPlanResponse, PlanBody>({
  schema: planBodySchema,
  handler: async ({ request, body, decorateResponse }) => {
    const userId = await identifyAccountCaller({ request, decorateResponse });
    const outcome = await requestPlanChange(planChangeGateways(), {
      userId,
      plan: body.plan,
      origin: request.nextUrl.origin,
      now: new Date(),
    }).catch(asStripeUnavailable(LOG_PREFIX));
    switch (outcome.kind) {
      case "refused":
        return refuse(outcome.reason);
      case "checkout":
        return { data: { kind: "checkout", url: outcome.url } };
      case "scheduled":
        return {
          data: {
            kind: "scheduled",
            plan: outcome.change.plan,
            effectiveAt: outcome.change.effectiveAt.toISOString(),
          },
        };
    }
  },
});

const deletePlan = createApiRoute<MembershipPlanCancellationResponse>({
  handler: async ({ request, decorateResponse }) => {
    const userId = await identifyAccountCaller({ request, decorateResponse });
    const outcome = await cancelPlanChange(planChangeGateways(), {
      userId,
      now: new Date(),
    }).catch(asStripeUnavailable(LOG_PREFIX));
    if (outcome.kind === "refused") {
      return refuse(outcome.reason);
    }
    return { data: { scheduledChange: null } };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: postPlan,
  DELETE: deletePlan,
});
