import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type ManagedMarks,
  createClubMark,
  listClubMarks,
} from "@/lib/training/club-marks";
import {
  asTrainingManageApiError,
  markNameBodySchema,
  requireClubMarksGateways,
} from "@/lib/training/training-manage-api";

/**
 * Las marcas del club en Planificar (#903, RF-11 y D11 del PRD de E35): GET
 * las lista con "usada en {n} filas" y "{k} socios la registraron", y POST
 * crea una al final. Nunca un valor ni el nombre de un socio. La frontera la
 * reserva a Admin y Coach, y el dominio lo vuelve a comprobar.
 */

// Depende de la sesión de quien llama y de las marcas del club ahora.
export const dynamic = "force-dynamic";

export type ManagedMarksResponse = ManagedMarks;

type MarkNameBody = { readonly name: string };

const getMarks = createApiRoute<ManagedMarksResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await listClubMarks(requireClubMarksGateways(), callerId),
      };
    } catch (error) {
      return asTrainingManageApiError(error);
    }
  },
});

const postMark = createApiRoute<ManagedMarksResponse, MarkNameBody>({
  schema: markNameBodySchema,
  handler: async ({ request, body, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await createClubMark(requireClubMarksGateways(), {
          callerId,
          name: body.name,
        }),
        status: 201,
      };
    } catch (error) {
      return asTrainingManageApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getMarks,
  POST: postMark,
});
