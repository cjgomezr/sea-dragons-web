import { z } from "zod";
import {
  type ApiRequestFailure,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import {
  ATTENDANCE_STATUSES,
  type AttendanceTotals,
} from "@/lib/attendance/attendance-status";
import {
  ATTENDANCE_SESSIONS_API_PATH,
  ATTENDANCE_SHEET_API_PATH,
} from "@/lib/auth/routes";
import { RSVP_RESPONSES } from "@/lib/events/event-rsvp";
import type { Translator } from "@/lib/i18n/translator";
import type { AttendanceMark } from "./attendance-marks";

/**
 * Lo que la pantalla de Asistencia (#395) le pide a la API v1 (#393) y cómo
 * reduce cada respuesta a algo que pintar.
 *
 * Nada habla con la base: la aplicación nativa de Release 2 va a usar estos
 * mismos caminos (CON-002). De un error se guarda el código y no la frase,
 * para que el aviso cambie de idioma con el interruptor (E17).
 */

const totalsSchema = z.object({
  present: z.number().int().nonnegative(),
  late: z.number().int().nonnegative(),
  absent: z.number().int().nonnegative(),
});

const sessionSchema = z.object({
  eventId: z.uuid(),
  title: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
});

const sessionsResponseSchema = z.object({
  data: z.object({ sessions: z.array(sessionSchema) }),
});

const positionSchema = z.object({
  id: z.string(),
  names: z.object({ en: z.string().nullable(), es: z.string().nullable() }),
});

const sheetMemberSchema = z.object({
  userId: z.uuid(),
  fullName: z.string(),
  photoUrl: z.string().nullable(),
  position: positionSchema.nullable(),
  status: z.enum(ATTENDANCE_STATUSES),
  rsvpResponse: z.enum(RSVP_RESPONSES).nullable(),
  isInactive: z.boolean(),
});

const sheetResponseSchema = z.object({
  data: z.object({
    eventId: z.uuid(),
    title: z.string(),
    startsAt: z.iso.datetime({ offset: true }),
    isSaved: z.boolean(),
    members: z.array(sheetMemberSchema),
  }),
});

const savedResponseSchema = z.object({
  data: z.object({ eventId: z.uuid(), totals: totalsSchema }),
});

/** Una ficha: lo que hace falta para nombrar la sesión. */
export type SessionChoice = z.infer<typeof sessionSchema>;

export type SheetMember = z.infer<typeof sheetMemberSchema>;

export type OpenedSheet = z.infer<typeof sheetResponseSchema>["data"];

export type AttendanceFailure = ApiRequestFailure;

export type SessionsLoad =
  | {
      readonly kind: "loaded";
      readonly sessions: readonly SessionChoice[];
    }
  | AttendanceFailure;

export type SheetLoad =
  { readonly kind: "loaded"; readonly sheet: OpenedSheet } | AttendanceFailure;

export type SheetSave =
  | { readonly kind: "saved"; readonly totals: AttendanceTotals }
  | AttendanceFailure;

function sheetPath(eventId: string): string {
  return ATTENDANCE_SHEET_API_PATH.replace(
    "[eventId]",
    encodeURIComponent(eventId),
  );
}

/** Los entrenamientos de los últimos 30 días, del más reciente al más
 * antiguo. Nunca rechaza: un fallo de red sale como fallo. */
export async function loadSessions(): Promise<SessionsLoad> {
  const read = readApiPayload(
    await requestApi(ATTENDANCE_SESSIONS_API_PATH),
    sessionsResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", sessions: read.value.data.sessions };
}

export async function openSheet(eventId: string): Promise<SheetLoad> {
  const read = readApiPayload(
    await requestApi(sheetPath(eventId)),
    sheetResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", sheet: read.value.data };
}

/** Manda la hoja entera: la nueva sustituye a la anterior (RF-3). */
export async function saveSheet(
  eventId: string,
  records: readonly AttendanceMark[],
): Promise<SheetSave> {
  const read = readApiPayload(
    await requestApi(sheetPath(eventId), {
      method: "PUT",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify({ records }),
    }),
    savedResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "saved", totals: read.value.data.totals };
}

/** Los `reason` del 422 de la hoja (#393, D4). */
const CLOSED_REASONS = {
  attendance_session_not_started: "attendance.error.notStarted",
  attendance_session_cancelled: "attendance.error.cancelled",
  attendance_member_outside_sheet: "attendance.error.outsideSheet",
} as const;

function isClosedReason(
  reason: string | null,
): reason is keyof typeof CLOSED_REASONS {
  return reason !== null && Object.hasOwn(CLOSED_REASONS, reason);
}

/** Por qué no se abrió o no se guardó una hoja, en el idioma de la
 * pantalla. */
export function describeAttendanceFailure(
  translate: Translator,
  { failure, reason }: AttendanceFailure,
): string {
  if (failure === "business_rule" && isClosedReason(reason)) {
    return translate(CLOSED_REASONS[reason]);
  }
  switch (failure) {
    case "network":
      return translate("auth.error.network");
    case "not_found":
      return translate("attendance.error.notFound");
    case "unauthenticated":
      return translate("attendance.error.signInRequired");
    case "forbidden":
      return translate("attendance.error.forbidden");
    default:
      return translate("attendance.error.unexpected");
  }
}
