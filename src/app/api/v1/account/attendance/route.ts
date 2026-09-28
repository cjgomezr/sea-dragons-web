import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import type { MemberAttendance } from "@/lib/attendance/attendance-stats";
import {
  type OwnAttendanceGateways,
  readOwnAttendance,
} from "@/lib/attendance/own-attendance";
import { createSupabaseOwnAttendanceGateways } from "@/lib/attendance/supabase-attendance-stats";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";

/**
 * El porcentaje y el total de asistencia de quien llama (#394, RF-6 del PRD
 * de E8, FR-022): lo que enseña su perfil. Actúa siempre sobre quien
 * identifica la cookie de sesión, nunca sobre un id de la petición. Lo
 * alcanza cualquier cuenta activa; sin sesiones elegibles responde `no_data`,
 * no 0 (AC-017b).
 */

// Depende de la sesión de quien llama y de las hojas guardadas ahora.
export const dynamic = "force-dynamic";

export type OwnAttendanceResponse = MemberAttendance;

function requireOwnAttendanceGateways(): OwnAttendanceGateways {
  const wiring = createSupabaseOwnAttendanceGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

const getOwnAttendance = createApiRoute<OwnAttendanceResponse>({
  handler: async ({ request, decorateResponse }) => {
    const userId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await readOwnAttendance(requireOwnAttendanceGateways(), userId),
      };
    } catch (error) {
      return asAccountApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getOwnAttendance,
});
