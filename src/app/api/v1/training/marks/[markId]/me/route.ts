import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  clearMemberMark,
  isValidMarkValue,
  saveMemberMark,
} from "@/lib/training/member-marks";
import {
  type MemberMarksResponse,
  asMemberMarksApiError,
  readMarkId,
  requireMemberMarksGateways,
} from "@/lib/training/member-marks-api";

/**
 * Guardar o borrar una marca del socio de la sesión (#899, RF-5 y D11 del
 * PRD de E35). Las dos responden la lista entera, como el GET. El socio es
 * siempre el de la sesión: el cuerpo sólo trae el valor, y un campo de más es
 * un 400. La marca de otro club responde 404, como una que no existe.
 */

// Depende de la sesión de quien llama, de su membresía y de sus marcas.
export const dynamic = "force-dynamic";

const saveBodySchema = z
  .object({ value: z.custom<number>(isValidMarkValue) })
  .strict();

type SaveBody = z.infer<typeof saveBodySchema>;

type MarkRouteContext = {
  readonly params: Promise<{ readonly markId: string }>;
};

export function PUT(
  request: NextRequest,
  context: MarkRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<MemberMarksResponse, SaveBody>({
    schema: saveBodySchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const markId = readMarkId((await context.params).markId);
      try {
        return {
          data: await saveMemberMark(requireMemberMarksGateways(), {
            callerId,
            now: new Date(),
            markId,
            value: body.value,
          }),
        };
      } catch (error) {
        return asMemberMarksApiError(error);
      }
    },
  });
  return route(request);
}

export function DELETE(
  request: NextRequest,
  context: MarkRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<MemberMarksResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const markId = readMarkId((await context.params).markId);
      try {
        return {
          data: await clearMemberMark(requireMemberMarksGateways(), {
            callerId,
            now: new Date(),
            markId,
          }),
        };
      } catch (error) {
        return asMemberMarksApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, POST, PATCH } = createApiModule({});
