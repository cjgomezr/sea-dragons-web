import { ApiError } from "@/lib/api/response";
import { asAccountApiError } from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  GroupNameTakenError,
  GroupNotFoundError,
  type GroupsGateways,
  GroupsForbiddenError,
  InvalidGroupNameError,
} from "./groups";
import { createSupabaseGroupsGateways } from "./supabase-groups-gateways";

/**
 * Lo que comparten los endpoints de grupos (#226): cómo se cablean y cómo
 * responde cada error del dominio con su código de la convención.
 */

export function requireGroupsGateways(): GroupsGateways {
  const wiring = createSupabaseGroupsGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

export function asGroupsApiError(error: unknown): never {
  if (error instanceof InvalidGroupNameError) {
    throw new ApiError("validation_error", error.message);
  }
  if (error instanceof GroupNameTakenError) {
    throw new ApiError("conflict", error.message);
  }
  if (error instanceof GroupNotFoundError) {
    throw new ApiError("not_found", error.message);
  }
  if (error instanceof GroupsForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  return asAccountApiError(error);
}
