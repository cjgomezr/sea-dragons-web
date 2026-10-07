// @vitest-environment node
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import Stripe from "stripe";
import { afterEach, beforeEach, expect, it } from "vitest";
import { STRIPE_WEBHOOK_API_PATH } from "@/lib/auth/routes";
import { createPaidProductsGateway } from "@/lib/membership/supabase-membership-gateways";
import {
  FIXTURE_LEVY_PRODUCT_ID,
  FIXTURE_PRICES,
  stripeEvent,
} from "../../fixtures/stripe/stripe-events";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createServiceRoleTestClient,
  describeRls,
  withTestUser,
} from "../../support/rls";

/**
 * El levy por el webhook de Stripe contra `seadragons-dev` (#473), con la
 * ruta, el adaptador y `0060_levy_payments.sql` de verdad. La firma la pone el
 * propio test con un secreto de prueba: lo que se prueba es que un levy
 * pagado entra en el historial con su producto una sola vez, que sale como
 * pagado, y que la membresía no cambia.
 */

const ORIGIN = "http://localhost:3417";
const WEBHOOK_SECRET = "whsec_secreto_de_prueba_de_integracion";
const SEEDED_CLUB = "victoria-seadragons";
const STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_sin_red",
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_PRICE_FULL: FIXTURE_PRICES.full,
  STRIPE_PRICE_STUDENT: FIXTURE_PRICES.student,
};
const ORIGINAL_ENV = { ...process.env };

async function seededClubId(serviceClient: ServiceRoleClient): Promise<string> {
  const { data, error } = await serviceClient.client
    .from("clubs")
    .select("id")
    .eq("slug", SEEDED_CLUB)
    .single();
  if (error) {
    throw new Error(`No se pudo leer el club sembrado: ${error.message}`);
  }
  return String(data.id);
}

/** La reserva borra la fila de socio al terminar, y con ella su membresía,
 * sus pagos y su libro en cascada. */
async function withPendingMember(
  serviceClient: ServiceRoleClient,
  run: (user: TestUser) => Promise<void>,
): Promise<void> {
  const clubId = await seededClubId(serviceClient);
  await withTestUser(serviceClient, async (user) => {
    const { error: memberError } = await serviceClient.client
      .from("members")
      .insert({
        club_id: clubId,
        user_id: user.id,
        full_name: "Lola Levy",
        email: user.email,
        account_status: "active",
      });
    if (memberError) {
      throw new Error(`No se pudo sembrar el socio: ${memberError.message}`);
    }
    const { error } = await serviceClient.client
      .from("memberships")
      .insert({ user_id: user.id, club_id: clubId, plan: "Full" });
    if (error) {
      throw new Error(`No se pudo sembrar la membresía: ${error.message}`);
    }
    await run(user);
  });
}

async function postSigned(event: Stripe.Event): Promise<Response> {
  const { POST } = await import("@/app/api/v1/stripe/webhook/route");
  const payload = JSON.stringify(event);
  return POST(
    new NextRequest(new URL(STRIPE_WEBHOOK_API_PATH, ORIGIN), {
      method: "POST",
      body: payload,
      headers: {
        "stripe-signature": Stripe.webhooks.generateTestHeaderString({
          payload,
          secret: WEBHOOK_SECRET,
        }),
      },
    }),
  );
}

function levyEvent(user: TestUser): Stripe.Event {
  return stripeEvent("checkout.session.completed (levy)", {
    id: `evt_${randomUUID()}`,
    object: {
      client_reference_id: user.id,
      payment_intent: `pi_it_${randomUUID()}`,
      metadata: {
        user_id: user.id,
        kind: "levy",
        levy_product_id: FIXTURE_LEVY_PRODUCT_ID,
        levy_name: "Nationals 2026",
      },
    },
  });
}

async function readMembershipStatus(
  serviceClient: ServiceRoleClient,
  user: TestUser,
): Promise<unknown> {
  const { data, error } = await serviceClient.client
    .from("memberships")
    .select("status")
    .eq("user_id", user.id)
    .single();
  if (error) {
    throw new Error(`No se pudo leer la membresía: ${error.message}`);
  }
  return data.status;
}

async function readPaymentDescriptions(
  serviceClient: ServiceRoleClient,
  user: TestUser,
): Promise<readonly unknown[]> {
  const { data, error } = await serviceClient.client
    .from("payments")
    .select("description")
    .eq("user_id", user.id);
  if (error) {
    throw new Error(`No se pudieron leer los pagos: ${error.message}`);
  }
  return data.map((row) => row.description);
}

async function deleteEvent(
  serviceClient: ServiceRoleClient,
  id: string,
): Promise<void> {
  const { error } = await serviceClient.client
    .from("stripe_events")
    .delete()
    .eq("id", id);
  if (error) {
    throw new Error(`No se pudo borrar el evento: ${error.message}`);
  }
}

describeRls("el levy por el webhook contra la base", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, ...STRIPE_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it(
    "un levy firmado entra en el historial una vez, sale pagado y no toca la membresía",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      await withPendingMember(serviceClient, async (user) => {
        const event = levyEvent(user);
        try {
          const first = await postSigned(event);
          const repeated = await postSigned(event);

          await expect(first.json()).resolves.toEqual({
            data: { outcome: "applied" },
          });
          await expect(repeated.json()).resolves.toEqual({
            data: { outcome: "duplicate" },
          });
          await expect(
            readPaymentDescriptions(serviceClient, user),
          ).resolves.toEqual(["Nationals 2026"]);
          await expect(
            createPaidProductsGateway(serviceClient.client).findPaidProductIds(
              user.id,
            ),
          ).resolves.toEqual(new Set([FIXTURE_LEVY_PRODUCT_ID]));
          await expect(readMembershipStatus(serviceClient, user)).resolves.toBe(
            "pending",
          );
        } finally {
          await deleteEvent(serviceClient, event.id);
        }
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
