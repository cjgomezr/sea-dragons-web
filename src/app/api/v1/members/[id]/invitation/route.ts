import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { resendInvitation } from "@/lib/members/member-invitation";
import {
  asMemberInvitationApiError,
  requireMemberInvitationGateways,
} from "@/lib/members/member-invitation-api";
import {
  MEMBER_NOT_FOUND_REASON,
  MemberRecordNotFoundError,
} from "@/lib/members/member-record";

/**
 * Reenviar la invitación de un miembro dado de alta por un Admin que todavía
 * no entró (#243, FR-021). Sale con un enlace nuevo, que invalida el
 * anterior, y con el mismo límite que el reenvío de la confirmación.
 *
 * Quién puede llamarlo lo decide la frontera (`RESTRICTED_ROUTES`: sólo
 * Admin), y el dominio lo vuelve a comprobar. El `[id]` es el `user_id` del
 * miembro, y sólo alcanza a los de su club.
 *
 * El correo sale antes de responder: quien llama es un Admin, y la pantalla
 * tiene que saber si salió para decírselo.
 */

// Depende de la sesión de quien llama, del estado del miembro y del límite.
export const dynamic = "force-dynamic";

export type InvitationResendResponse = { readonly invitation: "sent" };

type InvitationRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

/** Un id que no es un uuid no nombra a nadie: se responde como un miembro
 * que no existe, sin mandarle a Postgres un valor que rechazaría. */
async function readMemberId(context: InvitationRouteContext): Promise<string> {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    throw new ApiError(
      "not_found",
      new MemberRecordNotFoundError().message,
      MEMBER_NOT_FOUND_REASON,
    );
  }
  return id;
}

export function POST(
  request: NextRequest,
  context: InvitationRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<InvitationResendResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const userId = await readMemberId(context);
      try {
        await resendInvitation(requireMemberInvitationGateways(), {
          callerId,
          userId,
          now: new Date(),
          appUrl: apiRequest.url,
        });
        return { data: { invitation: "sent" } };
      } catch (error) {
        asMemberInvitationApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, PUT, PATCH, DELETE } = createApiModule({});
