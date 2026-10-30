import type { NextRequest, NextResponse } from "next/server";
import { createApiModule } from "@/lib/api/handler";
import {
  type ManagedCycleDetail,
  clearManagedCycleWeek,
} from "@/lib/training/club-cycles";
import { createCycleRoute } from "@/lib/training/training-manage-api";

/**
 * Vaciar una semana (#943, E35): sus siete días vuelven a descanso y su nota
 * y su dosis se van, sin mover las demás. Una semana que el ciclo no tiene,
 * o que no es un número entero, responde 400. Responde el ciclo entero, como
 * `copy-week-one`.
 */

// Depende de la sesión de quien llama y del ciclo ahora.
export const dynamic = "force-dynamic";

export type ManagedCycleDetailResponse = ManagedCycleDetail;

type ClearWeekRouteContext = {
  readonly params: Promise<{
    readonly cycleId: string;
    readonly weekNo: string;
  }>;
};

export async function POST(
  request: NextRequest,
  context: ClearWeekRouteContext,
): Promise<NextResponse> {
  const { weekNo } = await context.params;
  return createCycleRoute<ManagedCycleDetailResponse>({
    run: (gateways, { callerId, cycleId }) =>
      clearManagedCycleWeek(gateways, {
        callerId,
        cycleId,
        weekNo: Number(weekNo),
      }),
  })(request, context);
}

export const { GET, PUT, PATCH, DELETE } = createApiModule({});
