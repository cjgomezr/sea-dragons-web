import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMembershipView } from "@/components/payments/payments-client";
import type { MembershipView } from "@/lib/membership/membership-view";

/**
 * Lo que la pantalla de Pagos lee de `GET /api/v1/membership` (#629): cada
 * pago trae con qué tarjeta se cobró y por qué falló, y el esquema del
 * cliente no los pierde por el camino.
 */

const VIEW: MembershipView = {
  paymentsConfigured: true,
  membership: null,
  payments: [
    {
      id: "pay-oct",
      date: "2026-10-01T09:00:00.000Z",
      description: "Monthly membership",
      amountCents: 4500,
      status: "paid",
      card: { brand: "visa", last4: "4242" },
      failureReason: null,
      quantity: 1,
    },
    {
      id: "pay-sep",
      date: "2026-09-01T09:00:00.000Z",
      description: "Monthly membership",
      amountCents: 4500,
      status: "failed",
      card: null,
      failureReason: "Your card was declined.",
      quantity: 1,
    },
  ],
  sessionBalance: { sessions: 0, movements: [] },
};

function serveMembership(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ data: body })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadMembershipView", () => {
  it("conserva la tarjeta y el motivo del fallo de cada pago", async () => {
    serveMembership(VIEW);

    const load = await loadMembershipView();

    expect(load).toEqual({ kind: "loaded", view: VIEW });
  });

  it("no acepta un pago con unos dígitos de tarjeta que no son texto", async () => {
    serveMembership({
      ...VIEW,
      payments: [{ ...VIEW.payments[0], card: { brand: "visa", last4: 4242 } }],
    });

    const load = await loadMembershipView();

    expect(load.kind).toBe("failed");
  });
});
