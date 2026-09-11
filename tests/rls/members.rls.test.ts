import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type RlsClient,
  type ServiceRoleClient,
  type TestUser,
  assertDenied,
  createRlsClient,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
  withTestUser,
} from "../support/rls";

/**
 * La frontera de NFR-004 sobre los datos personales del club, probada contra
 * `seadragons-dev` atacando la API con la identidad equivocada. Lo que una
 * base puede afirmar sola (columnas, restricciones, privilegios) está en
 * `tests/unit/supabase/members-migration.test.ts`.
 */

const MEMBERS_TABLE = "members";

async function seededClubId(serviceClient: ServiceRoleClient): Promise<string> {
  const { data, error } = await serviceClient.client
    .from("clubs")
    .select("id")
    .eq("slug", "victoria-seadragons")
    .single();
  if (error || !data) {
    throw new Error(
      `No se pudo leer el club sembrado: ${error?.message ?? "sin datos"}`,
    );
  }
  return data.id as string;
}

function memberRow(
  clubId: string,
  user: TestUser,
): Readonly<Record<string, unknown>> {
  return {
    club_id: clubId,
    user_id: user.id,
    full_name: "Nerea Silva",
    email: user.email,
  };
}

/** Crea una identidad de prueba con su fila de miembro en `clubId`, y deshace
 * las dos al terminar. */
async function withMember<T>(
  serviceClient: ServiceRoleClient,
  clubId: string,
  run: (user: TestUser) => Promise<T>,
): Promise<T> {
  return withTestUser(serviceClient, (user) =>
    withSeededRows(
      serviceClient,
      MEMBERS_TABLE,
      [memberRow(clubId, user)],
      () => run(user),
    ),
  );
}

/** Siembra un segundo club y entrega su id: es lo que permite afirmar que un
 * miembro no ve filas de otro club (NFR-009) con un club de verdad y no con un
 * uuid inventado. */
async function withOtherClub<T>(
  serviceClient: ServiceRoleClient,
  run: (clubId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `club-de-prueba-${randomUUID()}`, name: "Club de prueba" }],
    async ([club]) => {
      if (!club) {
        throw new Error("el arnés no devolvió el club que acababa de sembrar");
      }
      return run(club.id as string);
    },
  );
}

function authenticatedClientFor(user: TestUser): Promise<RlsClient> {
  return createRlsClient(
    { role: "authenticated", email: user.email, password: user.password },
    process.env,
  );
}

/** Los correos de todos los miembros vistos con la llave de servicio, que salta
 * RLS: es la única forma de saber qué filas había cuando una policy devuelve
 * menos de las que existen. */
async function visibleEmails(
  serviceClient: ServiceRoleClient,
): Promise<string[]> {
  const { data, error } = await serviceClient.client
    .from(MEMBERS_TABLE)
    .select("email");
  if (error || !data) {
    throw new Error(
      `No se pudieron releer los miembros sembrados: ${error?.message ?? "sin datos"}`,
    );
  }
  return data.map((row) => row.email as string);
}

/** Lee la fila con la llave de servicio: sirve para comprobar que un intento
 * denegado no cambió nada, que es lo que un `error` por sí solo no prueba. */
async function storedMember(
  serviceClient: ServiceRoleClient,
  user: TestUser,
): Promise<Record<string, unknown>> {
  const { data, error } = await serviceClient.client
    .from(MEMBERS_TABLE)
    .select("role, account_status")
    .eq("user_id", user.id)
    .single();
  if (error || !data) {
    throw new Error(
      `No se pudo releer el miembro sembrado: ${error?.message ?? "sin datos"}`,
    );
  }
  return data;
}

describeRls("RLS de miembros", () => {
  it(
    "no devuelve ninguna fila a un cliente anónimo",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const clubId = await seededClubId(serviceClient);

      await withMember(serviceClient, clubId, async () => {
        const rlsClient = await createRlsClient({ role: "anon" }, process.env);

        await assertDenied(rlsClient, (client) =>
          client.from(MEMBERS_TABLE).select("*"),
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "devuelve a un miembro su propia fila",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const clubId = await seededClubId(serviceClient);

      await withMember(serviceClient, clubId, async (user) => {
        const rlsClient = await authenticatedClientFor(user);

        const { data, error } = await rlsClient.client
          .from(MEMBERS_TABLE)
          .select("email, role, account_status");

        expect(error).toBeNull();
        expect(data).toEqual([
          {
            email: user.email,
            role: "Player",
            account_status: "incomplete",
          },
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "no devuelve a un miembro la fila de otro club",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const clubId = await seededClubId(serviceClient);

      await withOtherClub(serviceClient, (otherClubId) =>
        withMember(serviceClient, otherClubId, (forastero) =>
          withMember(serviceClient, clubId, async (socio) => {
            const rlsClient = await authenticatedClientFor(socio);

            const { data, error } = await rlsClient.client
              .from(MEMBERS_TABLE)
              .select("email");

            expect(error).toBeNull();
            expect(data).toEqual([{ email: socio.email }]);
            // Con la llave de servicio las dos filas se ven: lo que la lectura
            // de arriba devolvió es lo que la policy dejó pasar, no lo único
            // que había.
            expect(await visibleEmails(serviceClient)).toEqual(
              expect.arrayContaining([socio.email, forastero.email]),
            );
          }),
        ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "no deja a un miembro cambiar su propio rol",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const clubId = await seededClubId(serviceClient);

      await withMember(serviceClient, clubId, async (user) => {
        const rlsClient = await authenticatedClientFor(user);

        await assertDenied(rlsClient, (client) =>
          client
            .from(MEMBERS_TABLE)
            .update({ role: "Admin" })
            .eq("user_id", user.id)
            .select(),
        );

        expect(await storedMember(serviceClient, user)).toEqual({
          role: "Player",
          account_status: "incomplete",
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "no deja a un miembro cambiar su propio estado de cuenta",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const clubId = await seededClubId(serviceClient);

      await withMember(serviceClient, clubId, async (user) => {
        const rlsClient = await authenticatedClientFor(user);

        await assertDenied(rlsClient, (client) =>
          client
            .from(MEMBERS_TABLE)
            .update({ account_status: "active" })
            .eq("user_id", user.id)
            .select(),
        );

        expect(await storedMember(serviceClient, user)).toEqual({
          role: "Player",
          account_status: "incomplete",
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
