import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { readMemberMarks } from "@/lib/training/member-marks";
import {
  type MemberMarksResponse,
  asMemberMarksApiError,
  requireMemberMarksGateways,
} from "@/lib/training/member-marks-api";

/**
 * Las marcas del club con el valor del socio de la sesión, o nulo (#899,
 * RF-5 y D11 del PRD de E35). Sólo las suyas: no hay forma de pedir las de
 * otro. Quien no está al día recibe un 403 con su motivo, como en el plan.
 */

// Depende de la sesión de quien llama, de su membresía y de sus marcas.
export const dynamic = "force-dynamic";

const getMyMarks = createApiRoute<MemberMarksResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await readMemberMarks(requireMemberMarksGateways(), {
          callerId,
          now: new Date(),
        }),
      };
    } catch (error) {
      return asMemberMarksApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getMyMarks,
});
