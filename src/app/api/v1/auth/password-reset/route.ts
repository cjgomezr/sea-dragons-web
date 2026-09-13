import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { resetPassword } from "@/lib/auth/password-recovery";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { createSupabasePasswordRecoveryGateways } from "@/lib/auth/supabase-password-recovery";

/**
 * Fijar la contraseña nueva con el token del enlace de recuperación (RF-6).
 * Público: el token es la credencial.
 *
 * El token se canjea aquí, cuando llega la contraseña, y no al abrir el enlace.
 * Los filtros de correo abren los enlaces para inspeccionarlos, y un canje al
 * abrir gastaría el enlace de un solo uso antes de que su dueño lo viera.
 */

// Gasta un token y cambia una contraseña: nada aquí se puede cachear.
export const dynamic = "force-dynamic";

const passwordResetBodySchema = z.object({
  tokenHash: z.string().min(1),
  password: z.string(),
});

type PasswordResetBody = z.infer<typeof passwordResetBodySchema>;

export type PasswordResetResponse = { readonly outcome: "password_changed" };

/** Caducado y ya usado dicen lo mismo: para quien lo abre, los dos se arreglan
 * pidiendo otro. El motivo técnico no sale del servidor. */
const LINK_UNUSABLE_MESSAGE =
  "Este enlace ya no sirve: caducó o ya se usó. Pide otro enlace para cambiar tu contraseña.";

const postPasswordReset = createApiRoute<
  PasswordResetResponse,
  PasswordResetBody
>({
  schema: passwordResetBodySchema,
  handler: async ({ body }) => {
    const wiring = await createSupabasePasswordRecoveryGateways(process.env);
    if (wiring.kind === "unconfigured") {
      throw new ApiError(
        "service_unavailable",
        describeMissingAuthKeys(wiring.missingKeys),
      );
    }

    const outcome = await resetPassword(
      { tokens: wiring.gateways.redeemer, audit: wiring.gateways.audit },
      body,
    );
    switch (outcome.kind) {
      case "invalid_password":
        throw new ApiError("business_rule", `password: ${outcome.message}`);
      case "link_unusable":
        throw new ApiError("gone", LINK_UNUSABLE_MESSAGE);
      case "password_changed":
        return { data: { outcome: "password_changed" } };
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: postPasswordReset,
});
