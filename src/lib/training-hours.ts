/** Zona del club, nunca un desfase fijo. Melbourne alterna AEST (UTC+10) y
 * AEDT (UTC+11), así que restar diez horas a un instante de verano da una hora
 * local equivocada y mueve el entrenamiento de las 18:00 a las 17:00. */
export const CLUB_TIME_ZONE = "Australia/Melbourne";

export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

const WEEKDAYS: readonly Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/** Un entrenamiento semanal, en hora local del club. `endHour` es exclusiva:
 * a las 22:00 el entrenamiento ya terminó. */
export type TrainingSession = {
  readonly weekday: Weekday;
  readonly startHour: number;
  readonly endHour: number;
};

/** Las horas de entrenamiento del club (NFR-003). Viven aquí, y no en la
 * memoria de quien planifica un mantenimiento, porque la ventana de
 * mantenimiento tiene que caer fuera de ellas. */
export const TRAINING_SESSIONS: readonly TrainingSession[] = [
  { weekday: "tuesday", startHour: 18, endHour: 22 },
  { weekday: "thursday", startHour: 18, endHour: 22 },
  { weekday: "saturday", startHour: 8, endHour: 13 },
];

const MINUTES_PER_HOUR = 60;

const CLUB_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: CLUB_TIME_ZONE,
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

type ClubLocalTime = {
  readonly weekday: Weekday;
  readonly minuteOfDay: number;
};

/** Se valida contra los siete días, no contra los tres de entrenamiento. Si
 * solo se reconocieran esos tres, un nombre que Intl devolviera en otra forma
 * ("Tue") se confundiría con un lunes legítimo: los dos darían "no hay
 * entrenamiento", que es la respuesta que programa un mantenimiento en mitad
 * de una sesión. Quedarse con los días de entrenamiento es trabajo de
 * `covers`, no de esta función. */
function toWeekday(weekday: string): Weekday {
  const known = WEEKDAYS.find((candidate) => candidate === weekday);
  if (!known) {
    throw new Error(
      `Intl devolvió un día desconocido ("${weekday}") para la zona ${CLUB_TIME_ZONE}`,
    );
  }
  return known;
}

function readPart(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const part = parts.find((candidate) => candidate.type === type);
  if (!part) {
    throw new Error(
      `Intl no devolvió la parte "${type}" para la zona ${CLUB_TIME_ZONE}`,
    );
  }
  return part.value;
}

function readClubMinuteOfDay(
  parts: readonly Intl.DateTimeFormatPart[],
): number {
  const hour = Number(readPart(parts, "hour"));
  const minute = Number(readPart(parts, "minute"));
  // Un NaN aquí haría que toda comparación diera falso, y "falso" significa
  // "no hay entrenamiento": el fallo se abriría hacia el lado que programa un
  // mantenimiento en mitad de una sesión. Mejor romper ruidosamente.
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(
      `Intl devolvió una hora no numérica para la zona ${CLUB_TIME_ZONE}`,
    );
  }
  return hour * MINUTES_PER_HOUR + minute;
}

function readClubLocalTime(instant: Date): ClubLocalTime {
  const parts = CLUB_TIME_FORMAT.formatToParts(instant);
  return {
    weekday: toWeekday(readPart(parts, "weekday").toLowerCase()),
    minuteOfDay: readClubMinuteOfDay(parts),
  };
}

function covers(session: TrainingSession, local: ClubLocalTime): boolean {
  return (
    session.weekday === local.weekday &&
    local.minuteOfDay >= session.startHour * MINUTES_PER_HOUR &&
    local.minuteOfDay < session.endHour * MINUTES_PER_HOUR
  );
}

/** Si ese instante cae dentro de un entrenamiento, en hora local del club. El
 * inicio entra y el final no: el martes a las 18:00 sí, a las 22:00 no. */
export function isDuringTrainingHours(instant: Date): boolean {
  const local = readClubLocalTime(instant);
  return TRAINING_SESSIONS.some((session) => covers(session, local));
}
