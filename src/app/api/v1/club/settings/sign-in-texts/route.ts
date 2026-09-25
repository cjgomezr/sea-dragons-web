import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { ClubSettingsForbiddenError } from "@/lib/club/club-settings";
import {
  readSignInTexts,
  SIGN_IN_WELCOME_MAX_LENGTH,
  type SignInTexts,
  type SignInTextsGateways,
  SignInTextsValidationError,
  updateSignInTexts,
} from "@/lib/club/sign-in-texts";
import { invalidateClubBrand } from "@/lib/club/supabase-club-brand";
import { createSupabaseSignInTextsGateways } from "@/lib/club/supabase-sign-in-texts-gateways";

/**
 * Los textos del inicio de sesión (#301, RF-5 del PRD de E18a): GET los lee
 * y PUT deja los de los dos idiomas. Un texto vacío o nulo es "el de la
 * aplicación".
 *
 * Cuelga de la configuración del club, así que `RESTRICTED_ROUTES` ya lo
 * reserva al Admin, y el dominio lo vuelve a comprobar.
 */

// Depende de la sesión de quien llama y de lo que el club guardó ahora.
export const dynamic = "force-dynamic";

/** Un tope holgado sólo para no arrastrar un cuerpo de megas hasta el
 * dominio, que cuenta en caracteres y dice qué campo se pasó. Lo que pasa de
 * aquí responde 400 sin `reason`: la pantalla valida antes, así que sólo lo
 * ve quien llama a la API a mano. */
const TEXT_BODY_MAX_LENGTH = SIGN_IN_WELCOME_MAX_LENGTH * 4;

const textSchema = z.string().max(TEXT_BODY_MAX_LENGTH).nullable();

const localeTextsSchema = z
  .object({ tagline: textSchema, welcome: textSchema })
  .strict();

/** Los dos idiomas siempre presentes, como los nombres de una posición. */
const signInTextsBodySchema = z
  .object({ en: localeTextsSchema, es: localeTextsSchema })
  .strict();

/** Los textos tal como quedaron en la base después de la petición. */
export type SignInTextsResponse = SignInTexts;

function requireSignInTextsGateways(): SignInTextsGateways {
  const wiring = createSupabaseSignInTextsGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

/** El primer texto que se pasa va como `reason` (`es.tagline_too_long`): la
 * pantalla lo pinta junto a ese campo. */
function asSignInTextsApiError(error: unknown): never {
  if (error instanceof SignInTextsValidationError) {
    const [issue] = error.issues;
    throw new ApiError(
      "validation_error",
      error.message,
      issue === undefined ? undefined : `${issue.locale}.${issue.code}`,
    );
  }
  if (error instanceof ClubSettingsForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  return asAccountApiError(error);
}

export function GET(request: NextRequest): Promise<NextResponse> {
  const route = createApiRoute<SignInTextsResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      try {
        return {
          data: await readSignInTexts(requireSignInTextsGateways(), {
            callerId,
          }),
        };
      } catch (error) {
        asSignInTextsApiError(error);
      }
    },
  });
  return route(request);
}

export function PUT(request: NextRequest): Promise<NextResponse> {
  const route = createApiRoute<SignInTextsResponse, SignInTexts>({
    schema: signInTextsBodySchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      try {
        const texts = await updateSignInTexts(requireSignInTextsGateways(), {
          callerId,
          texts: body,
        });
        // Sin esto, la pantalla de entrar seguiría con los textos de antes
        // hasta que caducara la caché de la marca (RF-2).
        invalidateClubBrand();
        return { data: texts };
      } catch (error) {
        asSignInTextsApiError(error);
      }
    },
  });
  return route(request);
}

export const { POST, PATCH, DELETE } = createApiModule({});
