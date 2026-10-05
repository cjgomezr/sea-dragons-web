import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  listSessionPacks,
  MAX_PACK_SESSIONS,
  replaceSessionPacks,
  type SessionPacksCatalog,
  SessionPacksForbiddenError,
  type SessionPacksGateways,
  SessionPacksValidationError,
} from "@/lib/club/session-packs";
import { createSupabaseSessionPacksGateways } from "@/lib/club/supabase-session-packs-gateways";

/**
 * Los packs de sesiones del club (#469, RF-4 del PRD de E13 y FR-080). GET
 * los sirve en orden con el precio de cada uno, que es el de una sesión
 * Casual en Stripe por el tamaño; PUT deja la lista nueva entera.
 *
 * GET lo alcanza cualquier cuenta activa. PUT es del Admin y del Committee,
 * y lo comprueba el dominio: la frontera decide por camino y aquí los dos
 * métodos no coinciden en quién puede usarlos.
 */

// Depende de la sesión de quien llama, de la lista del club y de Stripe.
export const dynamic = "force-dynamic";

/** Un tope holgado sólo para no arrastrar un cuerpo enorme hasta el dominio,
 * que dice qué regla se rompió. Una lista más larga ya repite algún tamaño. */
const SIZES_BODY_MAX_LENGTH = MAX_PACK_SESSIONS * 2;

const sessionPacksBodySchema = z
  .object({
    sessions: z.array(z.number().int()).max(SIZES_BODY_MAX_LENGTH),
  })
  .strict();

type SessionPacksBody = z.infer<typeof sessionPacksBodySchema>;

export type SessionPacksResponse = SessionPacksCatalog;

function requireSessionPacksGateways(): SessionPacksGateways {
  const wiring = createSupabaseSessionPacksGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

function asSessionPacksApiError(error: unknown): never {
  if (error instanceof SessionPacksValidationError) {
    throw new ApiError("validation_error", error.message, error.code);
  }
  if (error instanceof SessionPacksForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  return asAccountApiError(error);
}

const getSessionPacks = createApiRoute<SessionPacksResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await listSessionPacks(requireSessionPacksGateways(), callerId),
      };
    } catch (error) {
      asSessionPacksApiError(error);
    }
  },
});

const putSessionPacks = createApiRoute<SessionPacksResponse, SessionPacksBody>({
  schema: sessionPacksBodySchema,
  handler: async ({ request, body, decorateResponse }) => {
    const callerId = await identifyAccountCaller({
      request,
      decorateResponse,
    });
    try {
      return {
        data: await replaceSessionPacks(requireSessionPacksGateways(), {
          callerId,
          sizes: body.sessions,
        }),
      };
    } catch (error) {
      asSessionPacksApiError(error);
    }
  },
});

export const { GET, PUT, POST, PATCH, DELETE } = createApiModule({
  GET: getSessionPacks,
  PUT: putSessionPacks,
});
