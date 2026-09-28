import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import type { ClubAttendanceRate } from "@/lib/attendance/attendance-stats";
import {
  AttendanceForbiddenError,
  type ClubAttendanceRateGateways,
  readClubAttendanceRate,
} from "@/lib/attendance/club-attendance-rate";
import { createSupabaseClubAttendanceRateGateways } from "@/lib/attendance/supabase-attendance-stats";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { clubCalendarDate } from "@/lib/time/club-calendar";

/**
 * La tasa de asistencia del club en los últimos 30 días (#394, RF-7 del PRD
 * de E8), para la tesela del dashboard de E14 (FR-076).
 *
 * `RESTRICTED_ROUTES` ya reserva el camino a Admin y Coach, y el dominio lo
 * vuelve a comprobar. Sin ninguna hoja en el periodo responde `no_data`, no 0.
 */

// Depende de la sesión de quien llama y de las hojas guardadas ahora.
export const dynamic = "force-dynamic";

export type ClubAttendanceRateResponse = ClubAttendanceRate;

function requireClubAttendanceRateGateways(): ClubAttendanceRateGateways {
  const wiring = createSupabaseClubAttendanceRateGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

const getClubAttendanceRate = createApiRoute<ClubAttendanceRateResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await readClubAttendanceRate(
          requireClubAttendanceRateGateways(),
          {
            callerId,
            // Los 30 días se cuentan en el calendario del club (NFR-003).
            todayInClub: clubCalendarDate(new Date()),
          },
        ),
      };
    } catch (error) {
      if (error instanceof AttendanceForbiddenError) {
        throw new ApiError("forbidden", error.message);
      }
      return asAccountApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getClubAttendanceRate,
});
