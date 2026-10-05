// @vitest-environment node
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import Stripe from "stripe";
import { afterEach, beforeEach, expect, it } from "vitest";
import { STRIPE_WEBHOOK_API_PATH } from "@/lib/auth/routes";
import {
  FIXTURE_PACK_SESSIONS,
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
 * El pack de sesiones por el webhook de Stripe contra `seadragons-dev` (#471),
 * con la ruta, el adaptador y `0057_apply_session_pack_payment.sql` de
 * verdad. La firma la pone el propio test con un secreto de prueba: lo que se
 * prueba es que un pack pagado entra en el historial, suma sus sesiones y
 * abre la membresía del Casual, y que el mismo evento no suma otra vez.
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
async function withPendingCasual(
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
        full_name: "Carla Casual",
        email: user.email,
        account_status: "active",
      });
    if (memberError) {
      throw new Error(`No se pudo sembrar el socio: ${memberError.message}`);
    }
    const { error } = await serviceClient.client
      .from("memberships")
      .insert({ user_id: user.id, club_id: clubId, plan: "Casual" });
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

function packEvent(user: TestUser): Stripe.Event {
  return stripeEvent("checkout.session.completed (pack)", {
    id: `evt_${randomUUID()}`,
    object: {
      client_reference_id: user.id,
      payment_intent: `pi_it_${randomUUID()}`,
      metadata: {
        user_id: user.id,
        kind: "session_pack",
        pack_sessions: String(FIXTURE_PACK_SESSIONS),
      },
    },
  });
}

async function readStanding(
  serviceClient: ServiceRoleClient,
  user: TestUser,
): Promise<{ readonly status: unknown; readonly sessions: number }> {
  const [membership, ledger] = await Promise.all([
    serviceClient.client
      .from("memberships")
      .select("status")
      .eq("user_id", user.id)
      .single(),
    serviceClient.client
      .from("session_ledger")
      .select("delta")
      .eq("user_id", user.id),
  ]);
  if (membership.error || ledger.error) {
    throw new Error(
      `No se pudo leer el estado: ${membership.error?.message ?? ledger.error?.message}`,
    );
  }
  return {
    status: membership.data.status,
    sessions: ledger.data.reduce((sum, row) => sum + Number(row.delta), 0),
  };
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

describeRls("el pack de sesiones por el webhook contra la base", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, ...STRIPE_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it(
    "un pack firmado suma sus sesiones y abre la membresía, y repetido no suma",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      await withPendingCasual(serviceClient, async (user) => {
        const event = packEvent(user);
        try {
          const first = await postSigned(event);
          const repeated = await postSigned(event);

          await expect(first.json()).resolves.toEqual({
            data: { outcome: "applied" },
          });
          await expect(repeated.json()).resolves.toEqual({
            data: { outcome: "duplicate" },
          });
          await expect(readStanding(serviceClient, user)).resolves.toEqual({
            status: "active",
            sessions: FIXTURE_PACK_SESSIONS,
          });
          await expect(countPayments(serviceClient, user)).resolves.toBe(1);
        } finally {
          await deleteEvent(serviceClient, event.id);
        }
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
