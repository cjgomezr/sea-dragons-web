import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
  requireAuthGateways,
} from "@/lib/auth/account-api";
import {
  type AccountCompletion,
  CompletionValidationError,
  completeRegistration,
  describeAccountCompletion,
} from "@/lib/auth/complete-registration";
import { describeIssuesForApi } from "@/lib/auth/issue-messages";

/**
 * La cuenta de quien llama: qué le falta (GET) y cómo se completa (PATCH).
 *
 * Actúa siempre sobre la cuenta que identifica la cookie de sesión (ver
 * `account-api.ts`). El consentimiento del tutor no entra por aquí: tiene su
 * propio endpoint, que exige los datos del tutor.
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

function describeCompletionFailure(error: CompletionValidationError): string {
  return error.issues.length === 0
    ? error.message
    : describeIssuesForApi(error.issues);
}

function asApiError(error: unknown): never {
  if (error instanceof CompletionValidationError) {
    throw new ApiError("business_rule", describeCompletionFailure(error));
  }
  return asAccountApiError(error);
}

const getAccount = createApiRoute<AccountResponse>({
  handler: async ({ request, decorateResponse }) => {
    const userId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await describeAccountCompletion(requireAuthGateways(), {
          userId,
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
    const userId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await completeRegistration(requireAuthGateways(), {
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
