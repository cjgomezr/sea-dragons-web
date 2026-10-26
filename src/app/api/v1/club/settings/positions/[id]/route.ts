import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { POSITION_COVERAGES } from "@/lib/club/club-positions";
import {
  type ManagedPositions,
  type ManagedPositionsGateways,
  renamePosition,
  setPositionArchived,
  setPositionCoverage,
  setPositionMinimum,
  setPositionShortNames,
} from "@/lib/club/manage-club-positions";
import {
  type ManagedPositionsResponse,
  asManagedPositionsApiError,
  positionNamesBodySchema,
  positionShortNamesBodySchema,
  positionsChanged,
  readPositionId,
  requireManagedPositionsGateways,
} from "@/lib/club/manage-club-positions-api";

/**
 * Renombrar, archivar o reactivar una posición del club (#300), o cambiarle
 * la función (#404), el mínimo por equipo o las abreviaturas (#885). Un PATCH
 * hace una sola cosa: trae `names`, `isArchived`, `coverage`, `minPerTeam` o
 * `shortNames`, nunca dos. La función es el código en inglés, o `null` para
 * quitársela. El mínimo llega como número y el dominio dice si vale, para
 * responder con el `reason` que la pantalla pone junto al campo.
 *
 * El `[id]` sólo alcanza a las posiciones del club de quien llama: la de otro
 * club responde 404, como una que no existe. Es sólo del Admin, como todo lo
 * que cuelga de la configuración del club.
 */

// Depende de la sesión de quien llama y de la posición ahora.
export const dynamic = "force-dynamic";

const changeBodySchema = z.union([
  z.object({ names: positionNamesBodySchema }).strict(),
  z.object({ isArchived: z.boolean() }).strict(),
  z.object({ coverage: z.enum(POSITION_COVERAGES).nullable() }).strict(),
  z.object({ minPerTeam: z.number() }).strict(),
  z.object({ shortNames: positionShortNamesBodySchema }).strict(),
]);

type ChangeBody = z.infer<typeof changeBodySchema>;

function applyChange(
  gateways: ManagedPositionsGateways,
  change: {
    readonly callerId: string;
    readonly positionId: string;
    readonly body: ChangeBody;
  },
): Promise<ManagedPositions> {
  const { callerId, positionId, body } = change;
  if ("names" in body) {
    return renamePosition(gateways, {
      callerId,
      positionId,
      names: body.names,
    });
  }
  if ("isArchived" in body) {
    return setPositionArchived(gateways, {
      callerId,
      positionId,
      isArchived: body.isArchived,
    });
  }
  if ("coverage" in body) {
    return setPositionCoverage(gateways, {
      callerId,
      positionId,
      coverage: body.coverage,
    });
  }
  if ("minPerTeam" in body) {
    return setPositionMinimum(gateways, {
      callerId,
      positionId,
      minPerTeam: body.minPerTeam,
    });
  }
  return setPositionShortNames(gateways, {
    callerId,
    positionId,
    shortNames: body.shortNames,
  });
}

type PositionRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function PATCH(
  request: NextRequest,
  context: PositionRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<ManagedPositionsResponse, ChangeBody>({
    schema: changeBodySchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const positionId = readPositionId((await context.params).id);
      const gateways = requireManagedPositionsGateways();
      try {
        const positions = await applyChange(gateways, {
          callerId,
          positionId,
          body,
        });
        return { data: positionsChanged(positions) };
      } catch (error) {
        asManagedPositionsApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, POST, PUT, DELETE } = createApiModule({});
