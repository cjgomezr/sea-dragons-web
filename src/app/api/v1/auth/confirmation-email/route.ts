import { z } from "zod";
import { runAfterResponse } from "@/lib/api/after-response";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import type {
  ConfirmationEmailOutcome,
  RegistrationReceipt,
} from "@/lib/auth/register-member";
import { resendConfirmationEmail } from "@/lib/auth/confirmation-email-resend";
import { looksLikeEmail } from "@/lib/auth/registration";
import {
  DEFAULT_CLUB_SLUG,
  createSupabaseAuthGateways,
  describeMissingAuthKeys,
} from "@/lib/auth/supabase-auth-gateways";
import { describeErrorWithoutEmail } from "@/lib/email/redact-email";

// Depende del estado de la cuenta en este instante.
export const dynamic = "force-dynamic";

const confirmationEmailBodySchema = z.object({ email: z.string() });

type ConfirmationEmailBody = z.infer<typeof confirmationEmailBodySchema>;

/** La misma forma que devuelve el registro, y por el mismo motivo: reenviar la
 * confirmación tampoco puede decir si esa dirección tiene cuenta. Tampoco dice
 * si el envío salió, porque sólo se intenta enviar a cuentas sin confirmar y
 * eso lo delataría igual (#147). */
export type ConfirmationEmailResponse = RegistrationReceipt;

function describeRateLimit(retryAfterMinutes: number): string {
  return `Pediste varios correos seguidos. Espera ${retryAfterMinutes} minutos antes de pedir otro.`;
}

function reportConfirmationEmail(outcome: ConfirmationEmailOutcome): void {
  if (outcome.kind === "failed" || outcome.kind === "rate_limited") {
    console.error(
      "[api/v1/auth/confirmation-email] no se pudo reenviar la confirmación",
      outcome.reason,
    );
  }
}

/** Corre la entrega cuando la respuesta ya salió. El resultado del envío y
 * cualquier fallo inesperado van al registro del servidor, sin la dirección:
 * la respuesta no puede cambiar por ellos sin delatar la cuenta. */
async function requestConfirmationAfterResponse(
  deliver: () => Promise<ConfirmationEmailOutcome>,
  email: string,
): Promise<void> {
  try {
    reportConfirmationEmail(await deliver());
  } catch (error) {
    console.error(
      "[api/v1/auth/confirmation-email] falló el reenvío de la confirmación",
      describeErrorWithoutEmail(error, email),
    );
  }
}

const postConfirmationEmail = createApiRoute<
  ConfirmationEmailResponse,
  ConfirmationEmailBody
>({
  schema: confirmationEmailBodySchema,
  handler: async ({ request, body }) => {
    if (!looksLikeEmail(body.email)) {
      throw new ApiError(
        "business_rule",
        "email: El correo no tiene una forma válida.",
      );
    }
    const email = body.email.trim().toLowerCase();

    const wiring = createSupabaseAuthGateways(process.env);
    if (wiring.kind === "unconfigured") {
      throw new ApiError(
        "service_unavailable",
        describeMissingAuthKeys(wiring.missingKeys),
      );
    }

    const clubId =
      await wiring.gateways.clubs.findClubIdBySlug(DEFAULT_CLUB_SLUG);
    const outcome = await resendConfirmationEmail(
      {
        requests: wiring.gateways.confirmationEmailRequestsForClub(clubId),
        confirmationEmail: wiring.gateways.confirmationEmail,
      },
      { email, now: new Date(), appUrl: request.url },
    );
    // El límite no depende de que la cuenta exista, así que decirlo no delata
    // a nadie.
    if (outcome.kind === "rate_limited") {
      throw new ApiError(
        "rate_limited",
        describeRateLimit(outcome.retryAfterMinutes),
      );
    }

    // Pedir el correo va después de responder: sólo hay envío para una cuenta
    // sin confirmar, y lo que tardara la respuesta la delataría.
    const { deliver } = outcome;
    runAfterResponse(() => requestConfirmationAfterResponse(deliver, email));
    return { data: { outcome: "confirmation_pending", email } };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: postConfirmationEmail,
});
