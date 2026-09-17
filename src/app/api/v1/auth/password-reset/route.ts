import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { describeIssuesForApi } from "@/lib/auth/issue-messages";
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

/** El `hashed_token` de Supabase Auth es un hash hexadecimal de unas decenas de
 * caracteres. El tope deja margen de sobra y evita que un endpoint público
 * reenvíe al servicio de autenticación cadenas de cualquier tamaño. */
const MAX_TOKEN_HASH_LENGTH = 512;

const passwordResetBodySchema = z.object({
  tokenHash: z.string().min(1).max(MAX_TOKEN_HASH_LENGTH),
  password: z.string(),
});

type PasswordResetBody = z.infer<typeof passwordResetBodySchema>;

export type PasswordResetResponse = { readonly outcome: "password_changed" };

/** Caducado y ya usado dicen lo mismo: para quien lo abre, los dos se arreglan
 * pidiendo otro. El motivo técnico no sale del servidor. */
const LINK_UNUSABLE_MESSAGE =
  "Este enlace ya no sirve: caducó o ya se usó. Pide otro enlace para cambiar tu contraseña.";

/** Responde como enlace gastado (410) y no como campo inválido (422), porque
 * eso es lo que quedó: el canje ya ocurrió, y reintentar con el mismo enlace
 * no lleva a ninguna parte. El mensaje dice además por qué no se aceptó. */
const PASSWORD_REJECTED_MESSAGE =
  "No pudimos usar esa contraseña: es igual a la anterior o demasiado débil. El enlace ya se usó al intentarlo, así que pide otro enlace y elige una distinta.";

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
        throw new ApiError(
          "business_rule",
          describeIssuesForApi([{ field: "password", code: outcome.code }]),
        );
      // Los dos son el mismo 410, pero la pantalla los explica distinto: tras
      // una contraseña rechazada hay que elegir otra, no sólo pedir otro
      // enlace. El motivo viaja aparte para que no tenga que leer la frase.
      case "password_rejected":
        throw new ApiError("gone", PASSWORD_REJECTED_MESSAGE, outcome.kind);
      case "link_unusable":
        throw new ApiError("gone", LINK_UNUSABLE_MESSAGE, outcome.kind);
      case "password_changed":
        return { data: { outcome: "password_changed" } };
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: postPasswordReset,
});
