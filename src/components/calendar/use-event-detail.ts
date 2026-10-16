import { useRef, useState } from "react";
import {
  type AgendaFailure,
  type OpenedEvent,
  openEvent,
} from "./agenda-client";

/**
 * El detalle de un evento de la agenda (#312, RF-8), que enseña su panel
 * (#648). Se pide la primera vez que se elige su fila, no con la agenda:
 * traer el de los 50 eventos de golpe sería pedir 50 veces lo que casi nadie
 * abre. Una vez traído se guarda, y volver a elegir la fila no pide otra vez.
 */

export type EventDetailState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: AgendaFailure }
  | { readonly kind: "loaded"; readonly opened: OpenedEvent };

export function useEventDetail(eventId: string): {
  readonly detail: EventDetailState;
  /** Pide el detalle si todavía no se pidió. */
  readonly open: () => void;
  readonly retry: () => void;
  /** Un detalle más nuevo que llegó por otro camino, como tras responder. */
  readonly receive: (opened: OpenedEvent) => void;
} {
  const [detail, setDetail] = useState<EventDetailState>({ kind: "idle" });
  // Como en el RSVP: el estado tarda un render, la ref corta ya la segunda
  // petición mientras la primera sigue en curso.
  const isLoadingRef = useRef(false);
  // Sube con cada detalle que llega por otro camino: una petición que sale
  // antes y vuelve después trae nombres más viejos y no se pinta.
  const versionRef = useRef(0);

  async function load(): Promise<void> {
    if (isLoadingRef.current) {
      return;
    }
    isLoadingRef.current = true;
    setDetail({ kind: "loading" });
    const version = versionRef.current;
    const outcome = await openEvent(eventId);
    isLoadingRef.current = false;
    if (version !== versionRef.current) {
      return;
    }
    setDetail(
      outcome.kind === "opened"
        ? { kind: "loaded", opened: outcome.opened }
        : { kind: "failed", failure: outcome },
    );
  }

  return {
    detail,
    open: () => {
      if (detail.kind === "idle") {
        void load();
      }
    },
    retry: () => void load(),
    receive: (opened) => {
      versionRef.current += 1;
      setDetail({ kind: "loaded", opened });
    },
  };
}
