// @vitest-environment node
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
  type SubscriptionPlanClient,
  createSubscriptionPlanApi,
} from "@/lib/stripe/subscription-plan-api";

/**
 * Lo que el cambio de plan (#456) le pide a la API de Stripe, con el cliente
 * doblado. La decisión de diseño que se prueba: Full y Student cambian con un
 * `SubscriptionSchedule` de dos fases, la actual hasta el fin del periodo y la
 * nueva después, sin prorrateo; anular es soltar la programación.
 */

const SUBSCRIPTION_ID = "sub_alba";
const SCHEDULE_ID = "sub_sched_alba";
const PERIOD_START = 1790000000;
const PERIOD_END = 1792592000;
const TRIAL_END = 1792592000;

function subscription(
  change: Partial<Record<keyof Stripe.Subscription, unknown>> = {},
): Stripe.Subscription {
  return {
    id: SUBSCRIPTION_ID,
    schedule: null,
    items: {
      data: [{ current_period_end: PERIOD_END, price: { id: "price_full" } }],
    },
    ...change,
  } as unknown as Stripe.Subscription;
}

function schedule(trialEnd: number | null = null): Stripe.SubscriptionSchedule {
  return {
    id: SCHEDULE_ID,
    current_phase: { start_date: PERIOD_START, end_date: PERIOD_END },
    phases: [
      {
        start_date: PERIOD_START,
        end_date: PERIOD_END,
        trial_end: trialEnd,
        items: [{ price: { id: "price_full" }, quantity: 1 }],
      },
    ],
  } as unknown as Stripe.SubscriptionSchedule;
}

function clientDouble(current: Stripe.Subscription = subscription()) {
  return {
    subscriptions: {
      retrieve: vi.fn(async () => current),
      update: vi.fn(async () => current),
    },
    subscriptionSchedules: {
      create: vi.fn(async () => schedule()),
      retrieve: vi.fn(async () => schedule()),
      update: vi.fn(async () => schedule()),
      release: vi.fn(async () => schedule()),
    },
  };
}

function apiOver(client: ReturnType<typeof clientDouble>) {
  return createSubscriptionPlanApi(client as unknown as SubscriptionPlanClient);
}

describe("programar el precio del siguiente ciclo", () => {
  it("crea la programación desde la suscripción y añade la fase nueva al acabar la actual, sin prorrateo", async () => {
    const client = clientDouble();

    const effectiveAt = await apiOver(client).schedulePriceChange({
      subscriptionId: SUBSCRIPTION_ID,
      priceId: "price_student",
    });

    expect(client.subscriptionSchedules.create).toHaveBeenCalledWith({
      from_subscription: SUBSCRIPTION_ID,
    });
    expect(client.subscriptionSchedules.update).toHaveBeenCalledWith(
      SCHEDULE_ID,
      {
        end_behavior: "release",
        proration_behavior: "none",
        phases: [
          {
            items: [{ price: "price_full", quantity: 1 }],
            start_date: PERIOD_START,
            end_date: PERIOD_END,
            proration_behavior: "none",
          },
          {
            items: [{ price: "price_student", quantity: 1 }],
            duration: { interval: "month", interval_count: 1 },
            proration_behavior: "none",
          },
        ],
      },
    );
    expect(effectiveAt).toEqual(new Date(PERIOD_END * 1000));
  });

  it("conserva el fin de la prueba de la fase actual", async () => {
    const client = clientDouble();
    client.subscriptionSchedules.create.mockResolvedValue(schedule(TRIAL_END));

    await apiOver(client).schedulePriceChange({
      subscriptionId: SUBSCRIPTION_ID,
      priceId: "price_student",
    });

    const [, params] = client.subscriptionSchedules.update.mock
      .calls[0] as unknown as [string, Stripe.SubscriptionScheduleUpdateParams];
    expect(params.phases?.[0]).toMatchObject({ trial_end: TRIAL_END });
  });

  it("reutiliza la programación que la suscripción ya tenga", async () => {
    const client = clientDouble(subscription({ schedule: SCHEDULE_ID }));

    await apiOver(client).schedulePriceChange({
      subscriptionId: SUBSCRIPTION_ID,
      priceId: "price_student",
    });

    expect(client.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(client.subscriptionSchedules.retrieve).toHaveBeenCalledWith(
      SCHEDULE_ID,
    );
  });
});

describe("anular el precio programado", () => {
  it("suelta la programación y la suscripción se queda con su precio", async () => {
    const client = clientDouble(subscription({ schedule: SCHEDULE_ID }));

    await apiOver(client).cancelPriceChange(SUBSCRIPTION_ID);

    expect(client.subscriptionSchedules.release).toHaveBeenCalledWith(
      SCHEDULE_ID,
    );
  });

  it("sin programación no hay nada que soltar", async () => {
    const client = clientDouble();

    await apiOver(client).cancelPriceChange(SUBSCRIPTION_ID);

    expect(client.subscriptionSchedules.release).not.toHaveBeenCalled();
  });
});

describe("pasar a Casual", () => {
  it("cancela al final del periodo y dice cuándo", async () => {
    const client = clientDouble();

    const endsAt = await apiOver(client).cancelAtPeriodEnd(SUBSCRIPTION_ID);

    expect(client.subscriptions.update).toHaveBeenCalledWith(SUBSCRIPTION_ID, {
      cancel_at_period_end: true,
    });
    expect(endsAt).toEqual(new Date(PERIOD_END * 1000));
  });

  it("suelta antes una programación que haya quedado puesta, que Stripe no deja cancelar", async () => {
    const client = clientDouble(subscription({ schedule: SCHEDULE_ID }));

    await apiOver(client).cancelAtPeriodEnd(SUBSCRIPTION_ID);

    expect(client.subscriptionSchedules.release).toHaveBeenCalledWith(
      SCHEDULE_ID,
    );
    expect(
      client.subscriptionSchedules.release.mock.invocationCallOrder[0],
    ).toBeLessThan(
      client.subscriptions.update.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("anularlo deja la suscripción como estaba", async () => {
    const client = clientDouble();

    await apiOver(client).resumeSubscription(SUBSCRIPTION_ID);

    expect(client.subscriptions.update).toHaveBeenCalledWith(SUBSCRIPTION_ID, {
      cancel_at_period_end: false,
    });
  });
});
