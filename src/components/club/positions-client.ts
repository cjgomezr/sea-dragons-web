import { z } from "zod";
import {
  type ApiRequestFailure,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { CLUB_POSITIONS_API_PATH } from "@/lib/auth/routes";
import type { NamedPosition } from "@/lib/club/club-positions";

/**
 * Las posiciones del club tal como llegan de la API (#299): el directorio las
 * trae dentro de cada socio, y el alta de un miembro las pide aparte.
 */

/** Un nombre por idioma, y al menos uno: sin ninguno no hay qué pintar. */
export const namedPositionSchema = z.object({
  id: z.uuid(),
  names: z
    .object({ en: z.string().nullable(), es: z.string().nullable() })
    .refine((names) => names.en !== null || names.es !== null),
});

const responseSchema = z.object({
  data: z.object({ positions: z.array(namedPositionSchema) }),
});

export type PositionChoicesLoad =
  | {
      readonly kind: "loaded";
      readonly positions: readonly NamedPosition[];
    }
  | ApiRequestFailure;

/** Nunca rechaza: un fallo de red o un cuerpo que no cuadra salen como
 * fallo, igual que en `loadGroups`. */
export async function loadPositionChoices(): Promise<PositionChoicesLoad> {
  const read = readApiPayload(
    await requestApi(CLUB_POSITIONS_API_PATH),
    responseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", positions: read.value.data.positions };
}
