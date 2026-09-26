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
  DirectoryMemberNotFoundError,
  type MemberPhotoGateways,
  readLargeMemberPhoto,
} from "@/lib/directory/member-photo";
import { createSupabaseDirectoryGateways } from "@/lib/directory/supabase-directory-gateways";
import type { ProfilePhoto } from "@/lib/members/profile-photo";

/**
 * La foto grande de un socio (#353): la dirección firmada de su versión de
 * 1024 px, para quien la abre desde el directorio. El directorio sólo sirve
 * las miniaturas; ésta se firma cuando alguien la pide.
 *
 * La alcanza cualquier cuenta activa, así que no está en `RESTRICTED_ROUTES`.
 * Quién ve a quién lo decide el dominio con la regla del directorio.
 */

// Depende de la sesión de quien llama y de la foto que el socio tenga ahora.
export const dynamic = "force-dynamic";

export type DirectoryMemberPhotoResponse = ProfilePhoto;

type MemberPhotoRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

function requirePhotoGateways(): MemberPhotoGateways {
  const wiring = createSupabaseDirectoryGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

function notFound(): never {
  throw new ApiError("not_found", new DirectoryMemberNotFoundError().message);
}

/** Un id que no es un uuid no nombra a ningún socio: se responde como uno
 * que no está, sin leer el club. */
async function readMemberId(context: MemberPhotoRouteContext): Promise<string> {
  const { id } = await context.params;
  return z.uuid().safeParse(id).success ? id : notFound();
}

function asMemberPhotoApiError(error: unknown): never {
  if (error instanceof DirectoryMemberNotFoundError) {
    notFound();
  }
  return asAccountApiError(error);
}

export function GET(
  request: NextRequest,
  context: MemberPhotoRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<DirectoryMemberPhotoResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const userId = await readMemberId(context);
      try {
        return {
          data: await readLargeMemberPhoto(requirePhotoGateways(), {
            callerId,
            userId,
          }),
        };
      } catch (error) {
        asMemberPhotoApiError(error);
      }
    },
  });
  return route(request);
}

export const { POST, PUT, PATCH, DELETE } = createApiModule({});
