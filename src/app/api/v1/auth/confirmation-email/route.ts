import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import type {
  RegistrationReceipt,
  RequestedConfirmationEmail,
} from "@/lib/auth/register-member";
import { looksLikeEmail } from "@/lib/auth/registration";
import {
  createSupabaseAuthGateways,
  describeMissingAuthKeys,
} from "@/lib/auth/supabase-auth-gateways";

// Depende del estado de la cuenta en este instante.
export const dynamic = "force-dynamic";

const confirmationEmailBodySchema = z.object({ email: z.string() });

type ConfirmationEmailBody = z.infer<typeof confirmationEmailBodySchema>;

/** La misma forma que devuelve el registro, y por el mismo motivo: reenviar la
 * confirmación tampoco puede decir si esa dirección tiene cuenta. Tampoco dice
 * si el envío salió, porque Supabase sólo intenta enviar a cuentas sin
 * confirmar y eso lo delataría igual (#147). */
export type ConfirmationEmailResponse = RegistrationReceipt;

function reportConfirmationEmail(outcome: RequestedConfirmationEmail): void {
  if (outcome.kind !== "requested") {
    console.error(
      "[api/v1/auth/confirmation-email] no se pudo reenviar la confirmación",
      outcome.reason,
    );
  }
}

const postConfirmationEmail = createApiRoute<
  ConfirmationEmailResponse,
  ConfirmationEmailBody
>({
  schema: confirmationEmailBodySchema,
  handler: async ({ body }) => {
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

    reportConfirmationEmail(
      await wiring.gateways.confirmationEmail.requestConfirmationEmail(email),
    );
    return { data: { outcome: "confirmation_pending", email } };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: postConfirmationEmail,
});
