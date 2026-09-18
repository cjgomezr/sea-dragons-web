import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { openAccountSession } from "@/lib/auth/account-api";
import { type MemberGroup, listMemberGroups } from "@/lib/groups/member-groups";
import { createSupabaseMemberGroupsGateway } from "@/lib/groups/supabase-member-groups-gateway";

/**
 * Los grupos de quien llama (#229, RF-8 del PRD de E4), con id y nombre, en
 * orden alfabético. Lo alcanza cualquier cuenta activa, de cualquier rol: la
 * frontera ya respondió 401 o 403 a quien no tiene sesión o la tiene a medias.
 *
 * Lee con la sesión de quien llama, no con la llave de servicio: la RLS de
 * `0015_groups.sql` ya limita esa lectura a sus propios grupos.
 */

// Depende de la sesión de quien llama y de sus grupos en este instante.
export const dynamic = "force-dynamic";

/** Los grupos a los que pertenece quien llama. Vacía si no está en ninguno. */
export type AccountGroupsResponse = {
  readonly groups: readonly MemberGroup[];
};

const getAccountGroups = createApiRoute<AccountGroupsResponse>({
  handler: async ({ request, decorateResponse }) => {
    const { userId, client } = await openAccountSession({
      request,
      decorateResponse,
    });
    const gateway = createSupabaseMemberGroupsGateway(client);
    return { data: { groups: await listMemberGroups(gateway, userId) } };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getAccountGroups,
});
