import { expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  RoleRequestAlreadyDecidedError,
  decideRoleRequest,
} from "@/lib/auth/role-request-decision";
import { requestRole } from "@/lib/auth/role-request";
import { DEFAULT_CLUB_SLUG } from "@/lib/auth/supabase-auth-gateways";
import { createRoleRequestDecisionGateways } from "@/lib/auth/supabase-role-request-decision-gateways";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  createServiceRoleTestClient,
  describeRls,
  withTestUser,
} from "../../support/rls";

/**
 * Decidir una solicitud contra `seadragons-dev` con los adaptadores de verdad
 * y `0013_decide_role_request.sql` aplicada. Lo que ningún doble puede decir:
 * que aprobar deja solicitud y rol cambiados juntos, que dos Admin decidiendo
 * a la vez dejan una sola decisión, y qué queda en `audit_log`.
 */

const MEMBERS_TABLE = "members";
const ROLE_REQUESTS_TABLE = "role_requests";
const AUDIT_LOG_TABLE = "audit_log";

type SeededMember = { readonly userId: string; readonly fullName: string };

async function readClubId(serviceClient: ServiceRoleClient): Promise<string> {
  const { data, error } = await serviceClient.client
    .from("clubs")
    .select("id")
    .eq("slug", DEFAULT_CLUB_SLUG)
    .single();
  if (error || !data) {
    throw new Error(
      `No se pudo leer el club sembrado: ${error?.message ?? "sin datos"}`,
    );
  }
  return data.id as string;
}

async function withActiveMember<T>(
  serviceClient: ServiceRoleClient,
  role: Role,
  run: (member: SeededMember) => Promise<T>,
): Promise<T> {
  const clubId = await readClubId(serviceClient);
  const fullName = `Socia ${role} de prueba`;
  return withTestUser(serviceClient, async (user) => {
    const { error } = await serviceClient.client.from(MEMBERS_TABLE).insert({
      club_id: clubId,
      user_id: user.id,
      full_name: fullName,
      email: user.email,
      account_status: "active",
      role,
    });
    if (error) {
      throw new Error(`No se pudo sembrar el socio ${role}: ${error.message}`);
    }
    return run({ userId: user.id, fullName });
  });
}

/** Un Admin y un Player con una solicitud de Coach pendiente. Las entradas de
 * bitácora que deje el caso se borran al terminar: `audit_log` no cuelga de
 * ninguna identidad y no se va con la cascada. */
async function withPendingCoachRequest<T>(
  serviceClient: ServiceRoleClient,
  run: (seed: {
    readonly admin: SeededMember;
    readonly member: SeededMember;
    readonly requestId: string;
  }) => Promise<T>,
): Promise<T> {
  return withActiveMember(serviceClient, "Admin", (admin) =>
    withActiveMember(serviceClient, "Player", async (member) => {
      const request = await requestRole(
        createRoleRequestGateways(serviceClient.client),
        {
          userId: member.userId,
          requestedRole: "Coach",
          justification: "Entreno a los juveniles.",
        },
      );
      try {
        return await run({ admin, member, requestId: request.id });
      } finally {
        await deleteAuditEntries(serviceClient, [request.id, member.userId]);
      }
    }),
  );
}

async function deleteAuditEntries(
  serviceClient: ServiceRoleClient,
  entityIds: readonly string[],
): Promise<void> {
  const { error } = await serviceClient.client
    .from(AUDIT_LOG_TABLE)
    .delete()
    .in("entity_id", entityIds);
  if (error) {
    throw new Error(`No se pudo limpiar la bitácora: ${error.message}`);
  }
}

async function readState(
  serviceClient: ServiceRoleClient,
  seed: { readonly member: SeededMember; readonly requestId: string },
): Promise<{ readonly status: string; readonly role: string }> {
  const [request, member] = await Promise.all([
    serviceClient.client
      .from(ROLE_REQUESTS_TABLE)
      .select("status")
      .eq("id", seed.requestId)
      .single(),
    serviceClient.client
      .from(MEMBERS_TABLE)
      .select("role")
      .eq("user_id", seed.member.userId)
      .single(),
  ]);
  if (request.error || member.error) {
    throw new Error(
      `No se pudo leer el estado: ${request.error?.message ?? member.error?.message}`,
    );
  }
  return {
    status: request.data.status as string,
    role: member.data.role as string,
  };
}

async function readAuditEntries(
  serviceClient: ServiceRoleClient,
  entityIds: readonly string[],
): Promise<readonly Record<string, unknown>[]> {
  const { data, error } = await serviceClient.client
    .from(AUDIT_LOG_TABLE)
    .select("actor_id, action, entity_type, entity_id, result, metadata")
    .in("entity_id", entityIds);
  if (error) {
    throw new Error(`No se pudo leer la bitácora: ${error.message}`);
  }
  // Ordenadas aquí y no con `order`: la colación de la base no ordena el
  // punto como un carácter más.
  return [...data].sort((left, right) =>
    String(left.action) < String(right.action) ? -1 : 1,
  );
}

describeRls("decidir solicitudes de rol contra seadragons-dev", () => {
  it(
    "aprobar cambia la solicitud y el rol, y deja las dos entradas en la bitácora",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createRoleRequestDecisionGateways(serviceClient.client);

      await withPendingCoachRequest(serviceClient, async (seed) => {
        const decided = await decideRoleRequest(gateways, {
          deciderId: seed.admin.userId,
          requestId: seed.requestId,
          decision: "approved",
        });

        expect(decided).toMatchObject({
          id: seed.requestId,
          status: "approved",
          decidedBy: seed.admin.userId,
        });
        await expect(readState(serviceClient, seed)).resolves.toEqual({
          status: "approved",
          role: "Coach",
        });
        const entries = await readAuditEntries(serviceClient, [
          seed.requestId,
          seed.member.userId,
        ]);
        expect(entries).toEqual([
          {
            actor_id: seed.admin.userId,
            action: "role.changed",
            entity_type: "member",
            entity_id: seed.member.userId,
            result: "success",
            metadata: {
              previousRole: "Player",
              newRole: "Coach",
              roleRequestId: seed.requestId,
            },
          },
          {
            actor_id: seed.admin.userId,
            action: "role_request.decided",
            entity_type: "role_request",
            entity_id: seed.requestId,
            result: "success",
            metadata: { decision: "approved" },
          },
        ]);
        const written = JSON.stringify(entries);
        expect(written).not.toContain(seed.member.fullName);
        expect(written).not.toContain("Entreno a los juveniles.");
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "dos Admin decidiendo a la vez dejan una sola decisión aplicada",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createRoleRequestDecisionGateways(serviceClient.client);

      await withPendingCoachRequest(serviceClient, (seed) =>
        withActiveMember(serviceClient, "Admin", async (secondAdmin) => {
          const outcomes = await Promise.allSettled([
            decideRoleRequest(gateways, {
              deciderId: seed.admin.userId,
              requestId: seed.requestId,
              decision: "approved",
            }),
            decideRoleRequest(gateways, {
              deciderId: secondAdmin.userId,
              requestId: seed.requestId,
              decision: "rejected",
            }),
          ]);

          const applied = outcomes.flatMap((outcome) =>
            outcome.status === "fulfilled" ? [outcome.value] : [],
          );
          const refused = outcomes.flatMap((outcome) =>
            outcome.status === "rejected" ? [outcome.reason] : [],
          );
          expect(applied).toHaveLength(1);
          expect(refused).toHaveLength(1);
          expect(refused[0]).toBeInstanceOf(RoleRequestAlreadyDecidedError);

          const winner = applied[0]!.status;
          await expect(readState(serviceClient, seed)).resolves.toEqual({
            status: winner,
            role: winner === "approved" ? "Coach" : "Player",
          });
          const decisionEntries = (
            await readAuditEntries(serviceClient, [seed.requestId])
          ).filter((entry) => entry.action === "role_request.decided");
          expect(decisionEntries).toHaveLength(1);
        }),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
