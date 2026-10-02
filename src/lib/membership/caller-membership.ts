import { cache } from "react";
import { readCallerId } from "@/lib/auth/caller-role";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { isStripeConfigured } from "@/lib/stripe/stripe-client";
import { readServerCookies } from "@/lib/supabase/server-cookies";
import { createSessionClient } from "@/lib/supabase/session-client";
import { readMembership } from "./membership";
import { type MembershipView, toMembershipView } from "./membership-view";
import { createMembershipGateway } from "./supabase-membership-gateways";

/**
 * La membresía de quien pide Pagos, tal como la pinta la pantalla (#453,
 * #454): el motivo de la puerta cerrada, el plan y la prueba.
 *
 * Va con el cliente de la sesión y no con la llave de servicio:
 * `memberships_select_own` deja a cada socio leer su propia membresía, que
 * es la única que se pide.
 */
export const readCallerMembershipView = cache(
  async (): Promise<MembershipView> => {
    const session = createSessionClient(process.env, await readServerCookies());
    if (session.kind === "unconfigured") {
      throw new Error(describeMissingAuthKeys(session.missingKeys));
    }
    const reading = await readMembership(
      createMembershipGateway(session.client),
      { userId: await readCallerId(), now: new Date() },
    );
    return toMembershipView(reading, isStripeConfigured(process.env));
  },
);
