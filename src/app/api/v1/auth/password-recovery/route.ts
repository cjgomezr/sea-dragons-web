import type { NextRequest } from "next/server";
import { z } from "zod";
import { runAfterResponse } from "@/lib/api/after-response";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { describeIssuesForApi } from "@/lib/auth/issue-messages";
import { requestPasswordRecovery } from "@/lib/auth/password-recovery";
import { connectRecoveryEmailSender } from "@/lib/auth/recovery-email-sender";
import { looksLikeEmail } from "@/lib/auth/registration";
import {
  PASSWORD_RESET_PATH,
  RESET_TOKEN_QUERY_PARAM,
} from "@/lib/auth/routes";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { createSupabasePasswordRecoveryGateways } from "@/lib/auth/supabase-password-recovery";
import { describeErrorWithoutEmail } from "@/lib/email/redact-email";

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

const RECOVERY_EMAIL_UNAVAILABLE_MESSAGE =
  "El envío de correos no está disponible ahora mismo, así que no podemos mandarte el enlace. Si necesitas entrar ya, escribe al club.";

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

/** Corre la entrega cuando la respuesta ya salió. Un fallo aquí no puede
 * cambiar esa respuesta, y tampoco debe: diría qué cuentas existen. Queda en
 * el registro del servidor, que es donde lo lee quien lo arregla, y sin la
 * dirección, que los mensajes del proveedor a veces citan. */
async function deliverRecoveryLink(
  deliver: () => Promise<void>,
  email: string,
): Promise<void> {
  try {
    await deliver();
  } catch (error) {
    console.error(
      "[api/v1/auth/password-recovery] no se pudo mandar el enlace de recuperación",
      describeErrorWithoutEmail(error, email),
    );
  }
}

const postPasswordRecovery = createApiRoute<
  PasswordRecoveryResponse,
  PasswordRecoveryBody
>({
  schema: passwordRecoveryBodySchema,
  emailField: "email",
  handler: async ({ request, body }) => {
    if (!looksLikeEmail(body.email)) {
      throw new ApiError(
        "business_rule",
        describeIssuesForApi([{ field: "email", code: "email_malformed" }]),
      );
    }
    const email = body.email.trim().toLowerCase();

    // Antes de tocar nada que dependa de la cuenta: un "no puedo mandar" que
    // sólo saliera para cuentas reales delataría cuáles lo son.
    const connection = connectRecoveryEmailSender(process.env);
    if (connection.kind === "not_connected") {
      // El motivo nombra la variable que falta y dónde se pone: es para quien
      // lo arregla, y lo lee en el registro del servidor. A la pantalla del
      // socio le sirve saber qué hacer, no cómo se llama un ajuste de Vercel.
      console.error(
        "[api/v1/auth/password-recovery] no hay con qué mandar el correo",
        connection.reason,
      );
      throw new ApiError(
        "service_unavailable",
        RECOVERY_EMAIL_UNAVAILABLE_MESSAGE,
      );
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
        emailLocales: wiring.gateways.emailLocales,
      },
      { email, now: new Date(), buildResetUrl: resetUrlBuilder(request) },
    );
    if (outcome.kind === "rate_limited") {
      throw new ApiError(
        "rate_limited",
        describeRateLimit(outcome.retryAfterMinutes),
      );
    }
    // Lo que depende de la cuenta va después de responder, para que lo que
    // tarda la respuesta no delate si existe.
    const { deliver } = outcome;
    runAfterResponse(() => deliverRecoveryLink(deliver, email));
    return { data: { outcome: "recovery_requested", email } };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: postPasswordRecovery,
});
