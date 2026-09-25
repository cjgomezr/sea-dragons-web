import { z } from "zod";
import { ApiError } from "@/lib/api/response";
import { asAccountApiError } from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import type { ClubPositions } from "./club-positions";
import { ClubSettingsForbiddenError } from "./club-settings";
import {
  type ManagedPositionsGateways,
  POSITION_NAME_MAX_LENGTH,
  POSITIONS_CHANGED_REASON,
  PositionNotFoundError,
  PositionValidationError,
  PositionsChangedError,
} from "./manage-club-positions";
import { invalidateClubPositions } from "./supabase-club-positions";
import { createSupabaseManagedPositionsGateways } from "./supabase-manage-club-positions";

/**
 * Lo que comparten los endpoints con los que el Admin administra las
 * posiciones (#300): cómo se cablean, qué cuerpo aceptan, cómo responde cada
 * error del dominio y cómo se avisa a la caché del catálogo.
 */

/** Todas las del club, archivadas incluidas, en su orden, tal como quedaron
 * después de la petición. */
export type ManagedPositionsResponse = {
  readonly positions: ClubPositions;
};

/** Un tope holgado sólo para no arrastrar un cuerpo de megas hasta el
 * dominio, que cuenta en caracteres y dice qué campo falló. */
const NAME_BODY_MAX_LENGTH = POSITION_NAME_MAX_LENGTH * 4;

/** Los dos idiomas siempre presentes; `null` es "sin nombre en éste". */
export const positionNamesBodySchema = z
  .object({
    en: z.string().max(NAME_BODY_MAX_LENGTH).nullable(),
    es: z.string().max(NAME_BODY_MAX_LENGTH).nullable(),
  })
  .strict();

export function requireManagedPositionsGateways(): ManagedPositionsGateways {
  const wiring = createSupabaseManagedPositionsGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

/** Un id que no es un uuid no nombra ninguna posición: se responde como una
 * que no existe, sin mandarle a Postgres un valor que rechazaría. */
export function readPositionId(value: string): string {
  if (!z.uuid().safeParse(value).success) {
    throw new ApiError("not_found", new PositionNotFoundError().message);
  }
  return value;
}

/** Después de cualquier cambio: el perfil y el directorio leen de la caché,
 * y sin esto seguirían con el catálogo de antes hasta que caducara. */
export function positionsChanged(
  positions: ClubPositions,
): ManagedPositionsResponse {
  invalidateClubPositions();
  return { positions };
}

/** El primer campo que no vale va como `reason`, que la pantalla traduce y
 * pone junto a ese campo. */
export function asManagedPositionsApiError(error: unknown): never {
  if (error instanceof PositionValidationError) {
    throw new ApiError(
      "validation_error",
      error.message,
      error.issues[0]?.code,
    );
  }
  if (error instanceof PositionNotFoundError) {
    throw new ApiError("not_found", error.message);
  }
  if (error instanceof PositionsChangedError) {
    throw new ApiError("conflict", error.message, POSITIONS_CHANGED_REASON);
  }
  if (error instanceof ClubSettingsForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  return asAccountApiError(error);
}
