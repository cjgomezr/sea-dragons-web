import { useRef, useState } from "react";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import type { MyTeam } from "@/lib/teams/my-team";
import { openEventTeam } from "./event-team-client";

/**
 * Los equipos de un evento en su fila de la agenda (#403). Como el detalle
 * (#312), se piden la primera vez que la fila se despliega y se guardan:
 * plegar y volver a desplegar no pide otra vez.
 */

export type EventTeamState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: ApiRequestFailure }
  | { readonly kind: "loaded"; readonly team: MyTeam };

export function useEventTeam(eventId: string): {
  readonly team: EventTeamState;
  /** Pide los equipos si todavía no se pidieron. */
  readonly open: () => void;
  readonly retry: () => void;
} {
  const [team, setTeam] = useState<EventTeamState>({ kind: "idle" });
  // El estado tarda un render: la ref corta ya el segundo despliegue
  // mientras el primero sigue pidiendo.
  const isLoadingRef = useRef(false);

  async function load(): Promise<void> {
    if (isLoadingRef.current) {
      return;
    }
    isLoadingRef.current = true;
    setTeam({ kind: "loading" });
    const outcome = await openEventTeam(eventId);
    isLoadingRef.current = false;
    setTeam(
      outcome.kind === "opened"
        ? { kind: "loaded", team: outcome.team }
        : { kind: "failed", failure: outcome },
    );
  }

  return {
    team,
    open: () => {
      if (team.kind === "idle") {
        void load();
      }
    },
    retry: () => void load(),
  };
}
