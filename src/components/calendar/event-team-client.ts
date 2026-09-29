import { z } from "zod";
import {
  type ApiRequestFailure,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { EVENT_TEAM_API_PATH } from "@/lib/auth/routes";
import type { MyTeam } from "@/lib/teams/my-team";
import { TEAM_IDS } from "@/lib/teams/team-ids";

/**
 * Lo que la fila desplegada de la agenda le pide al equipo de un evento
 * (#403) a `GET /api/v1/events/[id]/team` (#401). Quién juega dónde, y que
 * nunca llegue un OVR (D3), lo decide el servidor.
 */

const positionSchema = z.object({
  id: z.uuid(),
  names: z.object({ en: z.string().nullable(), es: z.string().nullable() }),
});

const publishedTeamSchema = z.object({
  name: z.string(),
  // Como lo valida el servidor al guardar: `nameTeamColor` no sabe de otro.
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  players: z.array(
    z.object({
      userId: z.uuid(),
      fullName: z.string(),
      position: positionSchema.nullable(),
    }),
  ),
});

const myTeamSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_published") }),
  z.object({
    status: z.literal("published"),
    publishedAt: z.iso.datetime(),
    me: z
      .object({ team: z.enum(TEAM_IDS), position: positionSchema.nullable() })
      .nullable(),
    teams: z.object({ a: publishedTeamSchema, b: publishedTeamSchema }),
  }),
]);

const myTeamResponseSchema = z.object({ data: myTeamSchema });

export type EventTeamOpening =
  { readonly kind: "opened"; readonly team: MyTeam } | ApiRequestFailure;

/** Nunca rechaza: un fallo de red sale como fallo. */
export async function openEventTeam(
  eventId: string,
): Promise<EventTeamOpening> {
  const read = readApiPayload(
    await requestApi(
      EVENT_TEAM_API_PATH.replace("[id]", encodeURIComponent(eventId)),
    ),
    myTeamResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "opened", team: read.value.data };
}
