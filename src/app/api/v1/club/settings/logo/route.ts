import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { readLimitedBody } from "@/lib/api/read-limited-body";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  CLUB_LOGO_MAX_BYTES,
  type ClubLogo,
  type ClubLogoGateways,
  type ClubLogoIssueCode,
  ClubLogoValidationError,
  removeClubLogo,
  replaceClubLogo,
} from "@/lib/club/club-logo";
import {
  CLUB_SETTINGS_CHANGED_REASON,
  ClubSettingsConflictError,
  ClubSettingsForbiddenError,
} from "@/lib/club/club-settings";
import { invalidateClubBrand } from "@/lib/club/supabase-club-brand";
import { createSupabaseClubLogoGateways } from "@/lib/club/supabase-club-logo-gateways";

/**
 * El logo del club (#295, RF-4 del PRD de E18a): PUT lo sube o lo cambia, con
 * los bytes tal cual en el cuerpo, y DELETE lo quita. Los dos responden la
 * dirección pública con la que queda la marca.
 *
 * Quién puede llamarlo lo decide la frontera: la regla de la configuración
 * del club en `RESTRICTED_ROUTES` lo reserva al Admin, y el dominio lo vuelve
 * a comprobar.
 */

// Depende de la sesión de quien llama y de la fila del club ahora.
export const dynamic = "force-dynamic";

export type ClubLogoResponse = ClubLogo;

const ISSUE_MESSAGES: Readonly<Record<ClubLogoIssueCode, string>> = {
  logo_empty: "La petición no trae ningún logo.",
  logo_too_large: "El logo puede pesar como mucho 512 KB.",
  logo_type_unsupported: "Sólo valen logos PNG o WebP.",
  logo_undecodable: "El fichero dice ser una imagen, pero no se puede leer.",
};

function rejectLogo(code: ClubLogoIssueCode): never {
  throw new ApiError("validation_error", ISSUE_MESSAGES[code], code);
}

function requireClubLogoGateways(): ClubLogoGateways {
  const wiring = createSupabaseClubLogoGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

function asClubLogoApiError(error: unknown): never {
  if (error instanceof ClubLogoValidationError) {
    rejectLogo(error.code);
  }
  if (error instanceof ClubSettingsForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  if (error instanceof ClubSettingsConflictError) {
    throw new ApiError("conflict", error.message, CLUB_SETTINGS_CHANGED_REASON);
  }
  return asAccountApiError(error);
}

/** Corta al pasar del límite, sin fiarse de `Content-Length`. */
async function readLogoBytes(request: Request): Promise<Uint8Array> {
  const body = await readLimitedBody(request, CLUB_LOGO_MAX_BYTES);
  if (body.kind === "too_large") {
    rejectLogo("logo_too_large");
  }
  return body.bytes;
}

/** Sin esto, la cabecera y la pantalla de entrar seguirían con la marca de
 * antes hasta que caducara la caché. */
async function changeLogo(
  change: (gateways: ClubLogoGateways) => Promise<ClubLogo>,
): Promise<{ data: ClubLogo }> {
  try {
    const logo = await change(requireClubLogoGateways());
    invalidateClubBrand();
    return { data: logo };
  } catch (error) {
    asClubLogoApiError(error);
  }
}

const putLogo = createApiRoute<ClubLogoResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    const bytes = await readLogoBytes(request);
    return changeLogo((gateways) =>
      replaceClubLogo(gateways, { callerId, bytes }),
    );
  },
});

const deleteLogo = createApiRoute<ClubLogoResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    return changeLogo((gateways) => removeClubLogo(gateways, { callerId }));
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  PUT: putLogo,
  DELETE: deleteLogo,
});
