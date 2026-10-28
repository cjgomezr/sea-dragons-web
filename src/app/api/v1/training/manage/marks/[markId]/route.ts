import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type ManagedMarks,
  MarkNotFoundError,
  deleteClubMark,
  renameClubMark,
} from "@/lib/training/club-marks";
import {
  asTrainingManageApiError,
  markNameBodySchema,
  readRouteId,
  requireClubMarksGateways,
} from "@/lib/training/training-manage-api";

/**
 * Renombrar o borrar una marca del club (#903, RF-11 del PRD de E35). Las
 * dos responden la lista entera. Borrar una usada en una fila es un 409
 * siempre; una sin usar con valores, un 409 con cuántos socios la
 * registraron, salvo con `?confirm=true`, que la borra con sus valores. Una
 * marca de otro club responde 404, como una que no existe.
 */

// Depende de la sesión de quien llama y de las marcas del club ahora.
export const dynamic = "force-dynamic";

export type ManagedMarksResponse = ManagedMarks;

const CONFIRM_PARAM = "confirm";

type MarkNameBody = { readonly name: string };

type MarkRouteContext = {
  readonly params: Promise<{ readonly markId: string }>;
};

async function readMarkId(context: MarkRouteContext): Promise<string> {
  return readRouteId((await context.params).markId, new MarkNotFoundError());
}

/** Sin el parámetro es `false`; cualquier cosa que no sea `true` o `false`,
 * un 400, para que un "sí" no se lea como una confirmación. */
function readConfirm(searchParams: URLSearchParams): boolean {
  const confirm = searchParams.get(CONFIRM_PARAM);
  if (confirm === null || confirm === "false") {
    return false;
  }
  if (confirm === "true") {
    return true;
  }
  throw new ApiError(
    "validation_error",
    `"${CONFIRM_PARAM}" tiene que ser true o false.`,
  );
}

export function PATCH(
  request: NextRequest,
  context: MarkRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<ManagedMarksResponse, MarkNameBody>({
    schema: markNameBodySchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const markId = await readMarkId(context);
      try {
        return {
          data: await renameClubMark(requireClubMarksGateways(), {
            callerId,
            markId,
            name: body.name,
          }),
        };
      } catch (error) {
        return asTrainingManageApiError(error);
      }
    },
  });
  return route(request);
}

export function DELETE(
  request: NextRequest,
  context: MarkRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<ManagedMarksResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const markId = await readMarkId(context);
      const confirm = readConfirm(apiRequest.nextUrl.searchParams);
      try {
        return {
          data: await deleteClubMark(requireClubMarksGateways(), {
            callerId,
            markId,
            confirm,
          }),
        };
      } catch (error) {
        return asTrainingManageApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, POST, PUT } = createApiModule({});
