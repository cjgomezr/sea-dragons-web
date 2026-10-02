// @vitest-environment node
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import Stripe from "stripe";
import { afterEach, beforeEach, expect, it } from "vitest";
import { STRIPE_WEBHOOK_API_PATH } from "@/lib/auth/routes";
import {
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
 * El webhook de Stripe contra `seadragons-dev` (#452), con la ruta, el
 * adaptador y `0051_apply_stripe_event.sql` de verdad. La firma la pone el
 * propio test con un secreto de prueba, así que no hace falta la cuenta de
 * Stripe: lo que se prueba es que un evento firmado escribe la membresía y
 * el pago, y que el mismo id no los repite.
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

type StripeIds = {
  readonly customerId: string;
  readonly subscriptionId: string;
  readonly invoiceId: string;
};

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

/** La reserva borra la fila de socio al terminar, y con ella su membresía y
 * sus pagos en cascada. */
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
        full_name: "Sara Suscrita",
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

function subscriptionEvent(user: TestUser, ids: StripeIds): Stripe.Event {
  return stripeEvent("customer.subscription.updated", {
    id: `evt_${randomUUID()}`,
    object: {
      id: ids.subscriptionId,
      customer: ids.customerId,
      metadata: { user_id: user.id },
    },
  });
}

function invoiceEvent(ids: StripeIds): Stripe.Event {
  return stripeEvent("invoice.paid", {
    id: `evt_${randomUUID()}`,
    object: { id: ids.invoiceId, customer: ids.customerId },
  });
}

async function readMembership(
  serviceClient: ServiceRoleClient,
  user: TestUser,
): Promise<Record<string, unknown>> {
  const { data, error } = await serviceClient.client
    .from("memberships")
    .select("status, stripe_customer_id, stripe_subscription_id, card_last4")
    .eq("user_id", user.id)
    .single();
  if (error) {
    throw new Error(`No se pudo leer la membresía: ${error.message}`);
  }
  return data;
}

async function countPayments(
  serviceClient: ServiceRoleClient,
  user: TestUser,
): Promise<number> {
  const { count, error } = await serviceClient.client
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (error || count === null) {
    throw new Error(
      `No se pudieron contar los pagos: ${error?.message ?? "sin cuenta"}`,
    );
  }
  return count;
}

async function deleteEvents(
  serviceClient: ServiceRoleClient,
  ids: readonly string[],
): Promise<void> {
  const { error } = await serviceClient.client
    .from("stripe_events")
    .delete()
    .in("id", ids);
  if (error) {
    throw new Error(`No se pudieron borrar los eventos: ${error.message}`);
  }
}

function freshStripeIds(): StripeIds {
  const suffix = randomUUID();
  return {
    customerId: `cus_it_${suffix}`,
    subscriptionId: `sub_it_${suffix}`,
    invoiceId: `in_it_${suffix}`,
  };
}

describeRls("el webhook de Stripe contra la base", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, ...STRIPE_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it(
    "un evento firmado escribe la membresía y el pago, y repetido no los repite",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      await withPendingMember(serviceClient, async (user) => {
        const ids = freshStripeIds();
        const subscription = subscriptionEvent(user, ids);
        const invoice = invoiceEvent(ids);
        try {
          const first = await postSigned(subscription);
          await postSigned(invoice);
          const repeated = await postSigned(invoice);

          expect(first.status).toBe(200);
          await expect(repeated.json()).resolves.toEqual({
            data: { outcome: "duplicate" },
          });
          await expect(readMembership(serviceClient, user)).resolves.toEqual({
            status: "trialing",
            stripe_customer_id: ids.customerId,
            stripe_subscription_id: ids.subscriptionId,
            card_last4: "4242",
          });
          await expect(countPayments(serviceClient, user)).resolves.toBe(1);
        } finally {
          await deleteEvents(serviceClient, [subscription.id, invoice.id]);
        }
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
