// @vitest-environment node
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MembershipCard } from "@/lib/membership/membership";
import type { RenewalNoticeSender } from "@/lib/stripe/renewal-notice";
import {
  type StripeApi,
  type StripeWebhookGateway,
  handleStripeEvent,
} from "@/lib/stripe/stripe-webhook";
import type { StripeMembership } from "@/lib/stripe/webhook-events";
import {
  FIXTURE_PACK_SESSIONS,
  FIXTURE_PAYMENT_INTENT_ID,
  FIXTURE_PRICES,
  FIXTURE_USER_ID,
  stripeEvent,
} from "../../fixtures/stripe/stripe-events";

/**
 * Aplicar un evento de Stripe ya verificado (#452, RF-8): buscar la membresía,
 * resolver la tarjeta y escribirlo todo una sola vez. La base es un doble; la
 * escritura de verdad se prueba en la migración y contra dev.
 */

const NOW = new Date("2026-10-02T00:00:00Z");
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";
const MASTERCARD: MembershipCard = {
  brand: "mastercard",
  last4: "4444",
  expMonth: 3,
  expYear: 2031,
};

const KNOWN_MEMBERSHIP: StripeMembership = {
  record: {
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
  },
  lastStripeEventAt: null,
};

const findMembership = vi.fn<StripeWebhookGateway["findMembership"]>();
const applyEvent = vi.fn<StripeWebhookGateway["applyEvent"]>();
const applySessionPackPayment =
  vi.fn<StripeWebhookGateway["applySessionPackPayment"]>();
const readCard = vi.fn<(paymentMethodId: string) => Promise<MembershipCard>>();
const readSubscription =
  vi.fn<(subscriptionId: string) => Promise<Stripe.Subscription>>();
const readSetupCard = vi.fn<StripeApi["readSetupCard"]>();
const makeDefaultPaymentMethod = vi.fn<StripeApi["makeDefaultPaymentMethod"]>();
const log = vi.fn<(line: string) => void>();
const notifyUpcomingRenewal =
  vi.fn<RenewalNoticeSender["notifyUpcomingRenewal"]>();

function handle(event: ReturnType<typeof stripeEvent>) {
  return handleStripeEvent(event, {
    gateway: { findMembership, applyEvent, applySessionPackPayment },
    stripe: {
      readCard,
      readSubscription,
      readSetupCard,
      makeDefaultPaymentMethod,
    },
    renewalNotices: { notifyUpcomingRenewal },
    prices: FIXTURE_PRICES,
    now: NOW,
    log,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  findMembership.mockResolvedValue(KNOWN_MEMBERSHIP);
  applyEvent.mockResolvedValue("applied");
  readCard.mockResolvedValue(MASTERCARD);
  readSetupCard.mockResolvedValue({
    paymentMethodId: "pm_TarjetaNueva",
    card: MASTERCARD,
  });
  makeDefaultPaymentMethod.mockResolvedValue(undefined);
  notifyUpcomingRenewal.mockResolvedValue(undefined);
  readSubscription.mockResolvedValue(
    stripeEvent("customer.subscription.updated", {
      object: { metadata: {} },
    }).data.object as Stripe.Subscription,
  );
});

describe("handleStripeEvent", () => {
  it("aplica el evento con su id, su tipo y su fecha sobre la membresía encontrada", async () => {
    const event = stripeEvent("invoice.paid");

    const outcome = await handle(event);

    expect(outcome).toBe("applied");
    expect(applyEvent).toHaveBeenCalledWith({
      event: {
        id: event.id,
        type: "invoice.paid",
        created: new Date(event.created * 1000),
      },
      owner: { userId: FIXTURE_USER_ID, clubId: CLUB_ID },
      writes: expect.objectContaining({
        membership: null,
        payment: expect.objectContaining({ status: "paid" }),
      }),
    });
  });

  it("responde que ya estaba aplicado cuando la base ya conocía el evento", async () => {
    applyEvent.mockResolvedValue("duplicate");

    const outcome = await handle(stripeEvent("invoice.paid"));

    expect(outcome).toBe("duplicate");
  });

  it("ignora un tipo de evento que no le toca sin buscar ni escribir nada", async () => {
    const outcome = await handle(
      stripeEvent("invoice.paid", { type: "customer.created" }),
    );

    expect(outcome).toBe("ignored");
    expect(findMembership).not.toHaveBeenCalled();
    expect(applyEvent).not.toHaveBeenCalled();
  });

  it("no escribe nada de un socio que la base no conoce y lo deja en el log", async () => {
    findMembership.mockResolvedValue(null);
    const event = stripeEvent("customer.subscription.updated");

    const outcome = await handle(event);

    expect(outcome).toBe("unknown_member");
    expect(applyEvent).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(event.id));
  });

  it("pide a Stripe la tarjeta cuando la suscripción sólo trae el id del método de pago", async () => {
    await handle(
      stripeEvent("customer.subscription.updated", {
        object: { default_payment_method: "pm_SoloElId" },
      }),
    );

    expect(readCard).toHaveBeenCalledWith("pm_SoloElId");
    expect(applyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        writes: expect.objectContaining({
          membership: expect.objectContaining({ card: MASTERCARD }),
        }),
      }),
    );
  });

  it("no le pregunta nada a Stripe cuando la tarjeta ya viene en el evento", async () => {
    await handle(stripeEvent("customer.subscription.updated"));

    expect(readCard).not.toHaveBeenCalled();
  });

  it("con un Checkout pide la suscripción a Stripe y la aplica entera", async () => {
    const event = stripeEvent("checkout.session.completed");

    const outcome = await handle(event);

    expect(outcome).toBe("applied");
    expect(readSubscription).toHaveBeenCalledWith("sub_TestSeadragons");
    expect(findMembership).toHaveBeenCalledWith(
      expect.objectContaining({ userId: FIXTURE_USER_ID }),
    );
    expect(applyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ type: "checkout.session.completed" }),
        writes: expect.objectContaining({
          membership: expect.objectContaining({
            status: "trialing",
            plan: "Full",
            card: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 },
          }),
        }),
      }),
    );
  });

  it("no escribe nada si Stripe no devuelve la suscripción del Checkout", async () => {
    readSubscription.mockRejectedValue(new Error("Stripe no contesta"));

    await expect(
      handle(stripeEvent("checkout.session.completed")),
    ).rejects.toThrow("Stripe no contesta");
    expect(applyEvent).not.toHaveBeenCalled();
  });

  it("deja en el log lo que no pudo reconocer", async () => {
    await handle(
      stripeEvent("customer.subscription.updated", {
        object: { status: "paused" },
      }),
    );

    expect(log).toHaveBeenCalledWith(expect.stringContaining("paused"));
  });

  // #455: el cambio de tarjeta vuelve como un Checkout en modo `setup`.
  describe("con un Checkout de cambio de tarjeta", () => {
    const SUBSCRIBED_MEMBERSHIP: StripeMembership = {
      ...KNOWN_MEMBERSHIP,
      record: {
        ...KNOWN_MEMBERSHIP.record,
        status: "past_due",
        stripeCustomerId: "cus_TestSeadragons",
        stripeSubscriptionId: "sub_TestSeadragons",
      },
    };

    function setupCheckout(): ReturnType<typeof stripeEvent> {
      return stripeEvent("checkout.session.completed", {
        object: {
          mode: "setup",
          subscription: null,
          setup_intent: "seti_TestSeadragons",
        },
      });
    }

    beforeEach(() => {
      findMembership.mockResolvedValue(SUBSCRIBED_MEMBERSHIP);
    });

    it("pone la tarjeta nueva por defecto en el cliente y en la suscripción", async () => {
      await handle(setupCheckout());

      expect(readSetupCard).toHaveBeenCalledWith("seti_TestSeadragons");
      expect(makeDefaultPaymentMethod).toHaveBeenCalledWith({
        customerId: "cus_TestSeadragons",
        subscriptionId: "sub_TestSeadragons",
        paymentMethodId: "pm_TarjetaNueva",
      });
    });

    it("guarda la tarjeta nueva en la membresía", async () => {
      const outcome = await handle(setupCheckout());

      expect(outcome).toBe("applied");
      expect(applyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          writes: expect.objectContaining({
            membership: { card: MASTERCARD },
          }),
        }),
      );
    });

    it("no toca Stripe ni la membresía si el SetupIntent no trae tarjeta", async () => {
      readSetupCard.mockResolvedValue(null);

      await handle(setupCheckout());

      expect(makeDefaultPaymentMethod).not.toHaveBeenCalled();
      expect(applyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          writes: expect.objectContaining({ membership: null }),
        }),
      );
    });
  });
});

describe("handleStripeEvent con invoice.upcoming (#470)", () => {
  const ACTIVE_MEMBERSHIP: StripeMembership = {
    ...KNOWN_MEMBERSHIP,
    record: { ...KNOWN_MEMBERSHIP.record, status: "active", card: MASTERCARD },
  };

  beforeEach(() => {
    findMembership.mockResolvedValue(ACTIVE_MEMBERSHIP);
  });

  it("apunta el evento sin escribir nada más y avisa al socio", async () => {
    const event = stripeEvent("invoice.upcoming");

    const outcome = await handle(event);

    expect(outcome).toBe("applied");
    expect(applyEvent).toHaveBeenCalledWith({
      event: {
        id: event.id,
        type: "invoice.upcoming",
        created: new Date(event.created * 1000),
      },
      owner: { userId: FIXTURE_USER_ID, clubId: CLUB_ID },
      writes: { membership: null, payment: null, warnings: [] },
    });
    expect(notifyUpcomingRenewal).toHaveBeenCalledWith({
      userId: FIXTURE_USER_ID,
      clubId: CLUB_ID,
      amountCents: 4500,
      chargeAt: new Date("2026-10-28T14:15:00Z"),
      card: { brand: "mastercard", last4: "4444" },
    });
  });

  it("no vuelve a avisar de un evento repetido", async () => {
    applyEvent.mockResolvedValue("duplicate");

    const outcome = await handle(stripeEvent("invoice.upcoming"));

    expect(outcome).toBe("duplicate");
    expect(notifyUpcomingRenewal).not.toHaveBeenCalled();
  });

  it("no avisa ni apunta nada si la membresía no se renueva", async () => {
    findMembership.mockResolvedValue({
      ...ACTIVE_MEMBERSHIP,
      record: { ...ACTIVE_MEMBERSHIP.record, status: "cancelled" },
    });

    const outcome = await handle(stripeEvent("invoice.upcoming"));

    expect(outcome).toBe("ignored");
    expect(applyEvent).not.toHaveBeenCalled();
    expect(notifyUpcomingRenewal).not.toHaveBeenCalled();
  });

  it("de un socio que la base no conoce no escribe nada y deja una línea en el log", async () => {
    findMembership.mockResolvedValue(null);
    const event = stripeEvent("invoice.upcoming");

    const outcome = await handle(event);

    expect(outcome).toBe("unknown_member");
    expect(applyEvent).not.toHaveBeenCalled();
    expect(notifyUpcomingRenewal).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(event.id));
  });
});

// #471: un pack pagado no toca la membresía por aquí: entra el pago y el libro
// suma sus sesiones, en una sola escritura; la base abre la puerta.
describe("un pack de sesiones pagado", () => {
  const CASUAL_MEMBERSHIP: StripeMembership = {
    ...KNOWN_MEMBERSHIP,
    record: { ...KNOWN_MEMBERSHIP.record, plan: "Casual" },
  };

  beforeEach(() => {
    findMembership.mockResolvedValue(CASUAL_MEMBERSHIP);
    applySessionPackPayment.mockResolvedValue("applied");
  });

  it("escribe el pago y las sesiones del pack una sola vez, con el id del evento", async () => {
    const event = stripeEvent("checkout.session.completed (pack)");

    const outcome = await handle(event);

    expect(outcome).toBe("applied");
    expect(findMembership).toHaveBeenCalledWith({
      userId: FIXTURE_USER_ID,
      customerId: null,
      subscriptionId: null,
    });
    expect(applySessionPackPayment).toHaveBeenCalledWith({
      event: {
        id: event.id,
        type: "checkout.session.completed",
        created: new Date(event.created * 1000),
      },
      owner: { userId: FIXTURE_USER_ID, clubId: CLUB_ID },
      sessions: FIXTURE_PACK_SESSIONS,
      payment: {
        paymentIntentId: FIXTURE_PAYMENT_INTENT_ID,
        amountCents: 7500,
        currency: "aud",
        description: "Casual session pack (5 sessions)",
        paidAt: new Date(event.created * 1000),
      },
    });
    expect(applyEvent).not.toHaveBeenCalled();
    expect(readSubscription).not.toHaveBeenCalled();
  });

  it("responde que ya estaba aplicado cuando el evento se repite", async () => {
    applySessionPackPayment.mockResolvedValue("duplicate");

    const outcome = await handle(
      stripeEvent("checkout.session.completed (pack)"),
    );

    expect(outcome).toBe("duplicate");
  });

  it("no suma nada de un pack sin pagar", async () => {
    const outcome = await handle(
      stripeEvent("checkout.session.completed (pack)", {
        object: { payment_status: "unpaid" },
      }),
    );

    expect(outcome).toBe("ignored");
    expect(applySessionPackPayment).not.toHaveBeenCalled();
  });

  it("no suma nada de un Checkout de pago que no es de un pack", async () => {
    const outcome = await handle(
      stripeEvent("checkout.session.completed (pack)", {
        object: { metadata: {} },
      }),
    );

    expect(outcome).toBe("ignored");
    expect(applySessionPackPayment).not.toHaveBeenCalled();
  });

  it("no suma nada de un pack de un socio que la base no conoce y lo deja en el log", async () => {
    findMembership.mockResolvedValue(null);

    const outcome = await handle(
      stripeEvent("checkout.session.completed (pack)"),
    );

    expect(outcome).toBe("unknown_member");
    expect(applySessionPackPayment).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
  });
});
