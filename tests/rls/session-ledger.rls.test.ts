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
  withTestUser,
} from "../support/rls";

/**
 * El libro de sesiones contra `seadragons-dev` (#468, RF-1 del PRD de E13):
 * cada socio lee sólo sus movimientos y nadie escribe salvo el servidor. Lo
 * que la base afirma sola (crédito idempotente, descuento, estado derivado)
 * está en `tests/unit/supabase/session-ledger-migration.test.ts`.
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

async function seedMember(
  serviceClient: ServiceRoleClient,
  input: { readonly clubId: string; readonly user: TestUser },
): Promise<void> {
  const { error: memberError } = await serviceClient.client
    .from("members")
    .insert({
      club_id: input.clubId,
      user_id: input.user.id,
      full_name: "Carla Casual",
      email: input.user.email,
      account_status: "active",
    });
  if (memberError) {
    throw new Error(`No se pudo sembrar el socio: ${memberError.message}`);
  }
  const { error } = await serviceClient.client.from("memberships").insert({
    user_id: input.user.id,
    club_id: input.clubId,
    plan: "Casual",
    status: "pending",
  });
  if (error) {
    throw new Error(`No se pudo sembrar la membresía: ${error.message}`);
  }
}

/** Un pago y su pack acreditado. La reserva le borra la fila de socio al
 * terminar, y esa fila se lleva el pago y el movimiento en cascada. */
async function creditPack(
  serviceClient: ServiceRoleClient,
  input: {
    readonly clubId: string;
    readonly user: TestUser;
    readonly sessions: number;
  },
): Promise<void> {
  const { data, error } = await serviceClient.client
    .from("payments")
    .insert({
      user_id: input.user.id,
      club_id: input.clubId,
      stripe_charge_id: `ch_rls_${crypto.randomUUID()}`,
      amount_cents: input.sessions * 1500,
      status: "paid",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      `No se pudo sembrar el pago: ${error?.message ?? "sin datos"}`,
    );
  }
  const { error: creditError } = await serviceClient.client.rpc(
    "credit_session_pack",
    {
      user_id: input.user.id,
      club_id: input.clubId,
      sessions: input.sessions,
      payment_id: data.id as string,
    },
  );
  if (creditError) {
    throw new Error(`No se pudo acreditar el pack: ${creditError.message}`);
  }
}

function authenticatedClientFor(user: TestUser): Promise<RlsClient> {
  return createRlsClient(
    { role: "authenticated", email: user.email, password: user.password },
    process.env,
  );
}

/** Dos Casual del club, uno con un pack de 5 y otro con uno de 10. */
async function withTwoCasuals(
  run: (world: {
    readonly clubId: string;
    readonly socia: TestUser;
    readonly otro: TestUser;
  }) => Promise<void>,
): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  const clubId = await seededClubId(serviceClient);
  await withTestUser(serviceClient, (socia) =>
    withTestUser(serviceClient, async (otro) => {
      await seedMember(serviceClient, { clubId, user: socia });
      await seedMember(serviceClient, { clubId, user: otro });
      await creditPack(serviceClient, { clubId, user: socia, sessions: 5 });
      await creditPack(serviceClient, { clubId, user: otro, sessions: 10 });
      await run({ clubId, socia, otro });
    }),
  );
}

describeRls("RLS del libro de sesiones", () => {
  it(
    "un socio lee sólo sus movimientos",
    () =>
      withTwoCasuals(async ({ socia }) => {
        const { client } = await authenticatedClientFor(socia);

        const { data, error } = await client
          .from("session_ledger")
          .select("user_id, delta, kind");

        expect(error).toBeNull();
        expect(data).toEqual([
          { user_id: socia.id, delta: 5, kind: "pack_purchase" },
        ]);
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un socio no puede regalarse sesiones ni borrar sus descuentos",
    () =>
      withTwoCasuals(async ({ socia, clubId }) => {
        const rlsClient = await authenticatedClientFor(socia);

        await assertDenied(rlsClient, (client) =>
          client
            .from("session_ledger")
            .insert({
              user_id: socia.id,
              club_id: clubId,
              delta: 50,
              kind: "pack_purchase",
            })
            .select(),
        );
        await assertDenied(rlsClient, (client) =>
          client
            .from("session_ledger")
            .update({ delta: 50 })
            .eq("user_id", socia.id)
            .select(),
        );
        await assertDenied(rlsClient, (client) =>
          client
            .from("session_ledger")
            .delete()
            .eq("user_id", socia.id)
            .select(),
        );
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "ni un socio ni anon acreditan un pack por la API",
    () =>
      withTwoCasuals(async ({ socia, clubId }) => {
        const authenticated = await authenticatedClientFor(socia);
        const anon = await createRlsClient({ role: "anon" }, process.env);

        for (const rlsClient of [authenticated, anon]) {
          await assertDenied(rlsClient, (client) =>
            client.rpc("credit_session_pack", {
              user_id: socia.id,
              club_id: clubId,
              sessions: 50,
              payment_id: crypto.randomUUID(),
            }),
          );
        }
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
