import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  type DecorateApiResponse,
  createApiModule,
  createApiRoute,
} from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  AccountAlreadyResolvedError,
  type AccountCompletion,
  type AccountCompletionGateways,
  CompletionValidationError,
  completeRegistration,
  describeAccountCompletion,
} from "@/lib/auth/complete-registration";
import { readAuthenticatedUserId } from "@/lib/auth/session-reader";
import {
  createSupabaseAuthGateways,
  describeMissingAuthKeys,
} from "@/lib/auth/supabase-auth-gateways";
import {
  applySessionCookies,
  createSessionClient,
  readIncomingCookies,
} from "@/lib/supabase/session-client";

/**
 * La cuenta de quien llama: qué le falta (GET) y cómo se completa (PATCH).
 *
 * Actúa siempre sobre la cuenta que identifica la cookie de sesión, nunca
 * sobre un id que venga en el cuerpo. Es lo que impide que completar el
 * registro sirva para escribir en la fila de otra persona, y es la misma
 * garantía para la aplicación móvil de Release 2 (CON-002), que consume este
 * endpoint tal cual.
 */

// Depende de la sesión de quien llama y del estado de su fila en este
// instante: no hay respuesta que una caché pueda reutilizar.
export const dynamic = "force-dynamic";

/** Sólo la forma del cuerpo. Que el país exista y que el tipo de membresía
 * esté en el conjunto cerrado son reglas del dominio, y se responden con 422
 * nombrando el campo, no con 400. Los campos son opcionales porque a una
 * cuenta casi nunca le faltan los tres. */
const completionBodySchema = z.object({
  country: z.string().optional(),
  dateOfBirth: z.string().optional(),
  membershipType: z.string().optional(),
});

type CompletionBody = z.infer<typeof completionBodySchema>;

/** Lo que devuelven los dos métodos: en qué estado quedó la cuenta y qué le
 * sigue faltando. Nada más: los datos que la persona ya dio no vuelven por
 * aquí, porque la pantalla no los necesita y son datos personales. */
export type AccountResponse = AccountCompletion;

const NO_SESSION_MESSAGE =
  "Necesitas iniciar sesión para consultar o completar tu cuenta.";
const NO_MEMBER_MESSAGE =
  "Tu sesión no corresponde a ningún socio del club. Escribe al club para que la revisen.";

/** Quién está pidiendo, según su cookie de sesión. Las cookies que Supabase
 * emita al validarla se apuntan en la respuesta: perderlas es el fallo clásico
 * de este patrón. */
async function identifyCaller(args: {
  readonly request: NextRequest;
  readonly decorateResponse: (decorate: DecorateApiResponse) => void;
}): Promise<string> {
  const session = createSessionClient(
    process.env,
    readIncomingCookies(args.request),
  );
  if (session.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(session.missingKeys),
    );
  }
  args.decorateResponse((response) =>
    applySessionCookies(response, session.recorder),
  );

  const userId = await readAuthenticatedUserId(session.client);
  if (userId === null) {
    throw new ApiError("unauthenticated", NO_SESSION_MESSAGE);
  }
  return userId;
}

function requireGateways(): AccountCompletionGateways {
  const wiring = createSupabaseAuthGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return {
    accounts: wiring.gateways.accounts,
    identities: wiring.gateways.identities,
  };
}

function describeCompletionFailure(error: CompletionValidationError): string {
  return error.issues.length === 0
    ? error.message
    : error.issues.map((issue) => `${issue.field}: ${issue.message}`).join(" ");
}

/** Traduce los errores del dominio a la convención de la API. Lo que no
 * reconoce se relanza: un fallo de la base no puede salir disfrazado de
 * petición mal hecha. */
function asApiError(error: unknown): never {
  if (error instanceof MemberNotFoundError) {
    throw new ApiError("forbidden", NO_MEMBER_MESSAGE);
  }
  if (error instanceof AccountAlreadyResolvedError) {
    throw new ApiError("conflict", error.message);
  }
  if (error instanceof CompletionValidationError) {
    throw new ApiError("business_rule", describeCompletionFailure(error));
  }
  throw error;
}

const getAccount = createApiRoute<AccountResponse>({
  handler: async ({ request, decorateResponse }) => {
    const userId = await identifyCaller({ request, decorateResponse });
    try {
      return {
        data: await describeAccountCompletion(requireGateways(), {
          userId,
          now: new Date(),
        }),
      };
    } catch (error) {
      asApiError(error);
    }
  },
});

const patchAccount = createApiRoute<AccountResponse, CompletionBody>({
  schema: completionBodySchema,
  handler: async ({ request, body, decorateResponse }) => {
    const userId = await identifyCaller({ request, decorateResponse });
    try {
      return {
        data: await completeRegistration(requireGateways(), {
          userId,
          values: body,
          now: new Date(),
        }),
      };
    } catch (error) {
      asApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getAccount,
  PATCH: patchAccount,
});
