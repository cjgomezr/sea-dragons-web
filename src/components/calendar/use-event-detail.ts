import { useRef, useState } from "react";
import {
  type AgendaFailure,
  type OpenedEvent,
  openEvent,
} from "./agenda-client";

/**
 * Si una fila de la agenda está desplegada y qué enseña (#312, RF-8). El
 * detalle se pide la primera vez que se despliega, no con la agenda: traer el
 * de los 50 eventos de golpe sería pedir 50 veces lo que casi nadie abre. Una
 * vez traído se guarda, y plegar y volver a desplegar no pide otra vez.
 */

export type EventDetailState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: AgendaFailure }
  | { readonly kind: "loaded"; readonly opened: OpenedEvent };

export function useEventDetail(eventId: string): {
  readonly isExpanded: boolean;
  readonly detail: EventDetailState;
  readonly toggle: () => void;
  readonly retry: () => void;
  /** Un detalle más nuevo que llegó por otro camino, como tras responder. */
  readonly receive: (opened: OpenedEvent) => void;
} {
  const [isExpanded, setIsExpanded] = useState(false);
  const [detail, setDetail] = useState<EventDetailState>({ kind: "idle" });
  // Como en el RSVP: el estado tarda un render, la ref corta ya el segundo
  // despliegue mientras el primero sigue pidiendo.
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

  function toggle(): void {
    const willExpand = !isExpanded;
    setIsExpanded(willExpand);
    if (willExpand && detail.kind === "idle") {
      void load();
    }
  }

  return {
    isExpanded,
    detail,
    toggle,
    retry: () => void load(),
    receive: (opened) => {
      versionRef.current += 1;
      setDetail({ kind: "loaded", opened });
    },
  };
}
