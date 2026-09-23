import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  AUF_NUMBER_MAX_LENGTH,
  type MemberRecord,
  verifyMemberAuf,
} from "@/lib/members/member-record";
import {
  type MemberRecordRouteContext,
  asMemberRecordApiError,
  readMemberId,
  requireMemberRecordGateways,
} from "@/lib/members/member-record-api";
import { clubCalendarDate } from "@/lib/time/club-calendar";

/**
 * Un Admin verifica el AUF que propuso un miembro (#274, RF-12 del PRD de
 * E5, BR-008). Es una acción aparte del PATCH de la ficha a propósito: guardar
 * la ficha sin tocar el AUF no lo verifica, porque un Admin que sólo cambia
 * los grupos no ha mirado el registro.
 *
 * El cuerpo lleva el número y el vencimiento que el Admin tenía delante. Si
 * el miembro los cambió entretanto, responde 409 con `reason: auf_changed` y
 * no verifica nada. Uno ya verificado responde 200 sin volver a escribir.
 *
 * Quién puede llamarlo lo decide la frontera (`RESTRICTED_ROUTES`), y el
 * dominio lo vuelve a comprobar.
 */

// Depende de la sesión de quien llama y de la fila del socio ahora.
export const dynamic = "force-dynamic";

/** Un tope holgado sólo para no arrastrar un cuerpo de megas hasta el
 * dominio. */
const AUF_NUMBER_BODY_MAX_LENGTH = AUF_NUMBER_MAX_LENGTH * 4;

const verificationBodySchema = z
  .object({
    aufNumber: z.string().max(AUF_NUMBER_BODY_MAX_LENGTH),
    aufExpiry: z.string().nullable(),
  })
  .strict();

type VerificationBody = z.infer<typeof verificationBodySchema>;

/** La ficha tal como queda después de verificar. */
export type AufVerificationResponse = MemberRecord;

export function POST(
  request: NextRequest,
  context: MemberRecordRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<AufVerificationResponse, VerificationBody>({
    schema: verificationBodySchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const userId = await readMemberId(context);
      try {
        return {
          data: await verifyMemberAuf(requireMemberRecordGateways(), {
            callerId,
            userId,
            expected: body,
            // El vencimiento se mide en el día del club (NFR-003).
            todayInClub: clubCalendarDate(new Date()),
          }),
        };
      } catch (error) {
        asMemberRecordApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, PUT, PATCH, DELETE } = createApiModule({});
