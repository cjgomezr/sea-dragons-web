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
 * La membresía y los pagos contra `seadragons-dev` (#451, RF-1 y RF-7 del PRD
 * de E12): cada socio lee sólo lo suyo, nadie escribe salvo el servidor y
 * `stripe_events` no lo lee nadie desde fuera. Las reglas que la base afirma
 * sola (plan, estado, claves, relleno, cascadas) están en
 * `tests/unit/supabase/memberships-migration.test.ts`.
 */

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

/** Un socio activo con su membresía. La reserva le borra la fila de socio al
 * terminar, y esa fila se lleva su membresía y sus pagos en cascada. */
async function withMemberAndMembership<T>(
  serviceClient: ServiceRoleClient,
  input: { readonly clubId: string; readonly plan: string },
  run: (user: TestUser) => Promise<T>,
): Promise<T> {
  return withTestUser(serviceClient, async (user) => {
    const { error: memberError } = await serviceClient.client
      .from("members")
      .insert({
        club_id: input.clubId,
        user_id: user.id,
        full_name: "Marta Membresía",
        email: user.email,
        account_status: "active",
      });
    if (memberError) {
      throw new Error(`No se pudo sembrar el socio: ${memberError.message}`);
    }
    const { error } = await serviceClient.client.from("memberships").insert({
      user_id: user.id,
      club_id: input.clubId,
      plan: input.plan,
      status: "pending",
    });
    if (error) {
      throw new Error(`No se pudo sembrar la membresía: ${error.message}`);
    }
    return run(user);
  });
}

function paymentFor(
  user: TestUser,
  clubId: string,
  description: string,
): Record<string, unknown> {
  return {
    user_id: user.id,
    club_id: clubId,
    stripe_invoice_id: `in_rls_${crypto.randomUUID()}`,
    amount_cents: 4500,
    currency: "aud",
    description,
    status: "paid",
  };
}

function authenticatedClientFor(user: TestUser): Promise<RlsClient> {
  return createRlsClient(
    { role: "authenticated", email: user.email, password: user.password },
    process.env,
  );
}

/** Dos socios del club, cada uno con su membresía y un pago. */
async function withTwoPayingMembers(
  run: (world: {
    readonly serviceClient: ServiceRoleClient;
    readonly clubId: string;
    readonly socia: TestUser;
    readonly otro: TestUser;
  }) => Promise<void>,
): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  const clubId = await seededClubId(serviceClient);
  await withMemberAndMembership(
    serviceClient,
    { clubId, plan: "Student" },
    (socia) =>
      withMemberAndMembership(
        serviceClient,
        { clubId, plan: "Casual" },
        (otro) =>
          withSeededRows(
            serviceClient,
            "payments",
            [
              paymentFor(socia, clubId, "Cuota propia"),
              paymentFor(otro, clubId, "Cuota ajena"),
            ],
            () => run({ serviceClient, clubId, socia, otro }),
          ),
      ),
  );
}

describeRls("RLS de la membresía y los pagos", () => {
  it(
    "un socio lee sólo su membresía",
    () =>
      withTwoPayingMembers(async ({ socia }) => {
        const { client } = await authenticatedClientFor(socia);

        const { data, error } = await client
          .from("memberships")
          .select("user_id, plan, status");

        expect(error).toBeNull();
        expect(data).toEqual([
          { user_id: socia.id, plan: "Student", status: "pending" },
        ]);
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un socio lee sólo sus pagos",
    () =>
      withTwoPayingMembers(async ({ socia }) => {
        const { client } = await authenticatedClientFor(socia);

        const { data, error } = await client
          .from("payments")
          .select("description");

        expect(error).toBeNull();
        expect(data).toEqual([{ description: "Cuota propia" }]);
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un socio no puede ponerse al día escribiendo su membresía",
    () =>
      withTwoPayingMembers(async ({ socia }) => {
        const rlsClient = await authenticatedClientFor(socia);

        await assertDenied(rlsClient, (client) =>
          client
            .from("memberships")
            .update({ status: "active" })
            .eq("user_id", socia.id)
            .select(),
        );
        await assertDenied(rlsClient, (client) =>
          client.from("memberships").delete().eq("user_id", socia.id).select(),
        );
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un socio no puede apuntarse un pago",
    () =>
      withTwoPayingMembers(async ({ socia, clubId }) => {
        const rlsClient = await authenticatedClientFor(socia);

        await assertDenied(rlsClient, (client) =>
          client
            .from("payments")
            .insert(paymentFor(socia, clubId, "Pago inventado"))
            .select(),
        );
        await assertDenied(rlsClient, (client) =>
          client
            .from("payments")
            .update({ status: "failed" })
            .eq("user_id", socia.id)
            .select(),
        );
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "ni un socio ni anon leen stripe_events",
    () =>
      withTwoPayingMembers(async ({ socia }) => {
        const authenticated = await authenticatedClientFor(socia);
        const anon = await createRlsClient({ role: "anon" }, process.env);

        for (const rlsClient of [authenticated, anon]) {
          await assertDenied(rlsClient, (client) =>
            client.from("stripe_events").select("id"),
          );
        }
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
