import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  FULL_NAME_MAX_LENGTH,
  type OwnProfile,
  type OwnProfileGateways,
  ProfileValidationError,
  updateOwnProfile,
} from "@/lib/members/own-profile";
import { createSupabaseOwnProfileGateways } from "@/lib/members/supabase-own-profile-gateways";

/**
 * Editar el perfil propio (#241, FR-084, AC-039). Actúa siempre sobre quien
 * identifica la cookie de sesión, nunca sobre un id del cuerpo, igual que
 * `POST /api/v1/role-requests`. Lo alcanza cualquier cuenta activa; una
 * incompleta recibe 403 de la frontera antes de llegar aquí.
 *
 * Se mandan los cinco campos siempre: la ficha editable es pequeña, y así no
 * hay que distinguir "no lo toco" de "lo vacío".
 */

// Depende de la sesión de quien llama y escribe su fila.
export const dynamic = "force-dynamic";

/** Lo que la decisión B3 reserva al Admin. No se ignoran en silencio: quien
 * los mande recibe 403 con su nombre, para que el intento quede claro
 * (AC-039). Se nombran con la grafía con la que la API los sirve en el
 * directorio. */
const RESERVED_PROFILE_FIELDS = [
  "role",
  "aufNumber",
  "aufExpiry",
  "groups",
  "status",
  // De ella depende si hace falta el consentimiento del tutor (NFR-012): sólo
  // la corrige un Admin, desde la ficha (#272).
  "dateOfBirth",
] as const;

/** Un tope holgado sólo para no arrastrar un cuerpo de megas hasta el
 * dominio, que cuenta el nombre en caracteres y no en unidades UTF-16. */
const FULL_NAME_BODY_MAX_LENGTH = FULL_NAME_MAX_LENGTH * 4;

/** Se aceptan en la forma sólo para poder rechazarlos por su nombre. */
const reservedField = z.unknown().optional();

/** Sólo la forma. Que el país, la posición, el nivel y el género existan lo
 * decide el dominio, que dice además cuál falló. `strict` responde 400 a
 * cualquier campo que no sea del perfil, como un `userId`. */
const profileBodySchema = z
  .object({
    fullName: z.string().max(FULL_NAME_BODY_MAX_LENGTH),
    country: z.string(),
    position: z.string().nullable(),
    experienceLevel: z.string().nullable(),
    gender: z.string().nullable(),
    role: reservedField,
    aufNumber: reservedField,
    aufExpiry: reservedField,
    groups: reservedField,
    status: reservedField,
    dateOfBirth: reservedField,
  })
  .strict();

type ProfileBody = z.infer<typeof profileBodySchema>;

/** La ficha tal como quedó guardada. */
export type AccountProfileResponse = OwnProfile;

function rejectReservedFields(body: ProfileBody): void {
  const attempted = RESERVED_PROFILE_FIELDS.filter(
    (field) => body[field] !== undefined,
  );
  if (attempted.length > 0) {
    throw new ApiError(
      "forbidden",
      `Sólo un Admin puede cambiar estos campos: ${attempted.join(", ")}.`,
      "reserved_fields",
    );
  }
}

function requireOwnProfileGateways(): OwnProfileGateways {
  const wiring = createSupabaseOwnProfileGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

/** El primer campo que no vale va como `reason`, que la pantalla traduce; el
 * mensaje los nombra todos para quien depura la API. */
function asApiError(error: unknown): never {
  if (error instanceof ProfileValidationError) {
    throw new ApiError(
      "validation_error",
      error.message,
      error.issues[0]?.code,
    );
  }
  return asAccountApiError(error);
}

const patchProfile = createApiRoute<AccountProfileResponse, ProfileBody>({
  schema: profileBodySchema,
  handler: async ({ request, body, decorateResponse }) => {
    rejectReservedFields(body);
    const userId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await updateOwnProfile(requireOwnProfileGateways(), {
          userId,
          submission: {
            fullName: body.fullName,
            country: body.country,
            position: body.position,
            experienceLevel: body.experienceLevel,
            gender: body.gender,
          },
        }),
      };
    } catch (error) {
      asApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  PATCH: patchProfile,
});
