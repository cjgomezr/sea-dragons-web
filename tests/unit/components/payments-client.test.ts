import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadMembershipView,
  requestPaymentReceipt,
} from "@/components/payments/payments-client";
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
      option: null,
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
      option: null,
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

describe("requestPaymentReceipt", () => {
  const PAYMENT_ID = "0f3a2b1c-4d5e-4f60-8a7b-9c0d1e2f3a4b";
  const RECEIPT_URL = "https://pay.stripe.com/receipts/payment/test_receipt";

  it("pide el recibo del pago y devuelve su URL", async () => {
    const fetchDouble = vi.fn(async (path: string) => {
      void path;
      return Response.json({ data: { url: RECEIPT_URL } });
    });
    vi.stubGlobal("fetch", fetchDouble);

    const outcome = await requestPaymentReceipt(PAYMENT_ID);

    expect(outcome).toEqual({ kind: "found", url: RECEIPT_URL });
    const [path] = fetchDouble.mock.calls[0] ?? [];
    expect(path).toBe(`/api/v1/membership/payments/${PAYMENT_ID}/receipt`);
  });

  it("devuelve el fallo con su motivo cuando el pago no tiene recibo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "not_found",
              message: "Este pago no tiene recibo.",
              reason: "receipt_not_found",
            },
          },
          { status: 404 },
        ),
      ),
    );

    const outcome = await requestPaymentReceipt(PAYMENT_ID);

    expect(outcome).toMatchObject({
      kind: "failed",
      failure: "not_found",
      reason: "receipt_not_found",
    });
  });

  it("no rechaza cuando falla la red: devuelve el fallo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const outcome = await requestPaymentReceipt(PAYMENT_ID);

    expect(outcome).toMatchObject({ kind: "failed", failure: "network" });
  });
});
