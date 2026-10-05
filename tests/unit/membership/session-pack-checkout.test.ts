// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { CheckoutSessions } from "@/lib/membership/checkout";
import type { MembershipRecord } from "@/lib/membership/membership";
import {
  type SessionPackCheckoutGateways,
  startSessionPackCheckout,
} from "@/lib/membership/session-pack-checkout";

/**
 * La compra de un pack de sesiones en Stripe Checkout (#471, RF-5 del PRD de
 * E13, D1 y D2). Stripe va doblado: lo que se prueba son los parámetros de la
 * sesión de pago y cuándo no se pide ninguna.
 */

const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";
const EMAIL = "alba@example.com";
const ORIGIN = "https://seadragons.example";
const NOW = new Date("2026-10-05T09:00:00.000Z");
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_pack";
const CASUAL_SESSION_PRICE = "price_casual_session_test";
const OFFERED_SIZES = [5, 10] as const;

function membership(change: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    userId: USER_ID,
    clubId: CLUB_ID,
    plan: "Casual",
    status: "pending",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    trialEnd: null,
    card: null,
    waiver: null,
    scheduledChange: null,
    ...change,
  };
}

function sessionsDouble(): CheckoutSessions & {
  readonly create: ReturnType<typeof vi.fn<CheckoutSessions["create"]>>;
} {
  return {
    create: vi.fn<CheckoutSessions["create"]>(async () => ({
      url: CHECKOUT_URL,
    })),
  };
}

type SessionsDouble = ReturnType<typeof sessionsDouble>;

function gateways(
  record: MembershipRecord | null,
  sessions: SessionsDouble = sessionsDouble(),
): SessionPackCheckoutGateways {
  return {
    membership: { findByUserId: async () => record },
    memberEmails: { findEmail: async () => EMAIL },
    packSizes: { findPackSizes: async () => OFFERED_SIZES },
    stripe: {
      kind: "configured",
      casualSessionPrice: CASUAL_SESSION_PRICE,
      sessions,
    },
  };
}

function buy(
  target: SessionPackCheckoutGateways,
  sessions = 5,
): ReturnType<typeof startSessionPackCheckout> {
  return startSessionPackCheckout(target, {
    userId: USER_ID,
    origin: ORIGIN,
    now: NOW,
    sessions,
  });
}

describe("startSessionPackCheckout", () => {
  it("pide un pago de tantas sesiones Casual como trae el pack, con el socio y el pack en los metadatos", async () => {
    const sessions = sessionsDouble();

    const outcome = await buy(gateways(membership(), sessions), 10);

    expect(outcome).toEqual({ kind: "created", url: CHECKOUT_URL });
    expect(sessions.create).toHaveBeenCalledWith(
      {
        mode: "payment",
        line_items: [{ price: CASUAL_SESSION_PRICE, quantity: 10 }],
        client_reference_id: USER_ID,
        customer_email: EMAIL,
        metadata: {
          user_id: USER_ID,
          kind: "session_pack",
          pack_sessions: "10",
        },
        success_url: `${ORIGIN}/pagos?pack=ok`,
        cancel_url: `${ORIGIN}/pagos?pack=cancelado`,
      },
      { idempotencyKey: expect.any(String) },
    );
  });

  it("reutiliza el cliente de Stripe que ya tiene en vez de mandar el correo", async () => {
    const sessions = sessionsDouble();

    await buy(gateways(membership({ stripeCustomerId: "cus_Alba" }), sessions));

    const [params] = sessions.create.mock.calls[0] ?? [];
    expect(params?.customer).toBe("cus_Alba");
    expect(params).not.toHaveProperty("customer_email");
  });

  it("deja comprar otro pack a un Casual que ya está al día", async () => {
    const outcome = await buy(gateways(membership({ status: "active" })));

    expect(outcome.kind).toBe("created");
  });

  it("abre otra sesión para otro tamaño aunque sea en la misma ventana", async () => {
    const sessions = sessionsDouble();
    const target = gateways(membership(), sessions);

    await buy(target, 5);
    await buy(target, 10);

    const [, first] = sessions.create.mock.calls[0] ?? [];
    const [, second] = sessions.create.mock.calls[1] ?? [];
    expect(first?.idempotencyKey).not.toBe(second?.idempotencyKey);
  });

  it("rechaza un tamaño que el club no ofrece sin pedir nada a Stripe", async () => {
    const sessions = sessionsDouble();

    const outcome = await buy(gateways(membership(), sessions), 7);

    expect(outcome).toEqual({ kind: "refused", reason: "pack_not_offered" });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it.each(["Full", "Student"] as const)(
    "rechaza a un socio %s: los packs son de Casual",
    async (plan) => {
      const sessions = sessionsDouble();

      const outcome = await buy(gateways(membership({ plan }), sessions));

      expect(outcome).toEqual({ kind: "refused", reason: "not_casual" });
      expect(sessions.create).not.toHaveBeenCalled();
    },
  );

  it("rechaza a quien no tiene membresía", async () => {
    const outcome = await buy(gateways(null));

    expect(outcome).toEqual({ kind: "refused", reason: "not_casual" });
  });

  it("dice que Stripe no está configurado sin leer la membresía", async () => {
    const findByUserId = vi.fn();

    const outcome = await startSessionPackCheckout(
      {
        membership: { findByUserId },
        memberEmails: { findEmail: async () => EMAIL },
        packSizes: { findPackSizes: async () => OFFERED_SIZES },
        stripe: { kind: "unconfigured" },
      },
      { userId: USER_ID, origin: ORIGIN, now: NOW, sessions: 5 },
    );

    expect(outcome).toEqual({
      kind: "refused",
      reason: "stripe_not_configured",
    });
    expect(findByUserId).not.toHaveBeenCalled();
  });

  it("lanza si Stripe devuelve una sesión sin dirección", async () => {
    const sessions = sessionsDouble();
    sessions.create.mockResolvedValue({ url: null });

    await expect(buy(gateways(membership(), sessions))).rejects.toThrow(
      /dirección/,
    );
  });
});
