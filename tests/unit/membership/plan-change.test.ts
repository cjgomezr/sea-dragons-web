// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { CheckoutSessions } from "@/lib/membership/checkout";
import type {
  MembershipRecord,
  ScheduledPlanChange,
} from "@/lib/membership/membership";
import {
  type PlanChangeGateways,
  type SubscriptionPlanApi,
  cancelPlanChange,
  requestPlanChange,
} from "@/lib/membership/plan-change";

/**
 * El cambio de plan al siguiente ciclo (#456, RF-6 del PRD de E12, D5). Stripe
 * va doblado: lo que se prueba es qué se le pide, qué se guarda en la
 * membresía y a quién se le niega.
 */

const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";
const ORIGIN = "https://seadragons.example";
const NOW = new Date("2026-10-02T09:00:00.000Z");
const PERIOD_END = new Date("2026-10-28T09:00:00.000Z");
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_456";
const PRICES = { full: "price_full_test", student: "price_student_test" };

function membership(change: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    userId: USER_ID,
    clubId: CLUB_ID,
    plan: "Full",
    status: "active",
    stripeCustomerId: "cus_alba",
    stripeSubscriptionId: "sub_alba",
    currentPeriodEnd: PERIOD_END,
    trialEnd: null,
    card: null,
    waiver: null,
    scheduledChange: null,
    ...change,
  };
}

function subscriptionsDouble(): {
  readonly [Key in keyof SubscriptionPlanApi]: ReturnType<
    typeof vi.fn<SubscriptionPlanApi[Key]>
  >;
} {
  return {
    schedulePriceChange: vi.fn<SubscriptionPlanApi["schedulePriceChange"]>(
      async () => PERIOD_END,
    ),
    cancelPriceChange: vi.fn<SubscriptionPlanApi["cancelPriceChange"]>(
      async () => undefined,
    ),
    cancelAtPeriodEnd: vi.fn<SubscriptionPlanApi["cancelAtPeriodEnd"]>(
      async () => PERIOD_END,
    ),
    resumeSubscription: vi.fn<SubscriptionPlanApi["resumeSubscription"]>(
      async () => undefined,
    ),
  };
}

type Doubles = {
  readonly subscriptions: ReturnType<typeof subscriptionsDouble>;
  readonly sessions: { readonly create: ReturnType<typeof vi.fn> };
  readonly saved: (ScheduledPlanChange | null)[];
  readonly gateways: PlanChangeGateways;
};

function doubles(record: MembershipRecord | null): Doubles {
  const subscriptions = subscriptionsDouble();
  const sessions = {
    create: vi.fn<CheckoutSessions["create"]>(async () => ({
      url: CHECKOUT_URL,
    })),
  };
  const saved: (ScheduledPlanChange | null)[] = [];
  return {
    subscriptions,
    sessions,
    saved,
    gateways: {
      membership: { findByUserId: async () => record },
      scheduledChanges: {
        async saveScheduledChange(_userId, change) {
          saved.push(change);
        },
      },
      memberEmails: { findEmail: async () => "alba@example.com" },
      stripe: { kind: "configured", prices: PRICES, subscriptions, sessions },
    },
  };
}

function request(plan: "Full" | "Student" | "Casual") {
  return { userId: USER_ID, plan, origin: ORIGIN, now: NOW };
}

describe("programar un cambio de plan", () => {
  it("programa en Stripe el precio de Student para el fin del periodo y lo guarda", async () => {
    const { gateways, subscriptions, saved } = doubles(membership());

    const outcome = await requestPlanChange(gateways, request("Student"));

    expect(subscriptions.schedulePriceChange).toHaveBeenCalledWith({
      subscriptionId: "sub_alba",
      priceId: PRICES.student,
    });
    const change = { plan: "Student", effectiveAt: PERIOD_END };
    expect(outcome).toEqual({ kind: "scheduled", change });
    expect(saved).toEqual([change]);
  });

  it("programa también desde Student a Full durante el mes de prueba", async () => {
    const { gateways, subscriptions } = doubles(
      membership({ plan: "Student", status: "trialing", trialEnd: PERIOD_END }),
    );

    const outcome = await requestPlanChange(gateways, request("Full"));

    expect(subscriptions.schedulePriceChange).toHaveBeenCalledWith({
      subscriptionId: "sub_alba",
      priceId: PRICES.full,
    });
    expect(outcome.kind).toBe("scheduled");
  });

  it("a Casual cancela la suscripción al final del periodo, sin programar precio", async () => {
    const { gateways, subscriptions, saved } = doubles(membership());

    const outcome = await requestPlanChange(gateways, request("Casual"));

    expect(subscriptions.cancelAtPeriodEnd).toHaveBeenCalledWith("sub_alba");
    expect(subscriptions.schedulePriceChange).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: "scheduled",
      change: { plan: "Casual", effectiveAt: PERIOD_END },
    });
    expect(saved).toEqual([{ plan: "Casual", effectiveAt: PERIOD_END }]);
  });

  it("repetir el mismo cambio ya programado no vuelve a pedirlo a Stripe", async () => {
    const scheduled = { plan: "Student", effectiveAt: PERIOD_END } as const;
    const { gateways, subscriptions, saved } = doubles(
      membership({ scheduledChange: scheduled }),
    );

    const outcome = await requestPlanChange(gateways, request("Student"));

    expect(outcome).toEqual({ kind: "scheduled", change: scheduled });
    expect(subscriptions.schedulePriceChange).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it("con otro cambio ya programado, hay que anularlo antes", async () => {
    const { gateways, subscriptions } = doubles(
      membership({
        scheduledChange: { plan: "Casual", effectiveAt: PERIOD_END },
      }),
    );

    const outcome = await requestPlanChange(gateways, request("Student"));

    expect(outcome).toEqual({
      kind: "refused",
      reason: "change_already_scheduled",
    });
    expect(subscriptions.schedulePriceChange).not.toHaveBeenCalled();
  });

  it("no guarda nada si Stripe falla", async () => {
    const { gateways, subscriptions, saved } = doubles(membership());
    subscriptions.schedulePriceChange.mockRejectedValue(new Error("caído"));

    await expect(
      requestPlanChange(gateways, request("Student")),
    ).rejects.toThrow("caído");
    expect(saved).toEqual([]);
  });
});

describe("desde Casual", () => {
  it("lleva a Checkout con el precio del plan elegido, sin prueba si ya tuvo una", async () => {
    const { gateways, sessions, subscriptions } = doubles(
      membership({
        plan: "Casual",
        status: "pending",
        stripeSubscriptionId: null,
        trialEnd: new Date("2026-08-01T00:00:00.000Z"),
      }),
    );

    const outcome = await requestPlanChange(gateways, request("Student"));

    expect(outcome).toEqual({ kind: "checkout", url: CHECKOUT_URL });
    const [params] = sessions.create.mock.calls[0] ?? [];
    expect(params).toMatchObject({
      mode: "subscription",
      line_items: [{ price: PRICES.student, quantity: 1 }],
      customer: "cus_alba",
      subscription_data: { metadata: { user_id: USER_ID } },
    });
    expect(params).not.toHaveProperty("subscription_data.trial_period_days");
    expect(subscriptions.schedulePriceChange).not.toHaveBeenCalled();
  });

  it("con el mes de prueba si nunca lo tuvo", async () => {
    const { gateways, sessions } = doubles(
      membership({
        plan: "Casual",
        status: "pending",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
      }),
    );

    await requestPlanChange(gateways, request("Full"));

    const [params] = sessions.create.mock.calls[0] ?? [];
    expect(params).toMatchObject({
      line_items: [{ price: PRICES.full, quantity: 1 }],
      customer_email: "alba@example.com",
      subscription_data: { trial_period_days: 30 },
    });
  });
});

describe("quién no puede cambiar de plan", () => {
  it.each([
    ["pending", "membership_not_current"],
    ["past_due", "membership_not_current"],
    ["cancelled", "membership_not_current"],
  ] as const)("un socio %s recibe %s", async (status, reason) => {
    const { gateways, subscriptions } = doubles(membership({ status }));

    const outcome = await requestPlanChange(gateways, request("Student"));

    expect(outcome).toEqual({ kind: "refused", reason });
    expect(subscriptions.schedulePriceChange).not.toHaveBeenCalled();
  });

  it("un socio exento", async () => {
    const { gateways } = doubles(
      membership({
        status: "waived",
        waiver: { reason: "Entrenador", until: null, waivedBy: null },
      }),
    );

    await expect(
      requestPlanChange(gateways, request("Student")),
    ).resolves.toEqual({ kind: "refused", reason: "membership_waived" });
  });

  it("un Casual exento tampoco va a Checkout", async () => {
    const { gateways, sessions } = doubles(
      membership({
        plan: "Casual",
        status: "waived",
        stripeSubscriptionId: null,
        waiver: { reason: "Voluntaria", until: null, waivedBy: null },
      }),
    );

    await expect(requestPlanChange(gateways, request("Full"))).resolves.toEqual(
      { kind: "refused", reason: "membership_waived" },
    );
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it("un socio al día sin suscripción", async () => {
    const { gateways } = doubles(membership({ stripeSubscriptionId: null }));

    await expect(
      requestPlanChange(gateways, request("Student")),
    ).resolves.toEqual({ kind: "refused", reason: "no_subscription" });
  });

  it("quien pide el plan que ya tiene", async () => {
    const { gateways } = doubles(membership());

    await expect(requestPlanChange(gateways, request("Full"))).resolves.toEqual(
      { kind: "refused", reason: "same_plan" },
    );
  });

  it("quien no tiene membresía o no eligió plan", async () => {
    const withoutMembership = doubles(null);
    const withoutPlan = doubles(membership({ plan: null }));

    await expect(
      requestPlanChange(withoutMembership.gateways, request("Student")),
    ).resolves.toEqual({ kind: "refused", reason: "no_plan" });
    await expect(
      requestPlanChange(withoutPlan.gateways, request("Student")),
    ).resolves.toEqual({ kind: "refused", reason: "no_plan" });
  });

  it("sin configuración de Stripe no se pide nada", async () => {
    const { gateways } = doubles(membership());

    const outcome = await requestPlanChange(
      { ...gateways, stripe: { kind: "unconfigured" } },
      request("Student"),
    );

    expect(outcome).toEqual({
      kind: "refused",
      reason: "stripe_not_configured",
    });
  });
});

describe("anular el cambio programado", () => {
  it("anula en Stripe el precio programado y lo borra de la membresía", async () => {
    const { gateways, subscriptions, saved } = doubles(
      membership({
        scheduledChange: { plan: "Student", effectiveAt: PERIOD_END },
      }),
    );

    const outcome = await cancelPlanChange(gateways, {
      userId: USER_ID,
      now: NOW,
    });

    expect(outcome).toEqual({ kind: "cancelled" });
    expect(subscriptions.cancelPriceChange).toHaveBeenCalledWith("sub_alba");
    expect(subscriptions.resumeSubscription).not.toHaveBeenCalled();
    expect(saved).toEqual([null]);
  });

  it("anular el paso a Casual mantiene la suscripción", async () => {
    const { gateways, subscriptions, saved } = doubles(
      membership({
        scheduledChange: { plan: "Casual", effectiveAt: PERIOD_END },
      }),
    );

    await cancelPlanChange(gateways, { userId: USER_ID, now: NOW });

    expect(subscriptions.resumeSubscription).toHaveBeenCalledWith("sub_alba");
    expect(subscriptions.cancelPriceChange).not.toHaveBeenCalled();
    expect(saved).toEqual([null]);
  });

  it("sin cambio programado no hay nada que anular", async () => {
    const { gateways, subscriptions } = doubles(membership());

    const outcome = await cancelPlanChange(gateways, {
      userId: USER_ID,
      now: NOW,
    });

    expect(outcome).toEqual({ kind: "refused", reason: "no_scheduled_change" });
    expect(subscriptions.cancelPriceChange).not.toHaveBeenCalled();
  });

  it("sin configuración de Stripe no se anula nada", async () => {
    const { gateways, saved } = doubles(
      membership({
        scheduledChange: { plan: "Student", effectiveAt: PERIOD_END },
      }),
    );

    const outcome = await cancelPlanChange(
      { ...gateways, stripe: { kind: "unconfigured" } },
      { userId: USER_ID, now: NOW },
    );

    expect(outcome).toEqual({
      kind: "refused",
      reason: "stripe_not_configured",
    });
    expect(saved).toEqual([]);
  });
});
