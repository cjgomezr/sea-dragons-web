import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { forgetCachedSession } from "@/lib/auth/session-cache";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { createStripeSetup } from "@/lib/stripe/stripe-client";
import {
  type SubscriptionPlanClient,
  createSubscriptionPlanApi,
} from "@/lib/stripe/subscription-plan-api";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import { MEMBERSHIP_STATUSES } from "./membership";
import type {
  MembershipWaiverGateways,
  SubscriptionCanceller,
  WaiverRemoval,
  WaiverWrite,
} from "./membership-waiver";

/**
 * Adaptadores entre la exención manual del Admin (#457) y Supabase y Stripe.
 *
 * Van por la llave de servicio: `waive_membership` y
 * `remove_membership_waiver` sólo las ejecuta `service_role`, para que nadie
 * se exima llamándolas por PostgREST. El servidor identifica a quien actúa por
 * su cookie de sesión.
 */

const WAIVE_FUNCTION = "waive_membership";
const REMOVE_WAIVER_FUNCTION = "remove_membership_waiver";

type Environment = Readonly<Record<string, string | undefined>>;

const UNWAIVED_STATUSES = MEMBERSHIP_STATUSES.filter(
  (status) => status !== "waived",
);

const waiveResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("waived"),
    previous_status: z.enum(MEMBERSHIP_STATUSES),
    stripe_subscription_id: z.string().nullable(),
    reason: z.string(),
    until: z.string().nullable(),
  }),
  z.object({ outcome: z.literal("actor_not_admin") }),
  z.object({ outcome: z.literal("not_found") }),
]);

const removeResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("removed"),
    status: z.enum(UNWAIVED_STATUSES),
  }),
  z.object({ outcome: z.literal("not_waived") }),
  z.object({ outcome: z.literal("actor_not_admin") }),
  z.object({ outcome: z.literal("not_found") }),
]);

function toWaiverWrite(result: z.infer<typeof waiveResultSchema>): WaiverWrite {
  if (result.outcome !== "waived") {
    return { kind: result.outcome };
  }
  return {
    kind: "waived",
    previousStatus: result.previous_status,
    stripeSubscriptionId: result.stripe_subscription_id,
    reason: result.reason,
    until: result.until === null ? null : new Date(result.until),
  };
}

function toWaiverRemoval(
  result: z.infer<typeof removeResultSchema>,
): WaiverRemoval {
  return result.outcome === "removed"
    ? { kind: "removed", status: result.status }
    : { kind: result.outcome };
}

async function callWaiverFunction<T>(
  serviceClient: SupabaseClient,
  call: {
    readonly name: string;
    readonly args: Record<string, unknown>;
    readonly schema: z.ZodType<T>;
    readonly targetUserId: string;
  },
): Promise<T> {
  const { data, error } = await serviceClient.rpc(call.name, call.args);
  if (error) {
    throw new Error(
      `No se pudo cambiar la exención de ${call.targetUserId}: ${error.message}`,
    );
  }
  const parsed = call.schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `${call.name} volvió con una forma que el dominio no reconoce: ${parsed.error.message}`,
    );
  }
  // El socio queda al día, o deja de estarlo, desde su siguiente petición en
  // este servidor, sin esperar a que caduque lo que la frontera recordaba.
  forgetCachedSession(call.targetUserId);
  return parsed.data;
}

/** Las escrituras de la exención. Van aparte de la raíz de composición para
 * que el test de integración las use con el cliente de servicio. */
export function createMembershipWaiverWriters(
  serviceClient: SupabaseClient,
): MembershipWaiverGateways["waivers"] {
  return {
    async applyWaiver(input) {
      const result = await callWaiverFunction(serviceClient, {
        name: WAIVE_FUNCTION,
        args: {
          target_user_id: input.targetUserId,
          acting_club_id: input.clubId,
          acting_user_id: input.actorId,
          reason: input.reason,
          until_day: input.until,
        },
        schema: waiveResultSchema,
        targetUserId: input.targetUserId,
      });
      return toWaiverWrite(result);
    },
    async removeWaiver(scope) {
      const result = await callWaiverFunction(serviceClient, {
        name: REMOVE_WAIVER_FUNCTION,
        args: {
          target_user_id: scope.targetUserId,
          acting_club_id: scope.clubId,
          acting_user_id: scope.actorId,
        },
        schema: removeResultSchema,
        targetUserId: scope.targetUserId,
      });
      return toWaiverRemoval(result);
    },
  };
}

/** Cancela con el adaptador del cambio de plan (#456): una suscripción con
 * un cambio programado la gobierna un `SubscriptionSchedule`, y ese adaptador
 * lo suelta antes, o Stripe rechazaría la cancelación. */
export function createSubscriptionCanceller(
  client: SubscriptionPlanClient,
): SubscriptionCanceller {
  const planApi = createSubscriptionPlanApi(client);
  return {
    kind: "configured",
    async cancelAtPeriodEnd(subscriptionId) {
      await planApi.cancelAtPeriodEnd(subscriptionId);
    },
  };
}

/** Sin las variables de Stripe no hay suscripciones que cancelar; el dominio
 * lo deja en el log si aun así encuentra una. */
function subscriptionCancellerFor(env: Environment): SubscriptionCanceller {
  const setup = createStripeSetup(env);
  return setup.kind === "unconfigured"
    ? { kind: "unconfigured" }
    : createSubscriptionCanceller(setup.client);
}

export type MembershipWaiverGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: MembershipWaiverGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición para el endpoint. Devuelve lo que falta de Supabase en
 * vez de lanzar; sin Stripe sigue funcionando. */
export function createSupabaseMembershipWaiverGateways(
  env: Environment,
): MembershipWaiverGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  const serviceClient = createServiceRoleClient(env);
  return {
    kind: "ready",
    gateways: {
      members: createRoleRequestGateways(serviceClient).members,
      waivers: createMembershipWaiverWriters(serviceClient),
      subscriptions: subscriptionCancellerFor(env),
      audit: createSupabaseAuditLogWriter(serviceClient),
      log: (line) => console.error(line),
    },
  };
}
