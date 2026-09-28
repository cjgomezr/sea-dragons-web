import type { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import {
  asAttendanceApiError,
  attendanceSheetSchema,
  readAttendanceEventId,
  requireAttendanceGateways,
} from "@/lib/attendance/attendance-api";
import {
  type AttendanceSheet,
  type SavedAttendanceSheet,
  openAttendanceSheet,
  saveAttendanceSheet,
} from "@/lib/attendance/attendance-sheet";
import { identifyAccountCaller } from "@/lib/auth/account-api";

/**
 * La hoja de asistencia de un entrenamiento (#393, RF-2 y RF-3 del PRD de
 * E8). GET la abre con toda la audiencia y el estado de cada uno; PUT la
 * guarda entera, todo o nada. PUT porque repetirlo deja lo mismo: la hoja
 * nueva sustituye a la anterior.
 *
 * `RESTRICTED_ROUTES` ya reserva este camino a Admin y Coach, y el dominio lo
 * vuelve a comprobar. Un evento que no es de entrenamiento, de otro club o que
 * no existe es un 404; uno cancelado o que todavía no empezó, según la hora
 * del servidor, un 422 con su `reason` (D4).
 */

// Depende de la sesión de quien llama, de la hora y de la hoja guardada.
export const dynamic = "force-dynamic";

type AttendanceSheetBody = z.infer<typeof attendanceSheetSchema>;

export type AttendanceSheetResponse = AttendanceSheet;

/** Lo que quedó guardado: los totales de la hoja (FR-041). */
export type SavedAttendanceSheetResponse = SavedAttendanceSheet;

type AttendanceSheetRouteContext = {
  readonly params: Promise<{ readonly eventId: string }>;
};

export function GET(
  request: NextRequest,
  context: AttendanceSheetRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<AttendanceSheetResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const eventId = readAttendanceEventId((await context.params).eventId);
      try {
        return {
          data: await openAttendanceSheet(requireAttendanceGateways(), {
            callerId,
            eventId,
            now: new Date(),
          }),
        };
      } catch (error) {
        asAttendanceApiError(error);
      }
    },
  });
  return route(request);
}

export function PUT(
  request: NextRequest,
  context: AttendanceSheetRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<
    SavedAttendanceSheetResponse,
    AttendanceSheetBody
  >({
    schema: attendanceSheetSchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const eventId = readAttendanceEventId((await context.params).eventId);
      try {
        return {
          data: await saveAttendanceSheet(requireAttendanceGateways(), {
            callerId,
            eventId,
            records: body.records,
            now: new Date(),
          }),
        };
      } catch (error) {
        asAttendanceApiError(error);
      }
    },
  });
  return route(request);
}

export const { POST, PATCH, DELETE } = createApiModule({});
