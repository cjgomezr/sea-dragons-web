import type { EventSpan } from "@/lib/events/event-duration";
import { addClubDays } from "@/lib/time/club-calendar";

/**
 * El cuándo del diálogo de evento (#650, RF-9 del PRD de E24): cuánto dura
 * lo escrito, si el fin vale y qué ponen las duraciones rápidas.
 *
 * Se juzga con las mismas reglas que el servidor (`resolveEventEnd`) para
 * desactivar Crear antes de mandar algo que va a volver con un 422. Sólo un
 * evento suelto puede terminar otro día (D6): en una serie, "Termina otro
 * día" no existe y un fin que cruza la medianoche queda antes del inicio.
 * Las fechas y las horas se comparan como texto: `YYYY-MM-DD` y `HH:MM`
 * ordenan igual que lo que nombran.
 */

/** Lo que el diálogo sabe de cuándo es un evento, tal como se escribe. */
export type EventWhen = {
  readonly startsOn: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly endsAnotherDay: boolean;
  readonly endDate: string;
};

/** Un evento suelto o las sesiones de una serie. */
export type EndScope = "event" | "series";

export type EventEndCheck =
  | { readonly kind: "incomplete" }
  | { readonly kind: "invalid" }
  | { readonly kind: "valid"; readonly span: EventSpan };

export type QuickLength = {
  readonly minutes: number;
  /** Como lo dice la ficha: "1 h", "1 h 30". */
  readonly label: string;
};

export const QUICK_LENGTHS: readonly QuickLength[] = [
  { minutes: 60, label: "1 h" },
  { minutes: 90, label: "1 h 30" },
  { minutes: 120, label: "2 h" },
  { minutes: 180, label: "3 h" },
];

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

function toMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}

function toTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Termina pasa a inicio más la duración, en hora de reloj. Null sin hora
 * de inicio. */
export function applyQuickLength(
  when: EventWhen,
  minutes: number,
  scope: EndScope,
): Pick<EventWhen, "endTime" | "endsAnotherDay" | "endDate"> | null {
  if (when.startTime === "") {
    return null;
  }
  const endMinutes = toMinutes(when.startTime) + minutes;
  const endTime = toTime(endMinutes % MINUTES_PER_DAY);
  if (endMinutes < MINUTES_PER_DAY || scope === "series") {
    return { endTime, endsAnotherDay: false, endDate: "" };
  }
  return {
    endTime,
    endsAnotherDay: true,
    endDate: when.startsOn === "" ? "" : addClubDays(when.startsOn, 1),
  };
}

function isMultiDay(when: EventWhen, scope: EndScope): boolean {
  return (
    scope === "event" && when.endsAnotherDay && when.endDate !== when.startsOn
  );
}

function evaluateMultiDayEnd(when: EventWhen): EventEndCheck {
  if (when.endDate === "" || when.startsOn === "") {
    return { kind: "incomplete" };
  }
  if (when.endDate < when.startsOn) {
    return { kind: "invalid" };
  }
  return {
    kind: "valid",
    span: {
      startsOn: when.startsOn,
      startTime: when.startTime,
      endsOn: when.endDate,
      endTime: when.endTime,
    },
  };
}

/** Si el fin escrito vale. Las horas al revés no valen aunque falte la
 * fecha; la duración sí necesita la fecha, porque cuenta el horario de
 * verano. */
export function evaluateEventEnd(
  when: EventWhen,
  scope: EndScope,
): EventEndCheck {
  if (when.startTime === "" || when.endTime === "") {
    return { kind: "incomplete" };
  }
  if (isMultiDay(when, scope)) {
    return evaluateMultiDayEnd(when);
  }
  if (when.endTime <= when.startTime) {
    return { kind: "invalid" };
  }
  if (when.startsOn === "") {
    return { kind: "incomplete" };
  }
  return {
    kind: "valid",
    span: {
      startsOn: when.startsOn,
      startTime: when.startTime,
      endsOn: null,
      endTime: when.endTime,
    },
  };
}
