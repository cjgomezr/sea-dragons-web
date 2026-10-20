import { z } from "zod";
import { TEAM_BIB_COLORS } from "./team-color-name";
import { CLUB_TEAM_NAME_MAX_LENGTH, type EventSplitLabels } from "./team-ids";
import {
  type TeamBuilderGateways,
  type TeamLabels,
  findTeamBuilderActor,
} from "./team-builder";

/**
 * Los equipos del club (#755, RF-1 y D1 a D3 del PRD de E28), contados sin
 * Supabase delante. El nombre y el color de los dos equipos dejan de ser una
 * constante: son del club, y los leen y los cambian Admin y Coach, los mismos
 * que arman equipos (`buildTeamsAndTrackAttendance`). La frontera ya lo
 * decide por el camino; aquí se vuelve a comprobar.
 *
 * Un reparto publicado conserva los suyos (D4): los socios ya recibieron el
 * aviso con ellos. Uno guardado y sin publicar los estrena en cuanto se
 * cambian desde su builder (`eventId`). El guardado del reparto sigue
 * aceptando cualquier `#RRGGBB` (D5); sólo esto exige el muestrario.
 */

const BIB_HEXES = TEAM_BIB_COLORS.map((color) => color.hex);

const clubTeamLabelSchema = z.object({
  name: z.string().trim().min(1).max(CLUB_TEAM_NAME_MAX_LENGTH),
  color: z
    .string()
    .transform((color) => color.toUpperCase())
    .refine((color) => BIB_HEXES.includes(color), {
      message: "El color no es del muestrario de petos.",
    }),
});

const teamPairSchema = z.object({
  a: clubTeamLabelSchema,
  b: clubTeamLabelSchema,
});

/** Dos colores iguales señalan los dos campos: cualquiera de los dos es el
 * que hay que cambiar. */
function requireDistinctColors(
  teams: z.infer<typeof teamPairSchema>,
  context: z.RefinementCtx,
): void {
  if (teams.a.color !== teams.b.color) {
    return;
  }
  for (const team of ["a", "b"] as const) {
    context.addIssue({
      code: "custom",
      path: [team, "color"],
      message: "Los dos equipos no pueden llevar el mismo color.",
    });
  }
}

/** `{ a: { name, color }, b: { name, color } }`. */
export const clubTeamLabelsSchema = teamPairSchema.superRefine(
  requireDistinctColors,
);

/** Lo que recibe el cambio: los dos equipos y, si se cambian desde el
 * builder de un evento, ese evento, para llevarlos a su reparto. */
export const clubTeamLabelsChangeSchema = teamPairSchema
  .extend({ eventId: z.uuid().optional() })
  .superRefine(requireDistinctColors);

type ClubTeamLabelsGateways = Pick<
  TeamBuilderGateways,
  "members" | "clubTeams"
> & {
  readonly teams: Pick<
    TeamBuilderGateways["teams"],
    "findEvent" | "findSplit" | "relabelDraftSplit"
  >;
};

export type ClubTeamLabelsChange = {
  readonly teams: TeamLabels;
  readonly eventSplit: EventSplitLabels;
};

export async function readClubTeamLabels(
  gateways: ClubTeamLabelsGateways,
  callerId: string,
): Promise<TeamLabels> {
  const actor = await findTeamBuilderActor(gateways, callerId);
  return gateways.clubTeams.findClubTeamLabels(actor.clubId);
}

/** Los guarda en el club de quien llama, nunca en uno de la petición
 * (NFR-009). Con `eventId` también los lleva al reparto de ese evento si
 * está guardado y sin publicar, y sólo si el evento es de ese club; el
 * publicado conserva los suyos (D4). Los demás repartos no cambian. */
export async function changeClubTeamLabels(
  gateways: ClubTeamLabelsGateways,
  request: {
    readonly callerId: string;
    readonly teams: TeamLabels;
    readonly eventId?: string;
  },
): Promise<ClubTeamLabelsChange> {
  const actor = await findTeamBuilderActor(gateways, request.callerId);
  const saved = await gateways.clubTeams.saveClubTeamLabels({
    clubId: actor.clubId,
    teams: request.teams,
  });
  // Las dos escrituras no van en una transacción: el cambio es idempotente
  // y, si la del reparto falla, la petición responde error y repetirla deja
  // el club y el reparto iguales.
  const eventSplit =
    request.eventId === undefined
      ? "none"
      : await relabelEventSplit(gateways, {
          clubId: actor.clubId,
          eventId: request.eventId,
          teams: saved,
        });
  return { teams: saved, eventSplit };
}

/** El evento se busca en el club antes de mirar su reparto: el de otro club
 * ni se toca ni se describe. */
async function relabelEventSplit(
  gateways: ClubTeamLabelsGateways,
  change: {
    readonly clubId: string;
    readonly eventId: string;
    readonly teams: TeamLabels;
  },
): Promise<EventSplitLabels> {
  const event = await gateways.teams.findEvent({
    clubId: change.clubId,
    eventId: change.eventId,
  });
  if (event === null) {
    return "none";
  }
  if (await gateways.teams.relabelDraftSplit(change)) {
    return "relabelled";
  }
  const split = await gateways.teams.findSplit(change.eventId);
  return split !== null && split.publishedAt !== null ? "published" : "none";
}
