import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  AUF_NUMBER_MAX_LENGTH,
  type MemberRecord,
  readMemberRecord,
  updateMemberRecord,
} from "@/lib/members/member-record";
import {
  type MemberRecordRouteContext,
  asMemberRecordApiError,
  readMemberId,
  requireMemberRecordGateways,
} from "@/lib/members/member-record-api";
import { clubCalendarDate } from "@/lib/time/club-calendar";

/**
 * La ficha reservada al Admin de un socio (#242, RF-4 del PRD de E5): su
 * número de AUF, su vencimiento y sus grupos (FR-020, BR-008), y la
 * corrección de su fecha de nacimiento (#272, RF-10).
 *
 * Quién puede llamarlo lo decide la frontera: `RESTRICTED_ROUTES` lo reserva a
 * quien gestiona usuarios y roles, que sólo es Admin, y el dominio lo vuelve a
 * comprobar. El `[id]` es el `user_id` del socio, y sólo alcanza a los de su
 * club.
 *
 * El PATCH lleva la ficha entera en una sola petición: dos Admin que guardan a
 * la vez no dejan el número de uno con el vencimiento del otro. Un AUF que el
 * Admin cambia aquí queda verificado (#274); confirmar el que propuso el
 * miembro sin cambiarlo es `auf-verification`, que cuelga de esta ruta.
 */

// Depende de la sesión de quien llama y de la fila del socio ahora.
export const dynamic = "force-dynamic";

/** Un tope holgado sólo para no arrastrar un cuerpo de megas hasta el
 * dominio, que cuenta el número en caracteres y dice cuál es el límite. */
const AUF_NUMBER_BODY_MAX_LENGTH = AUF_NUMBER_MAX_LENGTH * 4;

/** Sólo la forma. Que el número quepa y la fecha sea un día de verdad lo
 * decide el dominio, que dice además cuál falló. `strict` responde 400 a
 * cualquier campo que no sea de esta ficha, como el rol o el nombre. */
const recordBodySchema = z
  .object({
    aufNumber: z.string().max(AUF_NUMBER_BODY_MAX_LENGTH).nullable(),
    aufExpiry: z.string().nullable(),
    groupIds: z.array(z.uuid()),
    dateOfBirth: z.string().nullable(),
  })
  .strict();

type RecordBody = z.infer<typeof recordBodySchema>;

/** La ficha tal como está en la base después de la petición. */
export type MemberRecordResponse = MemberRecord;

export function GET(
  request: NextRequest,
  context: MemberRecordRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<MemberRecordResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const userId = await readMemberId(context);
      try {
        return {
          data: await readMemberRecord(requireMemberRecordGateways(), {
            callerId,
            userId,
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

export function PATCH(
  request: NextRequest,
  context: MemberRecordRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<MemberRecordResponse, RecordBody>({
    schema: recordBodySchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const userId = await readMemberId(context);
      try {
        return {
          data: await updateMemberRecord(requireMemberRecordGateways(), {
            callerId,
            userId,
            submission: body,
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

export const { POST, PUT, DELETE } = createApiModule({});
