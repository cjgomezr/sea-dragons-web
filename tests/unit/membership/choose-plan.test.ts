// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  type CheckoutGateways,
  startCheckout,
} from "@/lib/membership/checkout";
import {
  type PlanChoiceGateway,
  canChoosePlan,
  choosePlan,
} from "@/lib/membership/choose-plan";
import {
  type MembershipPlan,
  type MembershipRecord,
  resolveMembership,
} from "@/lib/membership/membership";

/**
 * Elegir el tipo de membresía en Pagos antes del primer pago (#479, D8 del
 * PRD de E12). La base va doblada: lo que se prueba es a quién se le deja
 * guardar el plan y qué se guarda.
 */

const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-04T09:00:00.000Z");
const EXPIRED = new Date("2026-09-30T09:00:00.000Z");

function membership(change: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    userId: USER_ID,
    clubId: CLUB_ID,
    plan: null,
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

type Doubles = {
  readonly savePlanChoice: ReturnType<
    typeof vi.fn<PlanChoiceGateway["savePlanChoice"]>
  >;
  readonly choose: (plan: MembershipPlan) => ReturnType<typeof choosePlan>;
};

function doubles(record: MembershipRecord | null): Doubles {
  const savePlanChoice = vi.fn<PlanChoiceGateway["savePlanChoice"]>(
    async () => true,
  );
  const gateways = {
    membership: { findByUserId: async () => record },
    planChoices: { savePlanChoice },
  };
  return {
    savePlanChoice,
    choose: (plan) => choosePlan(gateways, { userId: USER_ID, plan, now: NOW }),
  };
}

describe("choosePlan", () => {
  it.each(["Full", "Student", "Casual"] as const)(
    "guarda %s en la membresía pending sin plan",
    async (plan) => {
      const { savePlanChoice, choose } = doubles(membership());

      const outcome = await choose(plan);

      expect(outcome).toEqual({ kind: "chosen" });
      expect(savePlanChoice).toHaveBeenCalledWith(USER_ID, plan);
    },
  );

  it("cambia el plan que ya tenía guardado mientras no ha pagado", async () => {
    const { savePlanChoice, choose } = doubles(membership({ plan: "Full" }));

    const outcome = await choose("Casual");

    expect(outcome).toEqual({ kind: "chosen" });
    expect(savePlanChoice).toHaveBeenCalledWith(USER_ID, "Casual");
  });

  it("deja elegir a quien tuvo una exención ya vencida y nunca se suscribió", async () => {
    const { savePlanChoice, choose } = doubles(
      membership({
        status: "waived",
        waiver: { reason: "Entrenadora", until: EXPIRED, waivedBy: null },
      }),
    );

    const outcome = await choose("Full");

    expect(outcome).toEqual({ kind: "chosen" });
    expect(savePlanChoice).toHaveBeenCalledWith(USER_ID, "Full");
  });

  it.each([
    ["trialing", {}],
    ["active", {}],
    ["past_due", {}],
    [
      "waived",
      { waiver: { reason: "Entrenadora", until: null, waivedBy: null } },
    ],
  ] as const)(
    "rechaza a quien está %s y no guarda nada",
    async (status, change) => {
      const { savePlanChoice, choose } = doubles(
        membership({ plan: "Full", status, ...change }),
      );

      const outcome = await choose("Student");

      expect(outcome).toEqual({
        kind: "refused",
        reason: "membership_started",
      });
      expect(savePlanChoice).not.toHaveBeenCalled();
    },
  );

  it("rechaza a quien ya tiene suscripción en Stripe aunque esté cancelado", async () => {
    const { savePlanChoice, choose } = doubles(
      membership({
        plan: "Full",
        status: "cancelled",
        stripeSubscriptionId: "sub_alba",
      }),
    );

    const outcome = await choose("Student");

    expect(outcome).toEqual({ kind: "refused", reason: "membership_started" });
    expect(savePlanChoice).not.toHaveBeenCalled();
  });

  it("rechaza a quien no tiene membresía", async () => {
    const { savePlanChoice, choose } = doubles(null);

    const outcome = await choose("Full");

    expect(outcome).toEqual({ kind: "refused", reason: "no_membership" });
    expect(savePlanChoice).not.toHaveBeenCalled();
  });

  it("rechaza cuando la suscripción llegó entre la lectura y la escritura", async () => {
    const { savePlanChoice, choose } = doubles(membership());
    savePlanChoice.mockResolvedValue(false);

    const outcome = await choose("Full");

    expect(outcome).toEqual({ kind: "refused", reason: "membership_started" });
  });
});

describe("canChoosePlan", () => {
  it("ofrece elegir a quien está pending sin suscripción", () => {
    const pending = resolveMembership(membership({ plan: "Full" }), NOW);

    expect(canChoosePlan(pending)).toBe(true);
  });

  it("no lo ofrece a quien ya está en prueba", () => {
    const trialing = resolveMembership(
      membership({
        plan: "Full",
        status: "trialing",
        stripeSubscriptionId: "sub_alba",
      }),
      NOW,
    );

    expect(canChoosePlan(trialing)).toBe(false);
  });
});

describe("startCheckout sin plan elegido", () => {
  it("se niega a abrir Checkout y no crea ninguna sesión", async () => {
    const create = vi.fn();
    const gateways: CheckoutGateways = {
      membership: { findByUserId: async () => membership() },
      memberEmails: { findEmail: async () => "alba@example.com" },
      stripe: {
        kind: "configured",
        prices: { full: "price_full", student: "price_student" },
        sessions: { create },
      },
    };

    const outcome = await startCheckout(gateways, {
      userId: USER_ID,
      origin: "https://seadragons.example",
      now: NOW,
    });

    expect(outcome).toEqual({ kind: "refused", reason: "no_plan" });
    expect(create).not.toHaveBeenCalled();
  });
});
