import { useRef, useState } from "react";
import type { AgendaEvent } from "@/lib/events/event-agenda";
import type { RsvpResponse } from "@/lib/events/event-rsvp";
import { type AgendaFailure, type EventTally, saveRsvp } from "./agenda-client";

/**
 * La respuesta de quien mira a un evento de la agenda y sus conteos (#311).
 * La fila arranca con lo que sirvió la agenda y sólo cambia con lo que la API
 * guardó: un fallo deja la respuesta y los conteos de antes, y el aviso.
 */

export type EventRsvpState = {
  readonly tally: EventTally;
  /** La que se está guardando, o nula si no hay ninguna en curso. */
  readonly pendingResponse: RsvpResponse | null;
  readonly failure: AgendaFailure | null;
};

export function useEventRsvp(event: AgendaEvent): {
  readonly state: EventRsvpState;
  readonly respond: (response: RsvpResponse) => void;
} {
  const [state, setState] = useState<EventRsvpState>({
    tally: {
      goingCount: event.goingCount,
      maybeCount: event.maybeCount,
      myResponse: event.myResponse,
    },
    pendingResponse: null,
    failure: null,
  });
  // El estado tarda un render en verse; la ref corta ya el segundo toque.
  const isSavingRef = useRef(false);

  async function save(response: RsvpResponse): Promise<void> {
    const outcome = await saveRsvp(event.id, state.tally, response);
    isSavingRef.current = false;
    setState((current) =>
      outcome.kind === "saved"
        ? { tally: outcome.tally, pendingResponse: null, failure: null }
        : { ...current, pendingResponse: null, failure: outcome },
    );
  }

  function respond(response: RsvpResponse): void {
    if (isSavingRef.current) {
      return;
    }
    isSavingRef.current = true;
    setState((current) => ({
      ...current,
      pendingResponse: response,
      failure: null,
    }));
    void save(response);
  }

  return { state, respond };
}
