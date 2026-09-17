import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
  requireAuthGateways,
} from "@/lib/auth/account-api";
import type { AccountCompletion } from "@/lib/auth/complete-registration";
import {
  GuardianConsentAlreadyRecordedError,
  GuardianConsentNotRequiredError,
  GuardianConsentValidationError,
  recordGuardianConsent,
} from "@/lib/auth/guardian-consent";
import { describeIssuesForApi } from "@/lib/auth/issue-messages";

/**
 * Registrar el consentimiento del tutor de quien llama (FR-082, NFR-012).
 *
 * Los tres datos son obligatorios en la forma del cuerpo: sin nombre, correo y
 * consentimiento explícito la petición no llega al dominio, y ninguna llamada
 * directa a la API marca el consentimiento sin ellos. La marca de tiempo no se
 * acepta del cuerpo: la pone el servidor.
 */

// Depende de la sesión de quien llama y del estado de su fila.
export const dynamic = "force-dynamic";

const consentBodySchema = z.object({
  guardianName: z.string(),
  guardianEmail: z.string(),
  consent: z.boolean(),
});

type ConsentBody = z.infer<typeof consentBodySchema>;

/** Igual que el endpoint de la cuenta: el estado y lo que sigue faltando. */
export type GuardianConsentResponse = AccountCompletion;

function asApiError(error: unknown): never {
  if (error instanceof GuardianConsentValidationError) {
    throw new ApiError("business_rule", describeIssuesForApi(error.issues));
  }
  if (
    error instanceof GuardianConsentNotRequiredError ||
    error instanceof GuardianConsentAlreadyRecordedError
  ) {
    throw new ApiError("conflict", error.message);
  }
  return asAccountApiError(error);
}

const postGuardianConsent = createApiRoute<
  GuardianConsentResponse,
  ConsentBody
>({
  schema: consentBodySchema,
  emailField: "guardianEmail",
  handler: async ({ request, body, decorateResponse }) => {
    const userId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await recordGuardianConsent(requireAuthGateways(), {
          userId,
          request: body,
          now: new Date(),
        }),
      };
    } catch (error) {
      asApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: postGuardianConsent,
});
