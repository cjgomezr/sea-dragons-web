import { ApiError } from "@/lib/api/response";
import { asAccountApiError } from "./account-api";
import {
  type ClubAdministrationGateways,
  ClubAdministrationForbiddenError,
} from "./club-administration";
import { describeMissingAuthKeys } from "./supabase-auth-gateways";
import { createSupabaseClubAdministrationGateways } from "./supabase-club-administration-gateways";

/**
 * Lo que comparten los dos endpoints de lectura de la pantalla de
 * administración (#212): la lista de socios y la bandeja de solicitudes
 * pendientes. Los dos se cablean igual y responden igual a quien no gestiona
 * usuarios y roles.
 */

export function requireClubAdministrationGateways(): ClubAdministrationGateways {
  const wiring = createSupabaseClubAdministrationGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

export function asClubAdministrationApiError(error: unknown): never {
  if (error instanceof ClubAdministrationForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  return asAccountApiError(error);
}
