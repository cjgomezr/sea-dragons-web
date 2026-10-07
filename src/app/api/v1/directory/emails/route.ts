import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  DIRECTORY_EMAIL_DUPLICATE_REASON,
  DIRECTORY_EMAIL_FORBIDDEN_REASON,
  DIRECTORY_EMAIL_QUOTA_EXCEEDED_REASON,
  DIRECTORY_EMAIL_UNAVAILABLE_REASON,
  type DirectoryEmailGateways,
  type DirectoryEmailQuota,
  type DirectoryEmailResult,
  DirectoryEmailDuplicateError,
  DirectoryEmailForbiddenError,
  DirectoryEmailInvalidError,
  DirectoryEmailNoRecipientsError,
  DirectoryEmailQuotaExceededError,
  DirectoryEmailUnavailableError,
  INVALID_DIRECTORY_EMAIL_REASON,
  NO_DIRECTORY_EMAIL_RECIPIENTS_REASON,
  readDirectoryEmailQuota,
  sendDirectoryEmail,
} from "@/lib/directory/directory-email";
import { createSupabaseDirectoryEmailGateways } from "@/lib/directory/supabase-directory-email-gateways";

/**
 * El correo del directorio (#501, RF-6 y RF-7 del PRD de E19, D7 y D8). GET
 * dice cuántos correos le quedan hoy al directorio; POST manda uno a los
 * socios elegidos, cada uno con el suyo.
 *
 * Lo alcanza cualquier cuenta activa por la frontera, como el directorio:
 * que quien llama sea Admin o Committee lo decide el dominio con el rol que
 * tiene al enviar, no con el que tenía al abrir el formulario.
 *
 * `requestId` lo genera quien llama una vez por envío. La misma petición dos
 * veces (un doble clic, un reintento de la red) responde 409 sin mandar nada
 * otra vez.
 */

// Depende de la sesión de quien llama y de lo que el directorio ya mandó.
export const dynamic = "force-dynamic";

/** Un club tiene decenas de socios, no miles: esto sólo pone tope a lo que
 * se le puede pedir a la base en una consulta. */
const MAX_RECIPIENT_IDS = 1_000;

const emailBodySchema = z.object({
  requestId: z.uuid(),
  subject: z.string(),
  message: z.string(),
  recipientIds: z.array(z.uuid()).min(1).max(MAX_RECIPIENT_IDS),
});

type EmailBody = z.infer<typeof emailBodySchema>;

export type DirectoryEmailQuotaResponse = DirectoryEmailQuota;
export type DirectoryEmailResponse = DirectoryEmailResult;

function requireEmailGateways(): DirectoryEmailGateways {
  const wiring = createSupabaseDirectoryEmailGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

/** Los rechazos que sólo dicen qué regla se incumplió, con su código. */
const PLAIN_REJECTIONS = [
  [DirectoryEmailForbiddenError, "forbidden", DIRECTORY_EMAIL_FORBIDDEN_REASON],
  [
    DirectoryEmailInvalidError,
    "validation_error",
    INVALID_DIRECTORY_EMAIL_REASON,
  ],
  [
    DirectoryEmailNoRecipientsError,
    "validation_error",
    NO_DIRECTORY_EMAIL_RECIPIENTS_REASON,
  ],
  [
    DirectoryEmailQuotaExceededError,
    "conflict",
    DIRECTORY_EMAIL_QUOTA_EXCEEDED_REASON,
  ],
  [DirectoryEmailDuplicateError, "conflict", DIRECTORY_EMAIL_DUPLICATE_REASON],
  [
    DirectoryEmailUnavailableError,
    "service_unavailable",
    DIRECTORY_EMAIL_UNAVAILABLE_REASON,
  ],
] as const;

function asEmailApiError(error: unknown): never {
  const rejection = PLAIN_REJECTIONS.find(
    ([errorClass]) => error instanceof errorClass,
  );
  if (rejection !== undefined && error instanceof Error) {
    const [, code, reason] = rejection;
    throw new ApiError(code, error.message, reason);
  }
  return asAccountApiError(error);
}

const getQuota = createApiRoute<DirectoryEmailQuotaResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await readDirectoryEmailQuota(requireEmailGateways(), {
          callerId,
          now: new Date(),
        }),
      };
    } catch (error) {
      asEmailApiError(error);
    }
  },
});

const postEmail = createApiRoute<DirectoryEmailResponse, EmailBody>({
  schema: emailBodySchema,
  handler: async ({ request, body, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await sendDirectoryEmail(requireEmailGateways(), {
          callerId,
          requestId: body.requestId,
          draft: { subject: body.subject, message: body.message },
          recipientIds: body.recipientIds,
          now: new Date(),
        }),
      };
    } catch (error) {
      asEmailApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getQuota,
  POST: postEmail,
});
