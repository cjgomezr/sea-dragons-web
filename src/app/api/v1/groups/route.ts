import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { type Group, createGroup, listGroups } from "@/lib/groups/groups";
import {
  asGroupsApiError,
  requireGroupsGateways,
} from "@/lib/groups/groups-api";

/**
 * Listar y crear los grupos del club (FR-023, FR-024, AC-012; RF-2 y RF-3 del
 * PRD de E4).
 *
 * Quién puede llamarlo lo decide la frontera: `RESTRICTED_ROUTES` reserva todo
 * `/api/v1/groups` a la capacidad de gestionar grupos. De qué club son los
 * grupos no se pregunta: sale de la fila de quien llama, identificado por su
 * cookie de sesión. La lista es la misma que E7 y E11 ofrecerán como audiencia
 * (RF-9).
 */

// Depende de la sesión de quien llama y de los grupos que haya ahora.
export const dynamic = "force-dynamic";

/** El nombre llega tal cual: recortarlo y medirlo es del dominio, que sabe
 * contar como la base. */
const groupBodySchema = z.object({ name: z.string() });

type GroupBody = z.infer<typeof groupBodySchema>;

/** Los grupos del club de quien llama, en orden alfabético, con su conteo. */
export type GroupsResponse = { readonly groups: readonly Group[] };

/** El grupo recién creado, con su conteo en 0. */
export type CreatedGroupResponse = Group;

const getGroups = createApiRoute<GroupsResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: { groups: await listGroups(requireGroupsGateways(), callerId) },
      };
    } catch (error) {
      asGroupsApiError(error);
    }
  },
});

const postGroup = createApiRoute<CreatedGroupResponse, GroupBody>({
  schema: groupBodySchema,
  handler: async ({ request, body, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await createGroup(requireGroupsGateways(), {
          callerId,
          name: body.name,
        }),
        status: 201,
      };
    } catch (error) {
      asGroupsApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getGroups,
  POST: postGroup,
});
