// @vitest-environment node
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MembershipCard } from "@/lib/membership/membership";
import {
  type StripeApi,
  type StripeWebhookGateway,
  handleStripeEvent,
} from "@/lib/stripe/stripe-webhook";
import type { StripeMembership } from "@/lib/stripe/webhook-events";
import {
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
const readCard = vi.fn<(paymentMethodId: string) => Promise<MembershipCard>>();
const readSubscription =
  vi.fn<(subscriptionId: string) => Promise<Stripe.Subscription>>();
const readSetupCard = vi.fn<StripeApi["readSetupCard"]>();
const makeDefaultPaymentMethod = vi.fn<StripeApi["makeDefaultPaymentMethod"]>();
const log = vi.fn<(line: string) => void>();

function handle(event: ReturnType<typeof stripeEvent>) {
  return handleStripeEvent(event, {
    gateway: { findMembership, applyEvent },
    stripe: {
      readCard,
      readSubscription,
      readSetupCard,
      makeDefaultPaymentMethod,
    },
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
