import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { InactiveMemberError } from "@/lib/groups/group-members";
import { GroupNotFoundError } from "@/lib/groups/groups";
import { asGroupsApiError } from "@/lib/groups/groups-api";
import {
  AUF_NUMBER_MAX_LENGTH,
  GROUP_NOT_FOUND_REASON,
  MEMBER_INACTIVE_REASON,
  MEMBER_NOT_FOUND_REASON,
  type MemberRecord,
  MemberRecordForbiddenError,
  type MemberRecordGateways,
  MemberRecordNotFoundError,
  MemberRecordValidationError,
  readMemberRecord,
  updateMemberRecord,
} from "@/lib/members/member-record";
import { createSupabaseMemberRecordGateways } from "@/lib/members/supabase-member-record-gateways";
import { clubCalendarDate } from "@/lib/time/club-calendar";

/**
 * La ficha reservada al Admin de un socio (#242, RF-4 del PRD de E5): su
 * número de AUF, su vencimiento y sus grupos (FR-020, BR-008).
 *
 * Quién puede llamarlo lo decide la frontera: `RESTRICTED_ROUTES` lo reserva a
 * quien gestiona usuarios y roles, que sólo es Admin, y el dominio lo vuelve a
 * comprobar. El `[id]` es el `user_id` del socio, y sólo alcanza a los de su
 * club.
 *
 * El PATCH lleva la ficha entera en una sola petición: dos Admin que guardan a
 * la vez no dejan el número de uno con el vencimiento del otro.
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
  })
  .strict();

type RecordBody = z.infer<typeof recordBodySchema>;

/** La ficha tal como está en la base después de la petición. */
export type MemberRecordResponse = MemberRecord;

type MemberRecordRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

function requireMemberRecordGateways(): MemberRecordGateways {
  const wiring = createSupabaseMemberRecordGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

/** Un id que no es un uuid no puede nombrar a ningún socio: se responde como
 * uno que no existe, sin mandarle a Postgres un valor que rechazaría. */
async function readMemberId(
  context: MemberRecordRouteContext,
): Promise<string> {
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

/** El primer campo que no vale va como `reason`, que la pantalla traduce. */
function asApiError(error: unknown): never {
  if (error instanceof MemberRecordValidationError) {
    throw new ApiError(
      "validation_error",
      error.message,
      error.issues[0]?.code,
    );
  }
  if (error instanceof MemberRecordForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  if (error instanceof MemberRecordNotFoundError) {
    throw new ApiError("not_found", error.message, MEMBER_NOT_FOUND_REASON);
  }
  if (error instanceof GroupNotFoundError) {
    throw new ApiError("not_found", error.message, GROUP_NOT_FOUND_REASON);
  }
  if (error instanceof InactiveMemberError) {
    throw new ApiError("business_rule", error.message, MEMBER_INACTIVE_REASON);
  }
  return asGroupsApiError(error);
}

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
        asApiError(error);
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
        asApiError(error);
      }
    },
  });
  return route(request);
}

export const { POST, PUT, DELETE } = createApiModule({});
