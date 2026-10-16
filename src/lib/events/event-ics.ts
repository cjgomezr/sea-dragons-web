import { CLUB_TIME_ZONE } from "@/lib/time/club-calendar";

/**
 * El `.ics` de "Agregar a mi calendario" (#649, RF-8 y D9 del PRD de E24),
 * escrito a mano según RFC 5545. Es de una sola sesión, sin `RRULE`: una
 * serie entera no se enteraría de las sesiones canceladas después. Sin hora
 * de fin lleva sólo el inicio.
 */

export type IcsEvent = {
  readonly id: string;
  readonly title: string;
  readonly startsOn: string;
  /** `HH:MM` de Melbourne. */
  readonly startTime: string;
  /** Nulo si termina el mismo día. */
  readonly endsOn: string | null;
  /** Nula en lo anterior a E24: sólo se sabe el inicio. */
  readonly endTime: string | null;
  /** El nombre y la dirección del lugar, o el texto libre. */
  readonly location: string;
  readonly notes: string | null;
};

const CRLF = "\r\n";
/** RFC 5545 §3.1: ninguna línea pasa de 75 octetos sin contar el salto. */
const MAX_LINE_OCTETS = 75;
const FOLD_PREFIX = " ";
const PRODUCT_ID = "-//Victoria Seadragons//Club Platform//EN";
const UID_DOMAIN = "victoriaseadragons.club";

/** Melbourne: AEST (+10) todo el año, y AEDT (+11) del primer domingo de
 * octubre al primer domingo de abril. */
const MELBOURNE_TIME_ZONE_LINES = [
  "BEGIN:VTIMEZONE",
  `TZID:${CLUB_TIME_ZONE}`,
  "BEGIN:STANDARD",
  "DTSTART:19700405T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU",
  "TZOFFSETFROM:+1100",
  "TZOFFSETTO:+1000",
  "TZNAME:AEST",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:19701004T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU",
  "TZOFFSETFROM:+1000",
  "TZOFFSETTO:+1100",
  "TZNAME:AEDT",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
] as const;

/** RFC 5545 §3.3.11: la barra primero, para no doblar las que se añaden. */
function escapeText(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** "2026-10-14" y "18:00" son `20261014T180000`, la hora local con zona. */
function localDateTime(isoDate: string, clockTime: string): string {
  return `${isoDate.replaceAll("-", "")}T${clockTime.replace(":", "")}00`;
}

/** `20261017T030405Z`: el instante en UTC, sin milisegundos. */
function utcStamp(instant: Date): string {
  return instant
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

function zonedProperty(
  name: string,
  isoDate: string,
  clockTime: string,
): string {
  return `${name};TZID=${CLUB_TIME_ZONE}:${localDateTime(isoDate, clockTime)}`;
}

/** RFC 5545 §3.1: se parte por letras enteras, nunca a mitad de una tilde, y
 * cada trozo de después empieza con un espacio. */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const pieces: string[] = [];
  let piece = "";
  let pieceOctets = 0;
  for (const character of line) {
    const octets = encoder.encode(character).length;
    if (pieceOctets + octets > MAX_LINE_OCTETS) {
      pieces.push(piece);
      piece = FOLD_PREFIX;
      pieceOctets = FOLD_PREFIX.length;
    }
    piece += character;
    pieceOctets += octets;
  }
  pieces.push(piece);
  return pieces.join(CRLF);
}

function eventLines(event: IcsEvent, generatedAt: Date): string[] {
  const { startsOn, startTime, endsOn, endTime, notes } = event;
  return [
    "BEGIN:VEVENT",
    `UID:${event.id}@${UID_DOMAIN}`,
    `DTSTAMP:${utcStamp(generatedAt)}`,
    zonedProperty("DTSTART", startsOn, startTime),
    ...(endTime === null
      ? []
      : [zonedProperty("DTEND", endsOn ?? startsOn, endTime)]),
    `SUMMARY:${escapeText(event.title)}`,
    `LOCATION:${escapeText(event.location)}`,
    ...(notes === null || notes.trim() === ""
      ? []
      : [`DESCRIPTION:${escapeText(notes)}`]),
    "END:VEVENT",
  ];
}

export function buildEventIcs(event: IcsEvent, generatedAt: Date): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODUCT_ID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...MELBOURNE_TIME_ZONE_LINES,
    ...eventLines(event, generatedAt),
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}
