import { afterEach, describe, expect, it, vi } from "vitest";
import { openReceipt } from "@/components/payments/checkout-navigation";

/**
 * El recibo de Stripe (#630, #631) se abre en una pestaña nueva y sin darle a
 * Stripe acceso a la ventana de Pagos.
 */

const RECEIPT_URL = "https://pay.stripe.com/receipts/payment/abc";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openReceipt", () => {
  it("pulsa un enlace a una pestaña nueva con rel noopener", () => {
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });

    openReceipt(RECEIPT_URL);

    expect(clicked).toHaveLength(1);
    const [link] = clicked;
    expect(link?.href).toBe(RECEIPT_URL);
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noopener");
  });
});
