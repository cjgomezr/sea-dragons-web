import { z } from "zod";
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
import {
  GroupMemberNotFoundError,
  type GroupMembersGateways,
  InactiveMemberError,
} from "./group-members";
import { createSupabaseGroupMembersGateways } from "./supabase-group-members-gateways";
import { createSupabaseGroupsGateways } from "./supabase-groups-gateways";

/**
 * Lo que comparten los endpoints de grupos (#226) y de sus socios (#227):
 * cómo se cablean, cómo leen los ids del camino y cómo responde cada error del
 * dominio con su código de la convención.
 */

/** Un id que no es un uuid no puede nombrar a ningún grupo ni a ningún socio:
 * se responde como uno que no existe, sin mandarle a Postgres un valor que
 * rechazaría. */
function readUuid(value: string, notFound: Error): string {
  if (!z.uuid().safeParse(value).success) {
    throw new ApiError("not_found", notFound.message);
  }
  return value;
}

export function readGroupId(value: string): string {
  return readUuid(value, new GroupNotFoundError());
}

export function readMemberId(value: string): string {
  return readUuid(value, new GroupMemberNotFoundError());
}

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

export function requireGroupMembersGateways(): GroupMembersGateways {
  const wiring = createSupabaseGroupMembersGateways(process.env);
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
  if (
    error instanceof GroupNotFoundError ||
    error instanceof GroupMemberNotFoundError
  ) {
    throw new ApiError("not_found", error.message);
  }
  if (error instanceof InactiveMemberError) {
    throw new ApiError("business_rule", error.message);
  }
  if (error instanceof GroupsForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  return asAccountApiError(error);
}
