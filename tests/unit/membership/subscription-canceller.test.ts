// @vitest-environment node
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { createSubscriptionCanceller } from "@/lib/membership/supabase-membership-waiver-gateways";
import type { SubscriptionPlanClient } from "@/lib/stripe/subscription-plan-api";

/**
 * Lo que eximir de cuota (#457) le pide a Stripe: cancelar la suscripción al
 * final del periodo. Una con un cambio de plan programado (#456) la gobierna
 * un `SubscriptionSchedule`, y Stripe no deja cancelarla sin soltarlo antes.
 */

const SUBSCRIPTION_ID = "sub_ines";
const SCHEDULE_ID = "sub_sched_ines";
const PERIOD_END = 1792592000;

function clientDouble(schedule: string | null) {
  const calls: string[] = [];
  const current = {
    id: SUBSCRIPTION_ID,
    schedule,
    items: { data: [{ current_period_end: PERIOD_END }] },
  } as unknown as Stripe.Subscription;
  const client = {
    subscriptions: {
      retrieve: vi.fn(async () => current),
      update: vi.fn(async () => {
        calls.push("update");
        return current;
      }),
    },
    subscriptionSchedules: {
      create: vi.fn(),
      retrieve: vi.fn(),
      update: vi.fn(),
      release: vi.fn(async () => {
        calls.push("release");
        return {};
      }),
    },
  };
  return { client, calls };
}

function cancellerOver(client: ReturnType<typeof clientDouble>["client"]) {
  const canceller = createSubscriptionCanceller(
    client as unknown as SubscriptionPlanClient,
  );
  if (canceller.kind !== "configured") {
    throw new Error("Con cliente, el cancelador tiene que estar configurado.");
  }
  return canceller;
}

describe("createSubscriptionCanceller", () => {
  it("cancela al final del periodo una suscripción sin programación", async () => {
    const { client } = clientDouble(null);

    await cancellerOver(client).cancelAtPeriodEnd(SUBSCRIPTION_ID);

    expect(client.subscriptions.update).toHaveBeenCalledWith(SUBSCRIPTION_ID, {
      cancel_at_period_end: true,
    });
    expect(client.subscriptionSchedules.release).not.toHaveBeenCalled();
  });

  it("suelta antes el cambio de plan programado, o Stripe rechazaría la cancelación", async () => {
    const { client, calls } = clientDouble(SCHEDULE_ID);

    await cancellerOver(client).cancelAtPeriodEnd(SUBSCRIPTION_ID);

    expect(client.subscriptionSchedules.release).toHaveBeenCalledWith(
      SCHEDULE_ID,
    );
    expect(calls).toEqual(["release", "update"]);
  });
});
