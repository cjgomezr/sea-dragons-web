// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  type CardUpdateGateways,
  startCardUpdate,
} from "@/lib/membership/card-update";
import type { CheckoutSessions } from "@/lib/membership/checkout";
import type { MembershipRecord } from "@/lib/membership/membership";

/**
 * Cambiar la tarjeta en Stripe (#455, RF-5 del PRD de E12, D6): una sesión de
 * Checkout en modo `setup` para el cliente de Stripe del socio. La tarjeta se
 * escribe en Stripe; la aplicación sólo recibe la dirección.
 */

const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const ORIGIN = "https://seadragons.example";
const NOW = new Date("2026-10-02T09:00:00.000Z");
const SETUP_URL = "https://checkout.stripe.com/c/pay/cs_test_setup";

function membership(change: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    userId: USER_ID,
    clubId: "c1",
    plan: "Full",
    status: "active",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
    currentPeriodEnd: new Date("2026-11-01T09:00:00Z"),
    trialEnd: null,
    card: { brand: "visa", last4: "4242", expMonth: 8, expYear: 2028 },
    waiver: null,
    ...change,
  };
}

function sessionsDouble(url: string | null = SETUP_URL): CheckoutSessions & {
  readonly create: ReturnType<typeof vi.fn<CheckoutSessions["create"]>>;
} {
  return { create: vi.fn<CheckoutSessions["create"]>(async () => ({ url })) };
}

function gateways(
  record: MembershipRecord | null,
  sessions = sessionsDouble(),
): CardUpdateGateways {
  return {
    membership: { findByUserId: async () => record },
    stripe: { kind: "configured", sessions },
  };
}

function start(target: CardUpdateGateways): ReturnType<typeof startCardUpdate> {
  return startCardUpdate(target, { userId: USER_ID, origin: ORIGIN, now: NOW });
}

describe("startCardUpdate", () => {
  it("abre Checkout en modo setup para el cliente de Stripe del socio y responde la dirección", async () => {
    const sessions = sessionsDouble();

    const outcome = await start(gateways(membership(), sessions));

    expect(outcome).toEqual({ kind: "created", url: SETUP_URL });
    expect(sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "setup",
        customer: "cus_123",
        currency: "aud",
        allowed_payment_method_types: ["card"],
        client_reference_id: USER_ID,
        setup_intent_data: { metadata: { user_id: USER_ID } },
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it("vuelve a Pagos diciendo si se guardó la tarjeta o se canceló", async () => {
    const sessions = sessionsDouble();

    await start(gateways(membership(), sessions));

    expect(sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url: `${ORIGIN}/pagos?tarjeta=ok`,
        cancel_url: `${ORIGIN}/pagos?tarjeta=cancelado`,
      }),
      expect.anything(),
    );
  });

  it("deja actualizar la tarjeta a quien tiene un cobro fallido", async () => {
    const outcome = await start(gateways(membership({ status: "past_due" })));

    expect(outcome.kind).toBe("created");
  });

  it("rechaza a quien no tiene cliente en Stripe, sin pedir nada", async () => {
    const sessions = sessionsDouble();

    const outcome = await start(
      gateways(membership({ stripeCustomerId: null }), sessions),
    );

    expect(outcome).toEqual({
      kind: "refused",
      reason: "no_stripe_customer",
    });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it("rechaza a quien no tiene membresía", async () => {
    const outcome = await start(gateways(null));

    expect(outcome).toEqual({
      kind: "refused",
      reason: "no_stripe_customer",
    });
  });

  it("rechaza sin Stripe configurado", async () => {
    const outcome = await startCardUpdate(
      {
        membership: { findByUserId: async () => membership() },
        stripe: { kind: "unconfigured" },
      },
      { userId: USER_ID, origin: ORIGIN, now: NOW },
    );

    expect(outcome).toEqual({
      kind: "refused",
      reason: "stripe_not_configured",
    });
  });

  it("falla con contexto si Stripe crea la sesión sin dirección", async () => {
    await expect(
      start(gateways(membership(), sessionsDouble(null))),
    ).rejects.toThrow(/sin dirección/);
  });
});
