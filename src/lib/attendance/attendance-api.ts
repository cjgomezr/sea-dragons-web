import { z } from "zod";
import { ApiError } from "@/lib/api/response";
import { asAccountApiError } from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { EventNotFoundError } from "@/lib/events/event-rsvp";
import type { AttendanceSessionsGateways } from "./attendance-sessions";
import {
  ATTENDANCE_MEMBER_OUTSIDE_SHEET_REASON,
  ATTENDANCE_STATUSES,
  AttendanceClosedError,
  AttendanceForbiddenError,
  type AttendanceGateways,
  AttendanceListInvalidError,
  AttendanceMemberOutsideSheetError,
} from "./attendance-sheet";
import {
  type AttendanceWiring,
  createSupabaseAttendanceGateways,
  createSupabaseAttendanceSessionsGateways,
} from "./supabase-attendance-gateways";

/**
 * Lo que comparten los endpoints de asistencia (#393): cómo se cablean, la
 * forma de la hoja que llega y cómo responde cada error del dominio.
 *
 * Una hoja sin la forma debida (vacía, con un estado fuera del catálogo, un
 * miembro repetido o un id que no es uuid) es un 400. Una con la forma pero
 * que la sesión no admite, un 422 con el motivo en `reason`.
 */

/** `{ records: [{ userId, status }] }`: la hoja entera, cada miembro una vez. */
export const attendanceSheetSchema = z.object({
  records: z
    .array(z.object({ userId: z.uuid(), status: z.enum(ATTENDANCE_STATUSES) }))
    .min(1)
    .refine(
      (records) =>
        new Set(records.map((record) => record.userId)).size === records.length,
      { message: "Cada miembro va una sola vez en la hoja." },
    ),
});

function requireWired<Gateways>(wiring: AttendanceWiring<Gateways>): Gateways {
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

export function requireAttendanceGateways(): AttendanceGateways {
  return requireWired(createSupabaseAttendanceGateways(process.env));
}

export function requireAttendanceSessionsGateways(): AttendanceSessionsGateways {
  return requireWired(createSupabaseAttendanceSessionsGateways(process.env));
}

/** Un id que no es uuid no puede ser el de ningún evento: 404, sin preguntarle
 * a Postgres, que lo rechazaría con un error de tipo. */
export function readAttendanceEventId(value: string): string {
  if (!z.uuid().safeParse(value).success) {
    throw new ApiError("not_found", new EventNotFoundError().message);
  }
  return value;
}

export function asAttendanceApiError(error: unknown): never {
  if (error instanceof AttendanceForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  if (error instanceof EventNotFoundError) {
    throw new ApiError("not_found", error.message);
  }
  if (error instanceof AttendanceClosedError) {
    throw new ApiError("business_rule", error.message, error.code);
  }
  if (error instanceof AttendanceMemberOutsideSheetError) {
    throw new ApiError(
      "business_rule",
      error.message,
      ATTENDANCE_MEMBER_OUTSIDE_SHEET_REASON,
    );
  }
  if (error instanceof AttendanceListInvalidError) {
    throw new ApiError("validation_error", error.message);
  }
  return asAccountApiError(error);
}
