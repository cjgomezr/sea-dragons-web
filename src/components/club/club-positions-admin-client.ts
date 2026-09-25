import { z } from "zod";
import {
  type ApiRequestFailure,
  type ApiRequestOutcome,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import {
  CLUB_SETTINGS_POSITIONS_API_PATH,
  CLUB_SETTINGS_POSITIONS_ORDER_API_PATH,
} from "@/lib/auth/routes";
import type { ClubPositions } from "@/lib/club/club-positions";
import {
  POSITION_ISSUE_CODES,
  POSITION_NAME_MAX_LENGTH,
  POSITIONS_CHANGED_REASON,
  type PositionIssueCode,
  type PositionNamesInput,
} from "@/lib/club/manage-club-positions";
import type { Translator } from "@/lib/i18n/translator";
import { namedPositionSchema } from "./positions-client";

/**
 * Lo que la sección de posiciones de la configuración del club (#300) le pide
 * a la API v1 y cómo reduce cada respuesta a algo que pintar. Todas las
 * respuestas traen el catálogo entero tal como quedó, así que la pantalla
 * siempre enseña lo que guardó el servidor.
 */

const responseSchema = z.object({
  data: z.object({
    positions: z.array(namedPositionSchema.extend({ isArchived: z.boolean() })),
  }),
});

export type ManagedPositionsRead =
  | { readonly kind: "loaded"; readonly positions: ClubPositions }
  | ApiRequestFailure;

async function readPositionsResponse(
  request: Promise<ApiRequestOutcome>,
): Promise<ManagedPositionsRead> {
  const read = readApiPayload(await request, responseSchema);
  return read.kind === "failed"
    ? read
    : { kind: "loaded", positions: read.value.data.positions };
}

function sendJson(
  path: string,
  method: "POST" | "PUT" | "PATCH",
  body: unknown,
): Promise<ManagedPositionsRead> {
  return readPositionsResponse(
    requestApi(path, {
      method,
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify(body),
    }),
  );
}

function positionPath(positionId: string): string {
  return `${CLUB_SETTINGS_POSITIONS_API_PATH}/${encodeURIComponent(positionId)}`;
}

export function loadManagedPositions(): Promise<ManagedPositionsRead> {
  return readPositionsResponse(requestApi(CLUB_SETTINGS_POSITIONS_API_PATH));
}

export function createManagedPosition(
  names: PositionNamesInput,
): Promise<ManagedPositionsRead> {
  return sendJson(CLUB_SETTINGS_POSITIONS_API_PATH, "POST", { names });
}

export function renameManagedPosition(
  positionId: string,
  names: PositionNamesInput,
): Promise<ManagedPositionsRead> {
  return sendJson(positionPath(positionId), "PATCH", { names });
}

export function setManagedPositionArchived(
  positionId: string,
  isArchived: boolean,
): Promise<ManagedPositionsRead> {
  return sendJson(positionPath(positionId), "PATCH", { isArchived });
}

export function reorderManagedPositions(
  positionIds: readonly string[],
): Promise<ManagedPositionsRead> {
  return sendJson(CLUB_SETTINGS_POSITIONS_ORDER_API_PATH, "PUT", {
    positionIds,
  });
}

/** El campo del que habla un 400, si el `reason` es uno de esta sección. */
export function readPositionIssueCode(
  failure: ApiRequestFailure,
): PositionIssueCode | null {
  if (failure.failure !== "validation_error") {
    return null;
  }
  return POSITION_ISSUE_CODES.find((code) => code === failure.reason) ?? null;
}

export function isPositionsConflict(failure: ApiRequestFailure): boolean {
  return failure.reason === POSITIONS_CHANGED_REASON;
}

export function describePositionIssue(
  translate: Translator,
  code: PositionIssueCode,
): string {
  switch (code) {
    case "name_required":
      return translate("clubSettings.positions.issue.nameRequired");
    case "name_en_too_long":
    case "name_es_too_long":
      return translate("clubSettings.positions.issue.nameTooLong", {
        max: POSITION_NAME_MAX_LENGTH,
      });
    case "name_en_taken":
    case "name_es_taken":
      return translate("clubSettings.positions.issue.nameTaken");
  }
}

/** Por qué no se pudo leer o guardar, en el idioma de la pantalla. */
export function describePositionsFailure(
  translate: Translator,
  failure: ApiRequestFailure,
): string {
  if (isPositionsConflict(failure)) {
    return translate("clubSettings.positions.error.changed");
  }
  switch (failure.failure) {
    case "network":
      return translate("auth.error.network");
    case "unauthenticated":
      return translate("clubSettings.error.signInRequired");
    case "forbidden":
      return translate("clubSettings.error.forbidden");
    default:
      return translate("clubSettings.error.unexpected");
  }
}
