import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  asClubAdministrationApiError,
  requireClubAdministrationGateways,
} from "@/lib/auth/club-administration-api";
import {
  type ClubMember,
  listClubMembers,
} from "@/lib/auth/club-administration";

/**
 * Los socios del club (FR-015 reducido a lo que RF-8 pide, #212).
 *
 * Quién puede llamarlo lo decide la frontera: `RESTRICTED_ROUTES` reserva todo
 * `/api/v1/members` a la capacidad de gestionar usuarios y roles. De qué club
 * son los socios no se pregunta: sale de la fila de quien llama, identificado
 * por su cookie de sesión.
 *
 * Devuelve nombre, correo, rol y el `user_id` con el que se les cambia el rol.
 * Nada más: la fecha de nacimiento, el tutor y el país son del perfil de E5.
 */

// Depende de la sesión de quien llama y de los socios que haya ahora.
export const dynamic = "force-dynamic";

/** Los socios del club de quien llama, ordenados por nombre. */
export type ClubMembersResponse = { readonly members: readonly ClubMember[] };

const getClubMembers = createApiRoute<ClubMembersResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: {
          members: await listClubMembers(
            requireClubAdministrationGateways(),
            callerId,
          ),
        },
      };
    } catch (error) {
      asClubAdministrationApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getClubMembers,
});
