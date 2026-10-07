// @vitest-environment node
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import type {
  MembershipCard,
  MembershipRecord,
} from "@/lib/membership/membership";
import {
  type CheckoutCompletedFacts,
  type PlannableStripeEventFacts,
  type RenewalUpcomingFacts,
  type StripeEventFacts,
  type StripeEventWrites,
  type StripeMembership,
  planRenewalNotice,
  planStripeEventWrites,
  readStripeEventFacts,
  subscriptionFactsFromCheckout,
} from "@/lib/stripe/webhook-events";
import {
  FIXTURE_CUSTOMER_ID,
  FIXTURE_LEVY_NAME,
  FIXTURE_LEVY_PAYMENT_INTENT_ID,
  FIXTURE_LEVY_PRODUCT_ID,
  FIXTURE_PACK_SESSIONS,
  FIXTURE_PAYMENT_INTENT_ID,
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
    scheduledChange: null,
    ...change,
  };
}

function membership(
  change: Partial<MembershipRecord> = {},
  lastStripeEventAt: Date | null = null,
): StripeMembership {
  return { record: pendingRecord(change), lastStripeEventAt };
}

function plannableFacts(facts: StripeEventFacts): PlannableStripeEventFacts {
  if (
    facts.kind === "ignored" ||
    facts.kind === "checkoutCompleted" ||
    facts.kind === "renewalUpcoming" ||
    facts.kind === "sessionPackPaid" ||
    facts.kind === "levyPaid"
  ) {
    throw new Error("El evento de ejemplo debería planificarse tal cual.");
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
    facts: plannableFacts(readStripeEventFacts(event)),
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
  /** La suscripción tal como Stripe la devuelve al pedirla, sin los
   * metadatos del socio: el caso en que el Checkout es la única pista. */
  function subscriptionWithoutMetadata(): Stripe.Subscription {
    const event = stripeEvent("customer.subscription.updated", {
      object: { metadata: {} },
    });
    return event.data.object as Stripe.Subscription;
  }

  function checkoutFacts(): CheckoutCompletedFacts {
    const facts = readStripeEventFacts(
      stripeEvent("checkout.session.completed"),
    );
    if (facts.kind !== "checkoutCompleted") {
      throw new Error("El Checkout de ejemplo debería leerse como tal.");
    }
    return facts;
  }

  it("aplica la suscripción que se le pide a Stripe, con el socio del Checkout", () => {
    const checkout = checkoutFacts();

    const facts = subscriptionFactsFromCheckout(
      checkout,
      subscriptionWithoutMetadata(),
    );

    expect(facts).toMatchObject({
      kind: "subscriptionChanged",
      created: checkout.created,
      lookup: {
        userId: FIXTURE_USER_ID,
        customerId: FIXTURE_CUSTOMER_ID,
        subscriptionId: FIXTURE_SUBSCRIPTION_ID,
      },
    });
  });

  it("deja la membresía en prueba con su fin, el plan, la tarjeta y los ids de Stripe", () => {
    const checkout = checkoutFacts();

    const writes = planStripeEventWrites({
      facts: subscriptionFactsFromCheckout(
        checkout,
        subscriptionWithoutMetadata(),
      ),
      membership: membership(),
      card: VISA,
      prices: FIXTURE_PRICES,
      now: NOW,
    });

    expect(writes.membership).toEqual({
      status: "trialing",
      plan: "Full",
      stripeCustomerId: FIXTURE_CUSTOMER_ID,
      stripeSubscriptionId: FIXTURE_SUBSCRIPTION_ID,
      trialEnd: secondsToDate(1792592000),
      currentPeriodEnd: secondsToDate(1792592000),
      card: VISA,
      stripeEventAt: checkout.created,
    });
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

describe("un cambio de plan programado (#456)", () => {
  const PERIOD_END = secondsToDate(1792592000);

  function studentSubscriptionEvent(): ReturnType<typeof stripeEvent> {
    return stripeEvent("customer.subscription.updated", {
      object: {
        status: "active",
        items: {
          object: "list",
          data: [
            {
              id: "si_Student",
              object: "subscription_item",
              current_period_end: 1795270400,
              price: { id: FIXTURE_PRICES.student, object: "price" },
            },
          ],
        },
      },
    });
  }

  it("cuando Stripe aplica el precio programado, deja el plan nuevo y borra el cambio", () => {
    const writes = plan(studentSubscriptionEvent(), {
      membership: membership({
        status: "active",
        scheduledChange: { plan: "Student", effectiveAt: PERIOD_END },
      }),
    });

    expect(writes.membership).toMatchObject({
      plan: "Student",
      scheduledChange: null,
    });
  });

  it("mientras el precio no cambia, el cambio programado sigue", () => {
    const writes = plan(stripeEvent("customer.subscription.updated"), {
      membership: membership({
        status: "active",
        scheduledChange: { plan: "Student", effectiveAt: PERIOD_END },
      }),
    });

    expect(writes.membership).not.toHaveProperty("scheduledChange");
  });

  it("al acabar la suscripción con Casual programado, queda pending como Casual", () => {
    const event = stripeEvent("customer.subscription.deleted");

    const writes = plan(event, {
      membership: membership({
        status: "active",
        stripeSubscriptionId: FIXTURE_SUBSCRIPTION_ID,
        scheduledChange: { plan: "Casual", effectiveAt: PERIOD_END },
      }),
    });

    expect(writes.membership).toEqual({
      status: "pending",
      plan: "Casual",
      stripeSubscriptionId: null,
      scheduledChange: null,
      stripeEventAt: secondsToDate(event.created),
    });
  });

  it("si la suscripción acaba con otro cambio programado, se cancela y el cambio se borra", () => {
    const writes = plan(stripeEvent("customer.subscription.deleted"), {
      membership: membership({
        status: "past_due",
        stripeSubscriptionId: FIXTURE_SUBSCRIPTION_ID,
        scheduledChange: { plan: "Student", effectiveAt: PERIOD_END },
      }),
    });

    expect(writes.membership).toMatchObject({
      status: "cancelled",
      scheduledChange: null,
    });
    expect(writes.membership).not.toHaveProperty("plan");
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
    const checkout = readStripeEventFacts(
      stripeEvent("checkout.session.completed"),
    );
    if (checkout.kind !== "checkoutCompleted") {
      throw new Error("El Checkout de ejemplo debería leerse como tal.");
    }
    const subscription = stripeEvent("customer.subscription.updated").data
      .object as Stripe.Subscription;

    const writes = planStripeEventWrites({
      facts: subscriptionFactsFromCheckout(checkout, subscription),
      membership: membership({ status: "cancelled" }, LATER),
      card: null,
      prices: FIXTURE_PRICES,
      now: NOW,
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

// #455: cambiar la tarjeta es un Checkout en modo `setup`. No trae
// suscripción; trae el SetupIntent con la tarjeta nueva.
describe("checkout.session.completed en modo setup", () => {
  const SETUP_INTENT_ID = "seti_TestSeadragons";

  function setupCheckout(
    object: Record<string, unknown> = {},
  ): ReturnType<typeof stripeEvent> {
    return stripeEvent("checkout.session.completed", {
      object: {
        mode: "setup",
        subscription: null,
        setup_intent: SETUP_INTENT_ID,
        ...object,
      },
    });
  }

  it("lee el SetupIntent y busca la membresía por el cliente y el socio", () => {
    const facts = readStripeEventFacts(setupCheckout());

    expect(facts).toMatchObject({
      kind: "cardSetupCompleted",
      setupIntentId: SETUP_INTENT_ID,
      customerId: FIXTURE_CUSTOMER_ID,
      lookup: {
        userId: FIXTURE_USER_ID,
        customerId: FIXTURE_CUSTOMER_ID,
        subscriptionId: null,
      },
    });
  });

  it("ignora un Checkout en modo setup sin SetupIntent", () => {
    const facts = readStripeEventFacts(setupCheckout({ setup_intent: null }));

    expect(facts).toEqual({ kind: "ignored" });
  });

  it("guarda sólo la tarjeta nueva, sin tocar el estado ni la fecha del último evento", () => {
    const writes = plan(setupCheckout(), {
      membership: membership({
        status: "past_due",
        stripeCustomerId: FIXTURE_CUSTOMER_ID,
        stripeSubscriptionId: FIXTURE_SUBSCRIPTION_ID,
      }),
      card: VISA,
    });

    expect(writes.membership).toEqual({ card: VISA });
  });

  it("no escribe nada si el SetupIntent no trae tarjeta", () => {
    const writes = plan(setupCheckout(), { card: null });

    expect(writes.membership).toBeNull();
  });
});

describe("invoice.upcoming (#470)", () => {
  const ACTIVE = {
    status: "active",
    stripeCustomerId: FIXTURE_CUSTOMER_ID,
    stripeSubscriptionId: FIXTURE_SUBSCRIPTION_ID,
    card: VISA,
  } as const;

  function renewalFacts(
    event = stripeEvent("invoice.upcoming"),
  ): RenewalUpcomingFacts {
    const facts = readStripeEventFacts(event);
    if (facts.kind !== "renewalUpcoming") {
      throw new Error(`Se esperaba una renovación y llegó ${facts.kind}.`);
    }
    return facts;
  }

  function noticeFor(change: Partial<MembershipRecord>) {
    return planRenewalNotice({
      facts: renewalFacts(),
      membership: membership(change),
      now: NOW,
    });
  }

  it("lee el importe, la fecha del cobro y de quién es la suscripción", () => {
    const event = stripeEvent("invoice.upcoming");

    expect(readStripeEventFacts(event)).toEqual({
      kind: "renewalUpcoming",
      created: secondsToDate(event.created),
      lookup: {
        userId: FIXTURE_USER_ID,
        customerId: FIXTURE_CUSTOMER_ID,
        subscriptionId: FIXTURE_SUBSCRIPTION_ID,
      },
      amountCents: 4500,
      chargeAt: new Date("2026-10-28T14:15:00Z"),
    });
  });

  it("sin intento de cobro fijado, toma la fecha en que nacerá la factura", () => {
    const facts = renewalFacts(
      stripeEvent("invoice.upcoming", {
        object: { next_payment_attempt: null, created: 1793200000 },
      }),
    );

    expect(facts.chargeAt).toEqual(secondsToDate(1793200000));
  });

  it.each(["active", "trialing"] as const)(
    "avisa a una membresía %s con el importe, la fecha y la tarjeta",
    (status) => {
      const notice = noticeFor({ ...ACTIVE, status });

      expect(notice).toEqual({
        userId: FIXTURE_USER_ID,
        clubId: CLUB_ID,
        amountCents: 4500,
        chargeAt: new Date("2026-10-28T14:15:00Z"),
        card: { brand: "visa", last4: "4242" },
      });
    },
  );

  it("avisa sin tarjeta cuando la membresía no tiene ninguna guardada", () => {
    const notice = noticeFor({ ...ACTIVE, card: null });

    expect(notice).toMatchObject({ card: null });
  });

  it.each(["pending", "past_due", "cancelled"] as const)(
    "no avisa a una membresía %s",
    (status) => {
      expect(noticeFor({ ...ACTIVE, status })).toBeNull();
    },
  );

  it("no avisa a una membresía exenta", () => {
    const notice = noticeFor({
      ...ACTIVE,
      status: "waived",
      waiver: { reason: "Beca", until: null, waivedBy: null },
    });

    expect(notice).toBeNull();
  });

  it("avisa cuando la exención ya venció y la suscripción sigue en curso", () => {
    const notice = noticeFor({
      ...ACTIVE,
      status: "waived",
      waiver: {
        reason: "Beca",
        until: new Date("2026-09-01T00:00:00Z"),
        waivedBy: null,
      },
      currentPeriodEnd: new Date("2026-10-28T14:15:00Z"),
    });

    expect(notice).not.toBeNull();
  });

  it("no avisa si la suscripción se cancela al final del periodo", () => {
    const notice = noticeFor({
      ...ACTIVE,
      scheduledChange: {
        plan: "Casual",
        effectiveAt: new Date("2026-10-28T14:15:00Z"),
      },
    });

    expect(notice).toBeNull();
  });

  it("avisa si lo programado es un cambio a otro plan con cuota", () => {
    const notice = noticeFor({
      ...ACTIVE,
      scheduledChange: {
        plan: "Student",
        effectiveAt: new Date("2026-10-28T14:15:00Z"),
      },
    });

    expect(notice).not.toBeNull();
  });
});

// #471: un pack de sesiones es un Checkout en modo `payment`. No trae
// suscripción; trae el PaymentIntent, el importe y el pack en los metadatos.
describe("checkout.session.completed de un pack de sesiones", () => {
  function packCheckout(
    object: Record<string, unknown> = {},
  ): ReturnType<typeof stripeEvent> {
    return stripeEvent("checkout.session.completed (pack)", { object });
  }

  it("lee el pago del pack y busca la membresía por el socio de los metadatos", () => {
    const event = packCheckout();

    const facts = readStripeEventFacts(event);

    expect(facts).toEqual({
      kind: "sessionPackPaid",
      created: secondsToDate(event.created),
      lookup: {
        userId: FIXTURE_USER_ID,
        customerId: null,
        subscriptionId: null,
      },
      sessions: FIXTURE_PACK_SESSIONS,
      payment: {
        paymentIntentId: FIXTURE_PAYMENT_INTENT_ID,
        amountCents: 7500,
        currency: "aud",
        description: "Casual session pack (5 sessions)",
        paidAt: secondsToDate(event.created),
      },
    });
  });

  it.each(["unpaid", "no_payment_required"])(
    "ignora un pack con el pago %s",
    (paymentStatus) => {
      const facts = readStripeEventFacts(
        packCheckout({ payment_status: paymentStatus }),
      );

      expect(facts).toEqual({ kind: "ignored" });
    },
  );

  it("ignora un Checkout de pago que no es de un pack", () => {
    const facts = readStripeEventFacts(
      packCheckout({ metadata: { user_id: FIXTURE_USER_ID, kind: "otro" } }),
    );

    expect(facts).toEqual({ kind: "ignored" });
  });

  it.each(["0", "-3", "cinco", "2.5"])(
    "ignora un pack con un tamaño que no vale (%s)",
    (packSessions) => {
      const facts = readStripeEventFacts(
        packCheckout({
          metadata: {
            user_id: FIXTURE_USER_ID,
            kind: "session_pack",
            pack_sessions: packSessions,
          },
        }),
      );

      expect(facts).toEqual({ kind: "ignored" });
    },
  );

  it("ignora un pack sin PaymentIntent", () => {
    const facts = readStripeEventFacts(packCheckout({ payment_intent: null }));

    expect(facts).toEqual({ kind: "ignored" });
  });

  it("ignora un pack caducado: checkout.session.expired no suma nada", () => {
    const facts = readStripeEventFacts(
      stripeEvent("checkout.session.completed (pack)", {
        type: "checkout.session.expired",
        object: { status: "expired", payment_status: "unpaid" },
      }),
    );

    expect(facts).toEqual({ kind: "ignored" });
  });
});

// #473: un levy es otro Checkout en modo `payment`. Trae el producto de
// Stripe y su nombre en los metadatos, que es lo que el historial enseña.
describe("checkout.session.completed de un levy", () => {
  function levyCheckout(
    object: Record<string, unknown> = {},
  ): ReturnType<typeof stripeEvent> {
    return stripeEvent("checkout.session.completed (levy)", { object });
  }

  it("lee el pago del levy con su producto y su nombre", () => {
    const event = levyCheckout();

    const facts = readStripeEventFacts(event);

    expect(facts).toEqual({
      kind: "levyPaid",
      created: secondsToDate(event.created),
      lookup: {
        userId: FIXTURE_USER_ID,
        customerId: null,
        subscriptionId: null,
      },
      payment: {
        paymentIntentId: FIXTURE_LEVY_PAYMENT_INTENT_ID,
        productId: FIXTURE_LEVY_PRODUCT_ID,
        amountCents: 8000,
        currency: "aud",
        description: FIXTURE_LEVY_NAME,
        paidAt: secondsToDate(event.created),
      },
    });
  });

  it.each(["unpaid", "no_payment_required"])(
    "ignora un levy con el pago %s",
    (paymentStatus) => {
      const facts = readStripeEventFacts(
        levyCheckout({ payment_status: paymentStatus }),
      );

      expect(facts).toEqual({ kind: "ignored" });
    },
  );

  it.each(["levy_product_id", "levy_name"])(
    "ignora un levy sin %s en los metadatos",
    (missingKey) => {
      const metadata: Record<string, string> = {
        user_id: FIXTURE_USER_ID,
        kind: "levy",
        levy_product_id: FIXTURE_LEVY_PRODUCT_ID,
        levy_name: FIXTURE_LEVY_NAME,
      };
      delete metadata[missingKey];

      const facts = readStripeEventFacts(levyCheckout({ metadata }));

      expect(facts).toEqual({ kind: "ignored" });
    },
  );

  it("ignora un levy sin PaymentIntent", () => {
    const facts = readStripeEventFacts(levyCheckout({ payment_intent: null }));

    expect(facts).toEqual({ kind: "ignored" });
  });
});
