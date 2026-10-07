// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  type FailedPaymentAlertGateway,
  readFailedPaymentAlert,
} from "@/lib/membership/failed-payment-alert";
import type {
  MembershipStanding,
  MembershipStatus,
} from "@/lib/membership/membership";

/**
 * La alerta de pago fallido (#474, FR-070): se enseña sólo con la membresía
 * en `past_due`, con la fecha del último cobro fallido.
 */

const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const NOW = new Date("2026-10-07T09:00:00.000Z");
const FAILED_AT = new Date("2026-10-01T03:12:00.000Z");

function standing(
  status: MembershipStatus,
  change: Partial<MembershipStanding> = {},
): MembershipStanding {
  return {
    status,
    stripeSubscriptionId: "sub_123",
    trialEnd: null,
    currentPeriodEnd: null,
    waivedUntil: null,
    ...change,
  };
}

function gateway(
  found: MembershipStanding | null,
  failedAt: Date | null = FAILED_AT,
): FailedPaymentAlertGateway & {
  readonly findLastFailedInvoiceAt: ReturnType<
    typeof vi.fn<FailedPaymentAlertGateway["findLastFailedInvoiceAt"]>
  >;
} {
  return {
    findStanding: async () => found,
    findLastFailedInvoiceAt: vi.fn<
      FailedPaymentAlertGateway["findLastFailedInvoiceAt"]
    >(async () => failedAt),
  };
}

function read(
  target: FailedPaymentAlertGateway,
): ReturnType<typeof readFailedPaymentAlert> {
  return readFailedPaymentAlert(target, { userId: USER_ID, now: NOW });
}

describe("readFailedPaymentAlert", () => {
  it("avisa a una membresía past_due con la fecha del último cobro fallido", async () => {
    await expect(read(gateway(standing("past_due")))).resolves.toEqual({
      failedAt: FAILED_AT,
    });
  });

  it("avisa sin fecha si todavía no llegó la fila del cobro fallido", async () => {
    await expect(read(gateway(standing("past_due"), null))).resolves.toEqual({
      failedAt: null,
    });
  });

  it.each<MembershipStatus>([
    "pending",
    "trialing",
    "active",
    "cancelled",
    "waived",
  ])("no avisa con la membresía %s ni busca cobros", async (status) => {
    const target = gateway(standing(status));

    await expect(read(target)).resolves.toBeNull();
    expect(target.findLastFailedInvoiceAt).not.toHaveBeenCalled();
  });

  it("no avisa a quien no tiene membresía", async () => {
    await expect(read(gateway(null))).resolves.toBeNull();
  });
});
