// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  type CheckoutGateways,
  type CheckoutSessions,
  IDEMPOTENCY_WINDOW_MS,
  startCheckout,
} from "@/lib/membership/checkout";
import type {
  MembershipRecord,
  MembershipStatus,
} from "@/lib/membership/membership";

/**
 * El alta en Stripe Checkout (#454, RF-3 del PRD de E12, D3). El cliente de
 * Stripe va doblado: lo que se prueba son los parámetros con los que se le
 * pide la sesión y cuándo no se le pide ninguna.
 */

const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";
const EMAIL = "alba@example.com";
const ORIGIN = "https://seadragons.example";
const NOW = new Date("2026-10-02T09:00:00.000Z");
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_123";
const PRICES = { full: "price_full_test", student: "price_student_test" };

function membership(change: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    userId: USER_ID,
    clubId: CLUB_ID,
    plan: "Full",
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

/** Lo que se le pidió a Stripe en la llamada `index`. */
function requestedSession(
  sessions: SessionsDouble,
  index: number,
): Parameters<CheckoutSessions["create"]> {
  const call = sessions.create.mock.calls[index];
  if (call === undefined) {
    throw new Error(`No se pidió la sesión número ${index + 1}.`);
  }
  return call;
}

function gateways(
  record: MembershipRecord | null,
  sessions = sessionsDouble(),
): CheckoutGateways {
  return {
    membership: { findByUserId: async () => record },
    memberEmails: { findEmail: async () => EMAIL },
    stripe: { kind: "configured", prices: PRICES, sessions },
  };
}

function start(
  target: CheckoutGateways,
  now = NOW,
): ReturnType<typeof startCheckout> {
  return startCheckout(target, { userId: USER_ID, origin: ORIGIN, now });
}

describe("startCheckout", () => {
  it("pide una sesión de suscripción con un mes de prueba y tarjeta obligatoria para un Full", async () => {
    const sessions = sessionsDouble();

    const outcome = await start(gateways(membership(), sessions));

    expect(outcome).toEqual({ kind: "created", url: CHECKOUT_URL });
    expect(sessions.create).toHaveBeenCalledWith(
      {
        mode: "subscription",
        line_items: [{ price: PRICES.full, quantity: 1 }],
        payment_method_collection: "always",
        client_reference_id: USER_ID,
        customer_email: EMAIL,
        subscription_data: {
          trial_period_days: 30,
          metadata: { user_id: USER_ID },
        },
        success_url: `${ORIGIN}/pagos?checkout=ok`,
        cancel_url: `${ORIGIN}/pagos?checkout=cancelado`,
      },
      { idempotencyKey: expect.any(String) },
    );
  });

  it("usa el precio de Student para un Student", async () => {
    const sessions = sessionsDouble();

    await start(gateways(membership({ plan: "Student" }), sessions));

    expect(sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: PRICES.student, quantity: 1 }],
      }),
      expect.anything(),
    );
  });

  it("reutiliza el cliente de Stripe que ya tiene en vez de mandar el correo", async () => {
    const sessions = sessionsDouble();

    await start(
      gateways(membership({ stripeCustomerId: "cus_Alba" }), sessions),
    );

    const [params] = requestedSession(sessions, 0);
    expect(params.customer).toBe("cus_Alba");
    expect(params).not.toHaveProperty("customer_email");
  });

  it("va sin prueba si la membresía ya tuvo un mes de prueba", async () => {
    const sessions = sessionsDouble();

    await start(
      gateways(
        membership({
          status: "cancelled",
          trialEnd: new Date("2026-05-01T00:00:00.000Z"),
        }),
        sessions,
      ),
    );

    const [params] = requestedSession(sessions, 0);
    expect(params.subscription_data).toEqual({
      metadata: { user_id: USER_ID },
    });
  });

  it("deja volver a suscribirse a quien canceló", async () => {
    const outcome = await start(gateways(membership({ status: "cancelled" })));

    expect(outcome.kind).toBe("created");
  });

  it("pide la misma sesión a Stripe ante un doble toque", async () => {
    const sessions = sessionsDouble();
    const target = gateways(membership(), sessions);

    await start(target);
    await start(target, new Date(NOW.getTime() + 800));

    const [, first] = requestedSession(sessions, 0);
    const [, second] = requestedSession(sessions, 1);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
  });

  it("abre otra sesión pasada la ventana de idempotencia", async () => {
    const sessions = sessionsDouble();
    const target = gateways(membership(), sessions);

    await start(target);
    await start(target, new Date(NOW.getTime() + IDEMPOTENCY_WINDOW_MS));

    const [, first] = requestedSession(sessions, 0);
    const [, second] = requestedSession(sessions, 1);
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it("no reutiliza la sesión si cambió lo que se pide", async () => {
    const sessions = sessionsDouble();

    await start(gateways(membership(), sessions));
    await start(gateways(membership({ plan: "Student" }), sessions));

    const [, first] = requestedSession(sessions, 0);
    const [, second] = requestedSession(sessions, 1);
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it("rechaza a un Casual sin pedir nada a Stripe", async () => {
    const sessions = sessionsDouble();

    const outcome = await start(
      gateways(membership({ plan: "Casual" }), sessions),
    );

    expect(outcome).toEqual({ kind: "refused", reason: "casual_plan" });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it.each<MembershipStatus>(["trialing", "active"])(
    "rechaza a quien ya está al día (%s)",
    async (status) => {
      const sessions = sessionsDouble();

      const outcome = await start(gateways(membership({ status }), sessions));

      expect(outcome).toEqual({
        kind: "refused",
        reason: "membership_current",
      });
      expect(sessions.create).not.toHaveBeenCalled();
    },
  );

  it("rechaza a un exento vigente", async () => {
    const outcome = await start(
      gateways(
        membership({
          status: "waived",
          waiver: { reason: "Entrenador", until: null, waivedBy: null },
        }),
      ),
    );

    expect(outcome).toEqual({ kind: "refused", reason: "membership_current" });
  });

  it("rechaza a quien tiene un cobro fallido: su suscripción sigue viva", async () => {
    const outcome = await start(gateways(membership({ status: "past_due" })));

    expect(outcome).toEqual({ kind: "refused", reason: "payment_past_due" });
  });

  it("rechaza a quien no tiene membresía", async () => {
    const outcome = await start(gateways(null));

    expect(outcome).toEqual({ kind: "refused", reason: "no_plan" });
  });

  it("rechaza a quien tiene membresía sin plan", async () => {
    const outcome = await start(gateways(membership({ plan: null })));

    expect(outcome).toEqual({ kind: "refused", reason: "no_plan" });
  });

  it("dice que Stripe no está configurado sin leer la membresía", async () => {
    const findByUserId = vi.fn();

    const outcome = await startCheckout(
      {
        membership: { findByUserId },
        memberEmails: { findEmail: async () => EMAIL },
        stripe: { kind: "unconfigured" },
      },
      { userId: USER_ID, origin: ORIGIN, now: NOW },
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

    await expect(start(gateways(membership(), sessions))).rejects.toThrow(
      /dirección/,
    );
  });
});
