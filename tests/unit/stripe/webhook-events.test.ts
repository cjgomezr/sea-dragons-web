// @vitest-environment node
import { describe, expect, it } from "vitest";
import type {
  MembershipCard,
  MembershipRecord,
} from "@/lib/membership/membership";
import {
  type StripeEventFacts,
  type StripeEventWrites,
  type StripeMembership,
  planStripeEventWrites,
  readStripeEventFacts,
} from "@/lib/stripe/webhook-events";
import {
  FIXTURE_CUSTOMER_ID,
  FIXTURE_PRICES,
  FIXTURE_SUBSCRIPTION_ID,
  FIXTURE_USER_ID,
  stripeEvent,
} from "../../fixtures/stripe/stripe-events";

/**
 * La máquina de estados de los webhooks de Stripe (#452, RF-7 y RF-8 del PRD
 * de E12), evento por evento y sin red: qué dice cada evento y qué se escribe
 * con él sobre la membresía que ya hay.
 */

const NOW = new Date("2026-10-02T00:00:00Z");
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";
const VISA: MembershipCard = {
  brand: "visa",
  last4: "4242",
  expMonth: 12,
  expYear: 2030,
};

function secondsToDate(seconds: number): Date {
  return new Date(seconds * 1000);
}

function pendingRecord(
  change: Partial<MembershipRecord> = {},
): MembershipRecord {
  return {
    userId: FIXTURE_USER_ID,
    clubId: CLUB_ID,
    plan: "Full",
    status: "pending",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    trialEnd: null,
    card: null,
    waiver: null,
    ...change,
  };
}

function membership(
  change: Partial<MembershipRecord> = {},
  lastStripeEventAt: Date | null = null,
): StripeMembership {
  return { record: pendingRecord(change), lastStripeEventAt };
}

function appliedFacts(
  facts: StripeEventFacts,
): Exclude<StripeEventFacts, { kind: "ignored" }> {
  if (facts.kind === "ignored") {
    throw new Error("El evento de ejemplo debería aplicarse.");
  }
  return facts;
}

function plan(
  event: ReturnType<typeof stripeEvent>,
  input: {
    readonly membership?: StripeMembership;
    readonly card?: MembershipCard | null;
  } = {},
): StripeEventWrites {
  return planStripeEventWrites({
    facts: appliedFacts(readStripeEventFacts(event)),
    membership: input.membership ?? membership(),
    card: input.card ?? null,
    prices: FIXTURE_PRICES,
    now: NOW,
  });
}

describe("qué dice cada evento", () => {
  it("ignora cualquier tipo de evento que no mueve la membresía", () => {
    const event = stripeEvent("checkout.session.completed", {
      type: "customer.created",
    });

    expect(readStripeEventFacts(event)).toEqual({ kind: "ignored" });
  });

  it("ignora un Checkout que no es de suscripción", () => {
    const event = stripeEvent("checkout.session.completed", {
      object: { mode: "payment" },
    });

    expect(readStripeEventFacts(event)).toEqual({ kind: "ignored" });
  });

  it("busca la membresía de un Checkout por el socio que lo abrió", () => {
    const facts = readStripeEventFacts(
      stripeEvent("checkout.session.completed"),
    );

    expect(facts).toMatchObject({
      kind: "checkoutCompleted",
      lookup: {
        userId: FIXTURE_USER_ID,
        customerId: FIXTURE_CUSTOMER_ID,
        subscriptionId: FIXTURE_SUBSCRIPTION_ID,
      },
    });
  });

  it("busca la membresía de una suscripción por su id, su cliente y el socio de sus metadatos", () => {
    const facts = readStripeEventFacts(
      stripeEvent("customer.subscription.updated"),
    );

    expect(facts).toMatchObject({
      lookup: {
        userId: FIXTURE_USER_ID,
        customerId: FIXTURE_CUSTOMER_ID,
        subscriptionId: FIXTURE_SUBSCRIPTION_ID,
      },
    });
  });

  it("no usa como socio unos metadatos que no son un id", () => {
    const facts = readStripeEventFacts(
      stripeEvent("customer.subscription.updated", {
        object: { metadata: { user_id: "'; drop table members; --" } },
      }),
    );

    expect(facts).toMatchObject({ lookup: { userId: null } });
  });

  it("busca la membresía de una factura por su cliente y su suscripción", () => {
    const facts = readStripeEventFacts(stripeEvent("invoice.paid"));

    expect(facts).toMatchObject({
      kind: "invoiceSettled",
      lookup: {
        userId: FIXTURE_USER_ID,
        customerId: FIXTURE_CUSTOMER_ID,
        subscriptionId: FIXTURE_SUBSCRIPTION_ID,
      },
    });
  });

  it("deja para después el método de pago que llega como id", () => {
    const facts = readStripeEventFacts(
      stripeEvent("customer.subscription.updated", {
        object: { default_payment_method: "pm_SoloElId" },
      }),
    );

    expect(facts).toMatchObject({
      paymentMethod: { kind: "id", id: "pm_SoloElId" },
    });
  });
});

describe("checkout.session.completed", () => {
  it("guarda el cliente y la suscripción de Stripe en la membresía del socio", () => {
    const writes = plan(stripeEvent("checkout.session.completed"));

    expect(writes.membership).toEqual({
      stripeCustomerId: FIXTURE_CUSTOMER_ID,
      stripeSubscriptionId: FIXTURE_SUBSCRIPTION_ID,
    });
    expect(writes.payment).toBeNull();
  });

  it("no mueve el estado: lo mueve la suscripción", () => {
    const writes = plan(stripeEvent("checkout.session.completed"));

    expect(writes.membership).not.toHaveProperty("status");
  });
});

describe("customer.subscription.created y customer.subscription.updated", () => {
  it.each(["customer.subscription.created", "customer.subscription.updated"])(
    "%s guarda el estado, las fechas, el plan, la tarjeta y cuándo pasó",
    (type) => {
      const event = stripeEvent("customer.subscription.updated", { type });

      const writes = plan(event, { card: VISA });

      expect(writes.membership).toEqual({
        status: "trialing",
        plan: "Full",
        stripeCustomerId: FIXTURE_CUSTOMER_ID,
        stripeSubscriptionId: FIXTURE_SUBSCRIPTION_ID,
        trialEnd: secondsToDate(1792592000),
        currentPeriodEnd: secondsToDate(1792592000),
        card: VISA,
        stripeEventAt: secondsToDate(event.created),
      });
      expect(writes.payment).toBeNull();
    },
  );

  it.each([
    ["trialing", "trialing"],
    ["active", "active"],
    ["past_due", "past_due"],
    ["canceled", "cancelled"],
    ["unpaid", "cancelled"],
    ["incomplete_expired", "cancelled"],
  ])("el estado %s de Stripe queda como %s", (stripeStatus, expected) => {
    const writes = plan(
      stripeEvent("customer.subscription.updated", {
        object: { status: stripeStatus },
      }),
    );

    expect(writes.membership?.status).toBe(expected);
  });

  it("un estado de Stripe sin equivalente deja el estado como está y lo anota", () => {
    const writes = plan(
      stripeEvent("customer.subscription.updated", {
        object: { status: "paused" },
      }),
    );

    expect(writes.membership).not.toHaveProperty("status");
    expect(writes.warnings).toEqual([expect.stringContaining("paused")]);
  });

  it("reconoce el plan Student por su precio", () => {
    const writes = plan(
      stripeEvent("customer.subscription.updated", {
        object: {
          items: {
            object: "list",
            data: [
              {
                id: "si_Student",
                object: "subscription_item",
                current_period_end: 1792592000,
                price: { id: FIXTURE_PRICES.student, object: "price" },
              },
            ],
          },
        },
      }),
    );

    expect(writes.membership?.plan).toBe("Student");
  });

  it("un precio que no es de ningún plan deja el plan como está y lo anota", () => {
    const writes = plan(
      stripeEvent("customer.subscription.updated", {
        object: {
          items: {
            object: "list",
            data: [
              {
                id: "si_Otro",
                object: "subscription_item",
                current_period_end: 1792592000,
                price: { id: "price_desconocido", object: "price" },
              },
            ],
          },
        },
      }),
    );

    expect(writes.membership).not.toHaveProperty("plan");
    expect(writes.warnings).toEqual([
      expect.stringContaining("price_desconocido"),
    ]);
  });

  it("toma la tarjeta del método de pago que viene en la suscripción", () => {
    const facts = readStripeEventFacts(
      stripeEvent("customer.subscription.updated"),
    );

    expect(facts).toMatchObject({
      paymentMethod: { kind: "card", card: VISA },
    });
  });

  it("sin tarjeta conocida no toca la que hay", () => {
    const writes = plan(stripeEvent("customer.subscription.updated"), {
      card: null,
    });

    expect(writes.membership).not.toHaveProperty("card");
  });

  it("una suscripción activa sin prueba deja la prueba vacía", () => {
    const writes = plan(
      stripeEvent("customer.subscription.updated", {
        object: { status: "active", trial_end: null },
      }),
    );

    expect(writes.membership?.trialEnd).toBeNull();
  });
});

describe("customer.subscription.deleted", () => {
  it("cancela la membresía y la deja sin suscripción", () => {
    const event = stripeEvent("customer.subscription.deleted");

    const writes = plan(event, {
      membership: membership({
        status: "active",
        stripeCustomerId: FIXTURE_CUSTOMER_ID,
        stripeSubscriptionId: FIXTURE_SUBSCRIPTION_ID,
      }),
    });

    expect(writes.membership).toEqual({
      status: "cancelled",
      stripeSubscriptionId: null,
      stripeEventAt: secondsToDate(event.created),
    });
  });
});

describe("invoice.paid e invoice.payment_failed", () => {
  it("invoice.paid guarda un pago pagado con importe, moneda, concepto y fecha", () => {
    const writes = plan(stripeEvent("invoice.paid"));

    expect(writes.payment).toEqual({
      invoiceId: "in_TestSeadragons",
      amountCents: 4500,
      currency: "aud",
      description: "1 × Full membership (at $45.00 / month)",
      status: "paid",
      paidAt: secondsToDate(1792592090),
    });
    expect(writes.membership).toBeNull();
  });

  it("prefiere la descripción de la factura a la de su primera línea", () => {
    const writes = plan(
      stripeEvent("invoice.paid", {
        object: { description: "Cuota de octubre" },
      }),
    );

    expect(writes.payment?.description).toBe("Cuota de octubre");
  });

  it("invoice.payment_failed guarda el pago fallido con lo que se intentó cobrar y no toca el estado", () => {
    const writes = plan(stripeEvent("invoice.payment_failed"), {
      membership: membership({ status: "active" }),
    });

    expect(writes.payment).toEqual({
      invoiceId: "in_TestSeadragonsFailed",
      amountCents: 3200,
      currency: "aud",
      description: "1 × Student membership (at $32.00 / month)",
      status: "failed",
      paidAt: null,
    });
    expect(writes.membership).toBeNull();
  });
});

describe("eventos fuera de orden", () => {
  const LATER = secondsToDate(1799999999);

  it("una suscripción más vieja que lo último aplicado no retrocede la membresía", () => {
    const writes = plan(stripeEvent("customer.subscription.updated"), {
      membership: membership({ status: "cancelled" }, LATER),
    });

    expect(writes.membership).toBeNull();
  });

  it("un Checkout más viejo que lo último aplicado no devuelve la suscripción", () => {
    const writes = plan(stripeEvent("checkout.session.completed"), {
      membership: membership({ status: "cancelled" }, LATER),
    });

    expect(writes.membership).toBeNull();
  });

  it("un pago viejo sí entra en el historial", () => {
    const writes = plan(stripeEvent("invoice.paid"), {
      membership: membership({ status: "active" }, LATER),
    });

    expect(writes.payment?.invoiceId).toBe("in_TestSeadragons");
  });

  it("un evento del mismo segundo que lo último aplicado sí se aplica", () => {
    const event = stripeEvent("customer.subscription.updated");

    const writes = plan(event, {
      membership: membership({}, secondsToDate(event.created)),
    });

    expect(writes.membership?.status).toBe("trialing");
  });
});

describe("una membresía exenta", () => {
  const WAIVER = {
    reason: "Entrenador",
    until: null,
    waivedBy: null,
  } as const;

  it("guarda los datos de Stripe pero sigue exenta mientras la exención esté vigente", () => {
    const writes = plan(stripeEvent("customer.subscription.updated"), {
      membership: membership({ status: "waived", waiver: WAIVER }),
      card: VISA,
    });

    expect(writes.membership).not.toHaveProperty("status");
    expect(writes.membership).toMatchObject({
      stripeSubscriptionId: FIXTURE_SUBSCRIPTION_ID,
      card: VISA,
    });
  });

  it("sigue exenta aunque Stripe borre la suscripción", () => {
    const writes = plan(stripeEvent("customer.subscription.deleted"), {
      membership: membership({ status: "waived", waiver: WAIVER }),
    });

    expect(writes.membership).toEqual({
      stripeSubscriptionId: null,
      stripeEventAt: expect.any(Date),
    });
  });

  it("con la exención vencida, el estado vuelve a seguir a Stripe", () => {
    const writes = plan(stripeEvent("customer.subscription.updated"), {
      membership: membership({
        status: "waived",
        waiver: { ...WAIVER, until: new Date("2026-01-01T00:00:00Z") },
      }),
    });

    expect(writes.membership?.status).toBe("trialing");
  });
});
