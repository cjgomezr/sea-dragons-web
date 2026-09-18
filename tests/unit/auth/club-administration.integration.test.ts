import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createClubAdministrationGateways } from "@/lib/auth/supabase-club-administration-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
  withTestUser,
} from "../../support/rls";

/**
 * Las dos lecturas de la pantalla de administración contra `seadragons-dev`.
 * Van con la llave de servicio, que se salta RLS, así que lo único que separa
 * un club de otro es el filtro del adaptador (NFR-009). Los dobles de los
 * tests de ruta no lo ven; esto sí.
 *
 * Los clubes son de usar y tirar: el sembrado lo comparte toda la suite y su
 * lista de socios cambia con cada test que crea uno.
 */

const MEMBERS_TABLE = "members";
const ROLE_REQUESTS_TABLE = "role_requests";
const CLUBS_TABLE = "clubs";

type SeededMember = TestUser & { readonly fullName: string };

async function withTwoClubs<T>(
  serviceClient: ServiceRoleClient,
  run: (clubIds: readonly [string, string]) => Promise<T>,
): Promise<T> {
  const club = (name: string) => ({
    slug: `administracion-${randomUUID()}`,
    name,
  });
  return withSeededRows(
    serviceClient,
    CLUBS_TABLE,
    [club("Club del Admin"), club("Club vecino")],
    ([own, other]) => run([own!.id as string, other!.id as string]),
  );
}

async function withPlayer<T>(
  serviceClient: ServiceRoleClient,
  seed: { readonly clubId: string; readonly fullName: string },
  run: (member: SeededMember) => Promise<T>,
): Promise<T> {
  return withTestUser(serviceClient, async (user) => {
    const { error } = await serviceClient.client.from(MEMBERS_TABLE).insert({
      club_id: seed.clubId,
      user_id: user.id,
      full_name: seed.fullName,
      email: user.email,
      account_status: "active",
      role: "Player",
    });
    if (error) {
      throw new Error(
        `No se pudo sembrar a ${seed.fullName}: ${error.message}`,
      );
    }
    return run({ ...user, fullName: seed.fullName });
  });
}

async function seedRequests(
  serviceClient: ServiceRoleClient,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  // Un insert de varias filas manda `null` en toda columna que una fila no
  // traiga, así que el default de `status` no llegaría a aplicarse.
  const { error } = await serviceClient.client
    .from(ROLE_REQUESTS_TABLE)
    .insert(
      rows.map((row) => ({ status: "pending", decided_at: null, ...row })),
    );
  if (error) {
    throw new Error(`No se pudieron sembrar las solicitudes: ${error.message}`);
  }
}

describeRls("las lecturas de administración contra seadragons-dev", () => {
  it(
    "devuelven sólo los socios y las solicitudes pendientes del club pedido, en orden",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createClubAdministrationGateways(serviceClient.client);

      await withTwoClubs(serviceClient, ([clubId, otherClubId]) =>
        withPlayer(
          serviceClient,
          { clubId, fullName: "Beatriz Soto" },
          (beatriz) =>
            withPlayer(
              serviceClient,
              { clubId, fullName: "Andrés Mora" },
              (andres) =>
                withPlayer(
                  serviceClient,
                  { clubId: otherClubId, fullName: "Vecina Ajena" },
                  async (neighbour) => {
                    await seedRequests(serviceClient, [
                      {
                        club_id: clubId,
                        user_id: beatriz.id,
                        requested_role: "Coach",
                        justification: "Entreno a los juveniles.",
                        created_at: "2026-09-10T02:00:00.000Z",
                      },
                      {
                        club_id: clubId,
                        user_id: andres.id,
                        requested_role: "Committee",
                        justification: null,
                        created_at: "2026-09-09T02:00:00.000Z",
                      },
                      {
                        club_id: clubId,
                        user_id: andres.id,
                        requested_role: "Coach",
                        status: "rejected",
                        decided_at: "2026-09-08T02:00:00.000Z",
                        created_at: "2026-09-01T02:00:00.000Z",
                      },
                      {
                        club_id: otherClubId,
                        user_id: neighbour.id,
                        requested_role: "Coach",
                        created_at: "2026-09-01T02:00:00.000Z",
                      },
                    ]);

                    const members =
                      await gateways.members.findClubMembers(clubId);
                    const pending =
                      await gateways.requests.findPendingRequests(clubId);

                    expect(members).toEqual([
                      {
                        userId: andres.id,
                        fullName: "Andrés Mora",
                        email: andres.email,
                        role: "Player",
                      },
                      {
                        userId: beatriz.id,
                        fullName: "Beatriz Soto",
                        email: beatriz.email,
                        role: "Player",
                      },
                    ]);
                    expect(
                      pending.map(({ userId, fullName, requestedRole }) => ({
                        userId,
                        fullName,
                        requestedRole,
                      })),
                    ).toEqual([
                      {
                        userId: andres.id,
                        fullName: "Andrés Mora",
                        requestedRole: "Committee",
                      },
                      {
                        userId: beatriz.id,
                        fullName: "Beatriz Soto",
                        requestedRole: "Coach",
                      },
                    ]);
                  },
                ),
            ),
        ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
