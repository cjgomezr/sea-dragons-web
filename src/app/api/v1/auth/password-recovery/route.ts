import type { NextRequest } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { requestPasswordRecovery } from "@/lib/auth/password-recovery";
import { connectRecoveryEmailSender } from "@/lib/auth/recovery-email-sender";
import { looksLikeEmail } from "@/lib/auth/registration";
import {
  PASSWORD_RESET_PATH,
  RESET_TOKEN_QUERY_PARAM,
} from "@/lib/auth/routes";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { createSupabasePasswordRecoveryGateways } from "@/lib/auth/supabase-password-recovery";

/**
 * Pedir el enlace de recuperación de contraseña (RF-6). Público: quien lo pide
 * no tiene sesión. La respuesta es la misma exista o no la cuenta; lo único
 * que la cambia es el límite de peticiones, que se aplica igual a las dos.
 */

// Depende del estado de la base en este instante y escribe en ella.
export const dynamic = "force-dynamic";

/** El largo máximo de una dirección de correo (RFC 3696). Por encima no hay
 * dirección válida, y un endpoint público no tiene por qué hashear ni reenviar
 * cadenas de cualquier tamaño. */
const MAX_EMAIL_LENGTH = 320;

const passwordRecoveryBodySchema = z.object({
  email: z.string().max(MAX_EMAIL_LENGTH),
});

type PasswordRecoveryBody = z.infer<typeof passwordRecoveryBodySchema>;

/** Deliberadamente pobre: sólo repite el correo, que ya sabía quien llama. */
export type PasswordRecoveryResponse = {
  readonly outcome: "recovery_requested";
  readonly email: string;
};

function describeRateLimit(retryAfterMinutes: number): string {
  return `Pediste varios enlaces seguidos. Espera ${retryAfterMinutes} minutos antes de pedir otro.`;
}

/** El enlace apunta al origen que recibió la petición. No es un campo que
 * decida quien llama: en Vercel sólo llegan a este despliegue las peticiones
 * dirigidas a sus propios dominios, así que un `Host` inventado no alcanza
 * este código para envenenar el enlace. */
function resetUrlBuilder(request: NextRequest): (tokenHash: string) => string {
  return (tokenHash) => {
    const url = new URL(PASSWORD_RESET_PATH, request.url);
    url.searchParams.set(RESET_TOKEN_QUERY_PARAM, tokenHash);
    return url.toString();
  };
}

const postPasswordRecovery = createApiRoute<
  PasswordRecoveryResponse,
  PasswordRecoveryBody
>({
  schema: passwordRecoveryBodySchema,
  handler: async ({ request, body }) => {
    if (!looksLikeEmail(body.email)) {
      throw new ApiError(
        "business_rule",
        "email: El correo no tiene una forma válida.",
      );
    }
    const email = body.email.trim().toLowerCase();

    // Antes de tocar nada que dependa de la cuenta: un "no puedo mandar" que
    // sólo saliera para cuentas reales delataría cuáles lo son.
    const connection = connectRecoveryEmailSender();
    if (connection.kind === "not_connected") {
      throw new ApiError("service_unavailable", connection.reason);
    }

    const wiring = await createSupabasePasswordRecoveryGateways(process.env);
    if (wiring.kind === "unconfigured") {
      throw new ApiError(
        "service_unavailable",
        describeMissingAuthKeys(wiring.missingKeys),
      );
    }

    const outcome = await requestPasswordRecovery(
      {
        requests: wiring.gateways.requests,
        tokens: wiring.gateways.tokens,
        emails: connection.sender,
      },
      { email, now: new Date(), buildResetUrl: resetUrlBuilder(request) },
    );
    if (outcome.kind === "rate_limited") {
      throw new ApiError(
        "rate_limited",
        describeRateLimit(outcome.retryAfterMinutes),
      );
    }
    return { data: { outcome: "recovery_requested", email } };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: postPasswordRecovery,
});
