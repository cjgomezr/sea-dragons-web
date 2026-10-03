import { describe, expect, it } from "vitest";
import type {
  MembershipGateway,
  MembershipRecord,
} from "@/lib/membership/membership";
import {
  type PaymentHistoryGateway,
  type PaymentRecord,
  readMembershipView,
} from "@/lib/membership/membership-view";

/**
 * Lo que el panel de membresía (#455, RF-5 y RF-7 del PRD de E12) recibe de
 * `GET /api/v1/membership`: el plan con su precio, el estado, el próximo
 * cobro, la tarjeta, la exención y el historial, según el estado y el plan.
 */

const NOW = new Date("2026-10-01T09:00:00Z");
const USER_ID = "8d0c4c3e-7a9f-4a52-9c0b-2f8f3d1e6a11";
const PERIOD_END = "2026-11-01T09:00:00.000Z";
const TRIAL_END = "2026-10-20T09:00:00.000Z";
const WAIVED_UNTIL = "2027-01-31T13:00:00.000Z";
const VISA = { brand: "visa", last4: "4242", expMonth: 8, expYear: 2028 };

function aRecord(overrides: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    userId: USER_ID,
    clubId: "c1",
    plan: "Full",
    status: "active",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
    currentPeriodEnd: new Date(PERIOD_END),
    trialEnd: null,
    card: VISA,
    waiver: null,
    scheduledChange: null,
    ...overrides,
  };
}

function aPayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: "pay-1",
    amountCents: 4500,
    description: "Monthly membership",
    status: "paid",
    paidAt: new Date("2026-09-01T09:00:00Z"),
    createdAt: new Date("2026-09-01T08:59:00Z"),
    ...overrides,
  };
}

function gateways(
  record: MembershipRecord | null,
  payments: readonly PaymentRecord[] = [],
): {
  readonly membership: MembershipGateway;
  readonly payments: PaymentHistoryGateway;
} {
  return {
    membership: { findByUserId: async () => record },
    payments: { listByUserId: async () => payments },
  };
}

async function viewOf(
  record: MembershipRecord | null,
  payments: readonly PaymentRecord[] = [],
): ReturnType<typeof readMembershipView> {
  return readMembershipView(gateways(record, payments), {
    userId: USER_ID,
    now: NOW,
    paymentsConfigured: true,
  });
}

describe("readMembershipView: la membresía", () => {
  it("sirve plan, precio mensual, próximo cobro al fin del periodo y la tarjeta de quien está activo", async () => {
    const view = await viewOf(aRecord());

    expect(view.membership).toEqual({
      plan: "Full",
      status: "active",
      monthlyPriceCents: 4500,
      trialEnd: null,
      nextChargeAt: PERIOD_END,
      card: VISA,
      waiver: null,
      scheduledChange: null,
      canChangePlan: true,
    });
  });

  it("pone el próximo cobro al fin de la prueba de quien está en prueba", async () => {
    const view = await viewOf(
      aRecord({
        plan: "Student",
        status: "trialing",
        trialEnd: new Date(TRIAL_END),
      }),
    );

    expect(view.membership).toMatchObject({
      monthlyPriceCents: 3200,
      trialEnd: TRIAL_END,
      nextChargeAt: TRIAL_END,
    });
  });

  it.each(["pending", "past_due", "cancelled"] as const)(
    "no promete próximo cobro a una membresía %s",
    async (status) => {
      const view = await viewOf(aRecord({ status }));

      expect(view.membership?.nextChargeAt).toBeNull();
    },
  );

  it("no da precio mensual ni próximo cobro a un Casual", async () => {
    const view = await viewOf(aRecord({ plan: "Casual", status: "active" }));

    expect(view.membership).toMatchObject({
      plan: "Casual",
      monthlyPriceCents: null,
      nextChargeAt: null,
    });
  });

  it("sirve el motivo y el fin de una exención vigente, sin próximo cobro", async () => {
    const view = await viewOf(
      aRecord({
        status: "waived",
        waiver: {
          reason: "Entrenador",
          until: new Date(WAIVED_UNTIL),
          waivedBy: null,
        },
      }),
    );

    expect(view.membership).toMatchObject({
      status: "waived",
      nextChargeAt: null,
      waiver: { reason: "Entrenador", until: WAIVED_UNTIL },
    });
  });

  it("no sirve una exención vencida, que ya vale lo que digan sus fechas", async () => {
    const view = await viewOf(
      aRecord({
        status: "waived",
        waiver: {
          reason: "Entrenador",
          until: new Date("2026-09-01T00:00:00Z"),
          waivedBy: null,
        },
      }),
    );

    expect(view.membership).toMatchObject({ status: "active", waiver: null });
  });

  it("sirve una membresía nula y un historial vacío a quien no tiene", async () => {
    const view = await viewOf(null);

    expect(view).toEqual({
      paymentsConfigured: true,
      membership: null,
      payments: [],
    });
  });
});

describe("readMembershipView: el cambio de plan (#456)", () => {
  it("sirve el cambio programado con su plan y su fecha", async () => {
    const view = await viewOf(
      aRecord({
        scheduledChange: { plan: "Student", effectiveAt: new Date(PERIOD_END) },
      }),
    );

    expect(view.membership).toMatchObject({
      scheduledChange: { plan: "Student", effectiveAt: PERIOD_END },
      nextChargeAt: PERIOD_END,
    });
  });

  it("sin próximo cobro cuando lo programado es pasar a Casual", async () => {
    const view = await viewOf(
      aRecord({
        scheduledChange: { plan: "Casual", effectiveAt: new Date(PERIOD_END) },
      }),
    );

    expect(view.membership).toMatchObject({
      scheduledChange: { plan: "Casual", effectiveAt: PERIOD_END },
      nextChargeAt: null,
    });
  });

  it.each([
    ["un socio con cobro fallido", { status: "past_due" }],
    [
      "un socio exento",
      {
        status: "waived",
        waiver: { reason: "Entrenador", until: null, waivedBy: null },
      },
    ],
    ["un socio sin suscripción", { stripeSubscriptionId: null }],
  ] as const)("no ofrece el cambio a %s", async (_who, change) => {
    const view = await viewOf(aRecord(change));

    expect(view.membership?.canChangePlan).toBe(false);
  });

  it("ofrece el cambio a un Casual, que va a Checkout", async () => {
    const view = await viewOf(
      aRecord({ plan: "Casual", status: "pending", stripeSubscriptionId: null }),
    );

    expect(view.membership?.canChangePlan).toBe(true);
  });

  it("no lo ofrece si los pagos no están configurados", async () => {
    const view = await readMembershipView(gateways(aRecord()), {
      userId: USER_ID,
      now: NOW,
      paymentsConfigured: false,
    });

    expect(view.membership?.canChangePlan).toBe(false);
  });
});

describe("readMembershipView: el historial", () => {
  it("sirve cada pago con su fecha de cobro, descripción, importe en centavos y estado", async () => {
    const view = await viewOf(aRecord(), [aPayment()]);

    expect(view.payments).toEqual([
      {
        id: "pay-1",
        date: "2026-09-01T09:00:00.000Z",
        description: "Monthly membership",
        amountCents: 4500,
        status: "paid",
      },
    ]);
  });

  it("fecha un pago sin cobrar por cuándo se registró", async () => {
    const view = await viewOf(aRecord(), [
      aPayment({
        status: "failed",
        paidAt: null,
        createdAt: new Date("2026-09-02T00:00:00Z"),
      }),
    ]);

    expect(view.payments[0]?.date).toBe("2026-09-02T00:00:00.000Z");
  });

  it("ordena del más reciente al más antiguo", async () => {
    const view = await viewOf(aRecord(), [
      aPayment({ id: "agosto", paidAt: new Date("2026-08-01T09:00:00Z") }),
      aPayment({
        id: "fallido",
        status: "failed",
        paidAt: null,
        createdAt: new Date("2026-09-15T09:00:00Z"),
      }),
      aPayment({ id: "septiembre", paidAt: new Date("2026-09-01T09:00:00Z") }),
    ]);

    expect(view.payments.map((payment) => payment.id)).toEqual([
      "fallido",
      "septiembre",
      "agosto",
    ]);
  });
});
