import type { NextRequest } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { readLimitedBody } from "@/lib/api/read-limited-body";
import { ApiError, NO_CONTENT_STATUS } from "@/lib/api/response";
import {
  type AccountSession,
  asAccountApiError,
  openAccountSession,
} from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  AccountNotOperatingError,
  PROFILE_PHOTO_MAX_BYTES,
  type ProfilePhoto,
  type ProfilePhotoGateways,
  type ProfilePhotoIssueCode,
  ProfilePhotoValidationError,
  removeProfilePhoto,
  replaceProfilePhoto,
} from "@/lib/members/profile-photo";
import { createSupabaseProfilePhotoGateways } from "@/lib/members/supabase-profile-photo-gateways";

/**
 * La foto de perfil propia (#245, FR-084). PUT sube o reemplaza, con los
 * bytes de la imagen como cuerpo; DELETE la quita. Pasa por aquí y no directo
 * del navegador al almacenamiento para que el tamaño y el tipo se comprueben
 * en el servidor, y es el mismo endpoint que usará la aplicación nativa de
 * Release 2 (CON-002).
 *
 * Actúa siempre sobre quien identifica la cookie. Una petición que nombra a
 * otro miembro no se atiende en silencio sobre quien llama: recibe 403, para
 * que el intento quede claro, igual que los campos reservados de #241.
 */

// Depende de la sesión de quien llama y escribe su foto.
export const dynamic = "force-dynamic";

/** Los parámetros con los que alguien podría intentar apuntar a otra ficha. */
const TARGET_MEMBER_PARAMS = ["userId", "memberId"] as const;

const ISSUE_MESSAGES: Readonly<Record<ProfilePhotoIssueCode, string>> = {
  photo_empty: "La petición no trae ninguna foto.",
  photo_too_large: "La foto puede pesar como mucho 2 MB.",
  photo_type_unsupported: "Sólo valen fotos JPEG, PNG o WebP.",
};

const NOT_OWN_PHOTO_MESSAGE = "Sólo puedes cambiar tu propia foto de perfil.";
const NOT_OPERATING_MESSAGE =
  "Tu cuenta no está activa, así que no puede cambiar su foto.";

export type AccountProfilePhotoResponse = ProfilePhoto;

function rejectOtherMembers(request: NextRequest, callerId: string): void {
  const targets = TARGET_MEMBER_PARAMS.flatMap(
    (param) => request.nextUrl.searchParams.get(param) ?? [],
  );
  if (targets.some((target) => target !== callerId)) {
    throw new ApiError("forbidden", NOT_OWN_PHOTO_MESSAGE, "not_own_photo");
  }
}

function requirePhotoGateways(session: AccountSession): ProfilePhotoGateways {
  const wiring = createSupabaseProfilePhotoGateways(
    process.env,
    session.client,
  );
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

function rejectPhoto(code: ProfilePhotoIssueCode): never {
  throw new ApiError("validation_error", ISSUE_MESSAGES[code], code);
}

function asPhotoApiError(error: unknown): never {
  if (error instanceof ProfilePhotoValidationError) {
    rejectPhoto(error.code);
  }
  if (error instanceof AccountNotOperatingError) {
    throw new ApiError(
      "forbidden",
      NOT_OPERATING_MESSAGE,
      "account_not_operating",
    );
  }
  return asAccountApiError(error);
}

/** El cuerpo, leído como mucho hasta el límite: una foto de más se rechaza
 * sin cargarla entera. */
async function readPhotoBytes(request: NextRequest): Promise<Uint8Array> {
  const body = await readLimitedBody(request, PROFILE_PHOTO_MAX_BYTES);
  if (body.kind === "too_large") {
    rejectPhoto("photo_too_large");
  }
  return body.bytes;
}

const putPhoto = createApiRoute<AccountProfilePhotoResponse>({
  handler: async ({ request, decorateResponse }) => {
    const session = await openAccountSession({ request, decorateResponse });
    rejectOtherMembers(request, session.userId);
    const bytes = await readPhotoBytes(request);
    try {
      return {
        data: await replaceProfilePhoto(requirePhotoGateways(session), {
          userId: session.userId,
          bytes,
        }),
      };
    } catch (error) {
      asPhotoApiError(error);
    }
  },
});

const deletePhoto = createApiRoute<never>({
  handler: async ({ request, decorateResponse }) => {
    const session = await openAccountSession({ request, decorateResponse });
    rejectOtherMembers(request, session.userId);
    try {
      await removeProfilePhoto(requirePhotoGateways(session), session.userId);
      return { status: NO_CONTENT_STATUS };
    } catch (error) {
      asPhotoApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  PUT: putPhoto,
  DELETE: deletePhoto,
});
