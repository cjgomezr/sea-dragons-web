import { clubCalendarDate } from "@/lib/time/club-calendar";
import {
  type TeamBuilderEventSummary,
  type TeamBuilderGateways,
  findTeamBuilderActor,
} from "./team-builder";

/**
 * Los eventos que se pueden armar (#402, RF-9 del PRD de E10): los que la
 * pantalla de Equipos ofrece para elegir. Entrenamientos y competiciones no
 * cancelados, de hoy en adelante según el día de Melbourne (D2), de todo el
 * club: quien arma no tiene por qué estar en la audiencia (RF-3). Por eso no
 * sirve la agenda, que a un Coach sólo le da los de sus grupos.
 */

/** Unos dos meses de sesiones de un club con tres a la semana: lo que un
 * coach arma con antelación, y una respuesta que no crece sin fin. */
export const BUILDABLE_EVENTS_LIMIT = 25;

export type BuildableEvents = {
  readonly events: readonly TeamBuilderEventSummary[];
};

export async function listBuildableEvents(
  gateways: Pick<TeamBuilderGateways, "members" | "teams">,
  request: { readonly callerId: string; readonly now: Date },
): Promise<BuildableEvents> {
  const actor = await findTeamBuilderActor(gateways, request.callerId);
  return {
    events: await gateways.teams.findBuildableEvents({
      clubId: actor.clubId,
      today: clubCalendarDate(request.now),
      limit: BUILDABLE_EVENTS_LIMIT,
    }),
  };
}
