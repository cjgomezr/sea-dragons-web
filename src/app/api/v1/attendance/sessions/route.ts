import { createApiModule, createApiRoute } from "@/lib/api/handler";
import {
  asAttendanceApiError,
  requireAttendanceSessionsGateways,
} from "@/lib/attendance/attendance-api";
import {
  type AttendanceSessions,
  listAttendanceSessions,
} from "@/lib/attendance/attendance-sessions";
import { identifyAccountCaller } from "@/lib/auth/account-api";

/**
 * Las sesiones para pasar lista (#393, RF-4 del PRD de E8): los
 * entrenamientos del club ya empezados y no cancelados de los últimos 30
 * días, del más reciente al más antiguo, con si tienen hoja y sus totales.
 *
 * `RESTRICTED_ROUTES` ya reserva este camino a Admin y Coach, y el dominio lo
 * vuelve a comprobar.
 */

// Depende de la sesión de quien llama, de la hora y de las hojas guardadas.
export const dynamic = "force-dynamic";

export type AttendanceSessionsResponse = AttendanceSessions;

const getAttendanceSessions = createApiRoute<AttendanceSessionsResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await listAttendanceSessions(
          requireAttendanceSessionsGateways(),
          { callerId, now: new Date() },
        ),
      };
    } catch (error) {
      asAttendanceApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getAttendanceSessions,
});
