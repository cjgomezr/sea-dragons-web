import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type MemberEvaluation,
  createMemberEvaluation,
  readMemberEvaluation,
  saveEvaluationRatings,
} from "@/lib/evaluations/member-evaluation";
import {
  type MemberEvaluationRouteContext,
  asEvaluationApiError,
  readMemberId,
  requireMemberEvaluationGateways,
} from "@/lib/evaluations/member-evaluation-api";

/**
 * La evaluación de un miembro (#319, RF-1, RF-2 y RF-5 del PRD de E9). GET la
 * lee con su OVR, POST la crea con todas las categorías activas en 5 y PUT
 * guarda sus valoraciones contra la fecha que se leyó.
 *
 * Quién puede llamarlo lo decide la frontera: `RESTRICTED_ROUTES` lo reserva a
 * quien ve evaluaciones, que son Admin y Coach, y el dominio lo vuelve a
 * comprobar (FR-055). El `[id]` es el `user_id` del miembro, y sólo alcanza a
 * los de su club.
 */

// Depende de la sesión de quien llama y de la evaluación ahora.
export const dynamic = "force-dynamic";

/** Un tope holgado: una evaluación tiene tantas valoraciones como categorías
 * tuvo el club al crearla, y ningún club mide cien cosas. Sólo evita
 * arrastrar un cuerpo de megas hasta la base. */
const MAX_RATINGS_PER_REQUEST = 100;

/** Sólo la forma. Que la valoración sea un entero de 1 a 10 lo decide el
 * dominio, que dice además cuál falló. `expectedUpdatedAt` es el
 * `updatedAt` que devolvió la lectura, tal cual. */
const ratingsBodySchema = z
  .object({
    expectedUpdatedAt: z.iso.datetime({ offset: true }),
    ratings: z
      .array(z.object({ categoryId: z.uuid(), rating: z.number() }).strict())
      .max(MAX_RATINGS_PER_REQUEST),
  })
  .strict();

type RatingsBody = z.infer<typeof ratingsBodySchema>;

/** La evaluación tal como está en la base después de la petición, o que el
 * miembro no tiene ninguna. */
export type MemberEvaluationResponse = MemberEvaluation;

const CREATED_STATUS = 201;

export function GET(
  request: NextRequest,
  context: MemberEvaluationRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<MemberEvaluationResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const memberId = await readMemberId(context);
      try {
        return {
          data: await readMemberEvaluation(requireMemberEvaluationGateways(), {
            callerId,
            memberId,
          }),
        };
      } catch (error) {
        asEvaluationApiError(error);
      }
    },
  });
  return route(request);
}

export function POST(
  request: NextRequest,
  context: MemberEvaluationRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<MemberEvaluationResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const memberId = await readMemberId(context);
      try {
        return {
          data: await createMemberEvaluation(
            requireMemberEvaluationGateways(),
            { callerId, memberId },
          ),
          status: CREATED_STATUS,
        };
      } catch (error) {
        asEvaluationApiError(error);
      }
    },
  });
  return route(request);
}

export function PUT(
  request: NextRequest,
  context: MemberEvaluationRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<MemberEvaluationResponse, RatingsBody>({
    schema: ratingsBodySchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const memberId = await readMemberId(context);
      try {
        return {
          data: await saveEvaluationRatings(requireMemberEvaluationGateways(), {
            callerId,
            memberId,
            expectedUpdatedAt: body.expectedUpdatedAt,
            ratings: body.ratings,
          }),
        };
      } catch (error) {
        asEvaluationApiError(error);
      }
    },
  });
  return route(request);
}

export const { PATCH, DELETE } = createApiModule({});
