import { cache } from "react";
import { readCallerId } from "@/lib/auth/caller-role";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { readServerCookies } from "@/lib/supabase/server-cookies";
import { createSessionClient } from "@/lib/supabase/session-client";
import {
  type MembershipBlock,
  membershipBlockOf,
  readMembership,
} from "./membership";
import { createMembershipGateway } from "./supabase-membership-gateways";

/**
 * Por qué la puerta de socio está cerrada para quien pide la pantalla, o
 * `null` si está al día (#453). Lo lee Pagos para decir el motivo.
 *
 * Va con el cliente de la sesión y no con la llave de servicio:
 * `memberships_select_own` deja a cada socio leer su propia membresía, que
 * es la única que se pide.
 */
export const readCallerMembershipBlock = cache(
  async (): Promise<MembershipBlock | null> => {
    const session = createSessionClient(process.env, await readServerCookies());
    if (session.kind === "unconfigured") {
      throw new Error(describeMissingAuthKeys(session.missingKeys));
    }
    const reading = await readMembership(
      createMembershipGateway(session.client),
      { userId: await readCallerId(), now: new Date() },
    );
    return membershipBlockOf(reading);
  },
);
