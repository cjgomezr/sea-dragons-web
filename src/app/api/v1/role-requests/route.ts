import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import {
  type PendingRoleRequest,
  listPendingRoleRequests,
} from "@/lib/auth/club-administration";
import {
  asClubAdministrationApiError,
  requireClubAdministrationGateways,
} from "@/lib/auth/club-administration-api";
import {
  JUSTIFICATION_MAX_LENGTH,
  JustificationTooLongError,
  PendingRoleRequestError,
  REQUESTABLE_ROLES,
  type RoleRequest,
  type RoleRequestGateways,
  RoleRequestRefusedError,
  requestRole,
} from "@/lib/auth/role-request";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { createSupabaseRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";

/**
 * Pedir Coach o Committee (FR-010, RF-4 del PRD de E3) y leer la bandeja de
 * las que están pendientes (RF-8, #212).
 *
 * El POST actúa siempre sobre quien identifica la cookie de sesión, nunca
 * sobre un id del cuerpo, y lo alcanza cualquier cuenta activa de cualquier
 * rol. Lo que cada rol puede pedir lo decide el dominio.
 *
 * El GET es lo contrario: enseña las solicitudes de todo el club, así que sólo
 * lo puede usar quien gestiona usuarios y roles. Esa comprobación NO está en
 * `RESTRICTED_ROUTES`, porque la frontera decide por camino y aquí los dos
 * métodos no coinciden en quién puede usarlos. La hace `listPendingRoleRequests`
 * antes de leer nada.
 */

// Depende de la sesión de quien llama y de sus solicitudes en este instante.
export const dynamic = "force-dynamic";

/** Un tope holgado sólo para no arrastrar un cuerpo de megas hasta el dominio.
 * El límite de verdad, contado como `char_length`, lo aplica `requestRole`:
 * un emoji ocupa dos unidades aquí y un carácter allí, y cuatro veces el
 * límite deja pasar cualquier texto que la base aceptaría. */
const JUSTIFICATION_BODY_MAX_LENGTH = JUSTIFICATION_MAX_LENGTH * 4;

/** Sólo Coach y Committee pasan la forma: pedir Admin, Player o un rol que no
 * existe es una petición mal hecha (400) y no llega a la base. Que el socio ya
 * tenga el rol es una regla del dominio (422). */
const roleRequestBodySchema = z.object({
  requestedRole: z.enum(REQUESTABLE_ROLES),
  justification: z
    .string()
    .max(JUSTIFICATION_BODY_MAX_LENGTH)
    .nullable()
    .optional(),
});

type RoleRequestBody = z.infer<typeof roleRequestBodySchema>;

/** La solicitud recién creada, pendiente de respuesta. */
export type RoleRequestResponse = RoleRequest;

function requireRoleRequestGateways(): RoleRequestGateways {
  const wiring = createSupabaseRoleRequestGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

function asApiError(error: unknown): never {
  if (error instanceof JustificationTooLongError) {
    throw new ApiError("validation_error", error.message);
  }
  if (error instanceof RoleRequestRefusedError) {
    throw new ApiError("business_rule", error.message, error.reason);
  }
  if (error instanceof PendingRoleRequestError) {
    throw new ApiError("conflict", error.message);
  }
  return asAccountApiError(error);
}

const postRoleRequest = createApiRoute<RoleRequestResponse, RoleRequestBody>({
  schema: roleRequestBodySchema,
  handler: async ({ request, body, decorateResponse }) => {
    const userId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await requestRole(requireRoleRequestGateways(), {
          userId,
          requestedRole: body.requestedRole,
          justification: body.justification ?? null,
        }),
        status: 201,
      };
    } catch (error) {
      asApiError(error);
    }
  },
});

/** El único filtro que este endpoint sabe contestar. Pedir otro estado, o no
 * pedir ninguno, es una petición que no está implementada: se responde que la
 * consulta está mal en vez de devolver a medias lo que no se preguntó. */
const SUPPORTED_STATUS_FILTER = "pending";
const STATUS_QUERY_PARAM = "status";
const UNSUPPORTED_FILTER_MESSAGE = `Este endpoint sólo lista las solicitudes con ?${STATUS_QUERY_PARAM}=${SUPPORTED_STATUS_FILTER}.`;

/** Las solicitudes pendientes del club de quien llama, la más antigua
 * primero. */
export type PendingRoleRequestsResponse = {
  readonly requests: readonly PendingRoleRequest[];
};

const getPendingRoleRequests = createApiRoute<PendingRoleRequestsResponse>({
  handler: async ({ request, decorateResponse }) => {
    if (
      request.nextUrl.searchParams.get(STATUS_QUERY_PARAM) !==
      SUPPORTED_STATUS_FILTER
    ) {
      throw new ApiError("validation_error", UNSUPPORTED_FILTER_MESSAGE);
    }
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: {
          requests: await listPendingRoleRequests(
            requireClubAdministrationGateways(),
            callerId,
          ),
        },
      };
    } catch (error) {
      asClubAdministrationApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getPendingRoleRequests,
  POST: postRoleRequest,
});
