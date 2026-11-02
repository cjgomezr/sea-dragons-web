import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError, ApiErrorWithDetails } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import {
  DEFAULT_CLUB_SLUG,
  describeMissingAuthKeys,
} from "@/lib/auth/supabase-auth-gateways";
import { ClubSettingsForbiddenError } from "@/lib/club/club-settings";
import {
  readClubSocialLinks,
  SOCIAL_LINK_MAX_LENGTH,
  type SocialLinks,
  type SocialLinksGateways,
  SocialLinksValidationError,
  updateSocialLinks,
} from "@/lib/club/social-links";
import { createSupabaseSocialLinksGateways } from "@/lib/club/supabase-social-links-gateways";

/**
 * Las redes del club (#963, RF-1 del PRD de E37): GET las lee y PUT deja las
 * seis de una vez. Un enlace vacío o nulo quita esa red.
 *
 * GET es público a propósito (D2): la frontera lo deja pasar sin sesión por
 * `PUBLIC_READ_API_PATHS`. PUT cuelga de la configuración del club, así que
 * `RESTRICTED_ROUTES` lo reserva al Admin, y el dominio lo vuelve a
 * comprobar.
 */

// Depende de lo que el club guardó ahora y, en el PUT, de quien llama.
export const dynamic = "force-dynamic";

/** Un tope holgado sólo para no arrastrar un cuerpo de megas hasta el
 * dominio, que mide recortado y dice qué red se pasó. */
const LINK_BODY_MAX_LENGTH = SOCIAL_LINK_MAX_LENGTH * 4;

const linkSchema = z.string().max(LINK_BODY_MAX_LENGTH).nullable();

/** Las seis redes siempre presentes: el PUT reemplaza el conjunto entero. */
const socialLinksBodySchema = z
  .object({
    instagram: linkSchema,
    tiktok: linkSchema,
    youtube: linkSchema,
    facebook: linkSchema,
    whatsapp: linkSchema,
    website: linkSchema,
  })
  .strict();

/** Las redes tal como quedaron en la base después de la petición. */
export type SocialLinksResponse = SocialLinks;

function requireSocialLinksGateways(): SocialLinksGateways {
  const wiring = createSupabaseSocialLinksGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

/** La primera red que no vale va como `reason` (`instagram.wrong_domain`),
 * y todas en `issues`: la pantalla pinta cada una junto a su campo. */
function asSocialLinksApiError(error: unknown): never {
  if (error instanceof SocialLinksValidationError) {
    const [first] = error.issues;
    throw new ApiErrorWithDetails("validation_error", error.message, {
      reason: first === undefined ? "" : `${first.network}.${first.code}`,
      details: { issues: error.issues },
    });
  }
  if (error instanceof ClubSettingsForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  return asAccountApiError(error);
}

export function GET(request: NextRequest): Promise<NextResponse> {
  const route = createApiRoute<SocialLinksResponse>({
    handler: async () => ({
      data: await readClubSocialLinks(requireSocialLinksGateways(), {
        clubSlug: DEFAULT_CLUB_SLUG,
      }),
    }),
  });
  return route(request);
}

export function PUT(request: NextRequest): Promise<NextResponse> {
  const route = createApiRoute<SocialLinksResponse, SocialLinks>({
    schema: socialLinksBodySchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      try {
        return {
          data: await updateSocialLinks(requireSocialLinksGateways(), {
            callerId,
            links: body,
          }),
        };
      } catch (error) {
        asSocialLinksApiError(error);
      }
    },
  });
  return route(request);
}

export const { POST, PATCH, DELETE } = createApiModule({});
