import { z } from "zod";
import { TEAM_BIB_COLORS } from "./team-color-name";
import { CLUB_TEAM_NAME_MAX_LENGTH } from "./team-ids";
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
 * Un reparto guardado conserva los suyos (D4), y su guardado sigue aceptando
 * cualquier `#RRGGBB` (D5). Sólo esto exige el muestrario.
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

/** `{ a: { name, color }, b: { name, color } }`. Dos colores iguales señalan
 * los dos campos: cualquiera de los dos es el que hay que cambiar. */
export const clubTeamLabelsSchema = z
  .object({ a: clubTeamLabelSchema, b: clubTeamLabelSchema })
  .superRefine((teams, context) => {
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
  });

type ClubTeamLabelsGateways = Pick<
  TeamBuilderGateways,
  "members" | "clubTeams"
>;

export async function readClubTeamLabels(
  gateways: ClubTeamLabelsGateways,
  callerId: string,
): Promise<TeamLabels> {
  const actor = await findTeamBuilderActor(gateways, callerId);
  return gateways.clubTeams.findClubTeamLabels(actor.clubId);
}

/** Los guarda en el club de quien llama, nunca en uno de la petición
 * (NFR-009). Los repartos ya guardados no cambian. */
export async function changeClubTeamLabels(
  gateways: ClubTeamLabelsGateways,
  request: { readonly callerId: string; readonly teams: TeamLabels },
): Promise<TeamLabels> {
  const actor = await findTeamBuilderActor(gateways, request.callerId);
  return gateways.clubTeams.saveClubTeamLabels({
    clubId: actor.clubId,
    teams: request.teams,
  });
}
