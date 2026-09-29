import { z } from "zod";
import { ApiError } from "@/lib/api/response";
import { asAccountApiError } from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { EventNotFoundError } from "@/lib/events/event-rsvp";
import type { MyTeamGateways } from "./my-team";
import {
  createSupabaseMyTeamGateways,
  createSupabaseTeamBuilderGateways,
  type TeamsWiring,
} from "./supabase-team-builder-gateways";
import {
  TEAM_IDS,
  TEAM_PLAYER_OUTSIDE_SQUAD_REASON,
  TEAM_SPLIT_EMPTY_REASON,
  TEAM_SQUAD_EMPTY_REASON,
  TeamBuilderForbiddenError,
  type TeamBuilderGateways,
  TeamEventClosedError,
  TeamPlayerOutsideSquadError,
  TeamSplitEmptyError,
  TeamSplitInvalidError,
  TeamSquadEmptyError,
} from "./team-builder";

/**
 * Lo que comparten los endpoints del team builder y de "mi equipo" (#401):
 * cómo se cablean, la forma del reparto que llega y cómo responde cada error
 * del dominio.
 *
 * Un reparto sin la forma debida (un equipo fuera de `a` y `b`, un jugador
 * repetido, un color que no es `#RRGGBB` o un id que no es uuid) es un 400.
 * Uno con la forma pero que el evento no admite, un 422 con su `reason`.
 */

/** Como `team_splits` en `0046`: el nombre se mide recortado. */
const TEAM_NAME_MAX_LENGTH = 40;

const teamLabelSchema = z.object({
  name: z.string().trim().min(1).max(TEAM_NAME_MAX_LENGTH),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

/** `{ teams: { a, b }, assignments: [{ userId, team }] }`: el reparto entero,
 * cada jugador una vez. Vacío vale: es devolver a todos a la lista. */
export const teamSplitSchema = z.object({
  teams: z.object({ a: teamLabelSchema, b: teamLabelSchema }),
  assignments: z
    .array(z.object({ userId: z.uuid(), team: z.enum(TEAM_IDS) }))
    .refine(
      (assignments) =>
        new Set(assignments.map((assignment) => assignment.userId)).size ===
        assignments.length,
      { message: "Cada jugador va una sola vez en el reparto." },
    ),
});

function requireWired<Gateways>(wiring: TeamsWiring<Gateways>): Gateways {
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

export function requireTeamBuilderGateways(): TeamBuilderGateways {
  return requireWired(createSupabaseTeamBuilderGateways(process.env));
}

export function requireMyTeamGateways(): MyTeamGateways {
  return requireWired(createSupabaseMyTeamGateways(process.env));
}

/** Un id que no es uuid no puede ser el de ningún evento: 404, sin preguntarle
 * a Postgres, que lo rechazaría con un error de tipo. */
export function readTeamEventId(value: string): string {
  if (!z.uuid().safeParse(value).success) {
    throw new ApiError("not_found", new EventNotFoundError().message);
  }
  return value;
}

/** El `reason` del 422 de cada regla que no depende del evento. */
function businessRuleReason(error: unknown): string | null {
  if (error instanceof TeamPlayerOutsideSquadError) {
    return TEAM_PLAYER_OUTSIDE_SQUAD_REASON;
  }
  if (error instanceof TeamSquadEmptyError) {
    return TEAM_SQUAD_EMPTY_REASON;
  }
  if (error instanceof TeamSplitEmptyError) {
    return TEAM_SPLIT_EMPTY_REASON;
  }
  return null;
}

export function asTeamsApiError(error: unknown): never {
  if (error instanceof TeamBuilderForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  if (error instanceof EventNotFoundError) {
    throw new ApiError("not_found", error.message);
  }
  if (error instanceof TeamEventClosedError) {
    throw new ApiError("business_rule", error.message, error.code);
  }
  if (error instanceof TeamSplitInvalidError) {
    throw new ApiError("validation_error", error.message);
  }
  const reason = businessRuleReason(error);
  if (reason !== null && error instanceof Error) {
    throw new ApiError("business_rule", error.message, reason);
  }
  return asAccountApiError(error);
}
