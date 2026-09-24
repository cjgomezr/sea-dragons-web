import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  CLUB_INITIALS_MAX_LENGTH,
  CLUB_NAME_MAX_LENGTH,
  CLUB_SETTINGS_CHANGED_REASON,
  ClubSettingsConflictError,
  ClubSettingsForbiddenError,
  type ClubSettings,
  type ClubSettingsGateways,
  ClubSettingsValidationError,
  readClubSettings,
  updateClubSettings,
} from "@/lib/club/club-settings";
import { invalidateClubBrand } from "@/lib/club/supabase-club-brand";
import { createSupabaseClubSettingsGateways } from "@/lib/club/supabase-club-settings-gateways";

/**
 * La configuración del club (#296, RF-6 del PRD de E18a): GET la lee y PATCH
 * cambia el nombre y las iniciales.
 *
 * Quién puede llamarlo lo decide la frontera: `RESTRICTED_ROUTES` lo reserva
 * al Admin, y el dominio lo vuelve a comprobar. El PATCH lleva lo que el
 * Admin tenía delante en `expected`: si otro Admin guardó entretanto, responde
 * 409 y no pisa nada.
 */

// Depende de la sesión de quien llama y de la fila del club ahora.
export const dynamic = "force-dynamic";

/** Topes holgados sólo para no arrastrar un cuerpo de megas hasta el
 * dominio, que cuenta en caracteres y dice qué campo falló. */
const NAME_BODY_MAX_LENGTH = CLUB_NAME_MAX_LENGTH * 4;
const INITIALS_BODY_MAX_LENGTH = CLUB_INITIALS_MAX_LENGTH * 4;

const identityShape = {
  name: z.string().max(NAME_BODY_MAX_LENGTH),
  initials: z.string().max(INITIALS_BODY_MAX_LENGTH).nullable(),
};

/** Sólo la forma. `strict` responde 400 a cualquier campo que no sea de esta
 * pantalla, como el `slug`, que no se cambia (fuera de alcance). */
const settingsBodySchema = z
  .object({
    ...identityShape,
    expected: z.object(identityShape).strict(),
  })
  .strict();

type SettingsBody = z.infer<typeof settingsBodySchema>;

/** La configuración tal como está en la base después de la petición. */
export type ClubSettingsResponse = ClubSettings;

function requireClubSettingsGateways(): ClubSettingsGateways {
  const wiring = createSupabaseClubSettingsGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

/** El primer campo que no vale va como `reason`, que la pantalla traduce. */
function asClubSettingsApiError(error: unknown): never {
  if (error instanceof ClubSettingsValidationError) {
    throw new ApiError(
      "validation_error",
      error.message,
      error.issues[0]?.code,
    );
  }
  if (error instanceof ClubSettingsForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  if (error instanceof ClubSettingsConflictError) {
    throw new ApiError("conflict", error.message, CLUB_SETTINGS_CHANGED_REASON);
  }
  return asAccountApiError(error);
}

export function GET(request: NextRequest): Promise<NextResponse> {
  const route = createApiRoute<ClubSettingsResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      try {
        return {
          data: await readClubSettings(requireClubSettingsGateways(), {
            callerId,
          }),
        };
      } catch (error) {
        asClubSettingsApiError(error);
      }
    },
  });
  return route(request);
}

export function PATCH(request: NextRequest): Promise<NextResponse> {
  const route = createApiRoute<ClubSettingsResponse, SettingsBody>({
    schema: settingsBodySchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const { expected, ...identity } = body;
      try {
        const settings = await updateClubSettings(
          requireClubSettingsGateways(),
          { callerId, submission: { identity, expected } },
        );
        // Sin esto, la cabecera seguiría enseñando el nombre de antes hasta
        // que caducara la caché (RF-2).
        invalidateClubBrand();
        return { data: settings };
      } catch (error) {
        asClubSettingsApiError(error);
      }
    },
  });
  return route(request);
}

export const { POST, PUT, DELETE } = createApiModule({});
