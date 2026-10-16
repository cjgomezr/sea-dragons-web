import { describe, expect, it } from "vitest";
import {
  NOT_WAITING_FOR_LEVY,
  hasLevySettled,
  initialLevyWaiting,
  levyReturnNotice,
} from "@/components/payments/use-levy-wait";
import type { Levy } from "@/lib/membership/levies";

/**
 * La espera del webhook al volver de pagar un extra (#692): qué esperar según
 * la primera lista y la vuelta, y cuándo se da por confirmada.
 */

const JERSEY_PRODUCT = "prod_jersey";

function jersey(purchasedQuantity: number): Levy {
  return {
    id: "price_jersey",
    productId: JERSEY_PRODUCT,
    name: "2026 club jersey",
    description: null,
    amountCents: 6000,
    maxQuantity: 10,
    purchasedQuantity,
    lastPurchasedAt: purchasedQuantity === 0 ? null : "2026-09-20T02:30:00Z",
    isPaid: purchasedQuantity > 0,
  };
}

const PAID_WITH_THREE_BEFORE = {
  kind: "paid",
  productId: JERSEY_PRODUCT,
  purchasedBefore: 3,
} as const;

const TARGET = { productId: JERSEY_PRODUCT, purchasedBefore: 3 };

describe("initialLevyWaiting", () => {
  it("espera si las unidades del extra siguen en las que tenía", () => {
    expect(initialLevyWaiting([jersey(3)], PAID_WITH_THREE_BEFORE)).toEqual({
      kind: "polling",
      target: TARGET,
    });
  });

  it("no espera si el webhook ya llegó", () => {
    expect(initialLevyWaiting([jersey(4)], PAID_WITH_THREE_BEFORE)).toBe(
      NOT_WAITING_FOR_LEVY,
    );
  });

  it("no espera un producto que no está en la lista", () => {
    expect(
      initialLevyWaiting([jersey(3)], {
        ...PAID_WITH_THREE_BEFORE,
        productId: "prod_unknown",
      }),
    ).toBe(NOT_WAITING_FOR_LEVY);
  });

  it("no espera sin vuelta de Stripe", () => {
    expect(initialLevyWaiting([jersey(3)], null)).toBe(NOT_WAITING_FOR_LEVY);
  });

  it("no espera tras cancelar", () => {
    expect(initialLevyWaiting([jersey(3)], { kind: "cancelled" })).toBe(
      NOT_WAITING_FOR_LEVY,
    );
  });
});

describe("hasLevySettled", () => {
  it("se da por confirmada cuando las unidades suben", () => {
    expect(hasLevySettled(TARGET, [jersey(4)])).toBe(true);
  });

  it("no se da por confirmada mientras siguen igual", () => {
    expect(hasLevySettled(TARGET, [jersey(3)])).toBe(false);
  });

  it("no se da por confirmada si el extra desaparece de la lista", () => {
    expect(hasLevySettled(TARGET, [])).toBe(false);
  });
});

describe("levyReturnNotice", () => {
  it("avisa de la espera mientras pregunta", () => {
    expect(
      levyReturnNotice(
        { kind: "polling", target: TARGET },
        PAID_WITH_THREE_BEFORE,
      ),
    ).toBe("waiting");
  });

  it("da el aviso prudente cuando se acaba la espera", () => {
    expect(
      levyReturnNotice(
        { kind: "timed_out", target: TARGET },
        PAID_WITH_THREE_BEFORE,
      ),
    ).toBe("timed_out");
  });

  it("dice que salió sin comprar tras cancelar", () => {
    expect(levyReturnNotice(NOT_WAITING_FOR_LEVY, { kind: "cancelled" })).toBe(
      "cancelled",
    );
  });

  it("no dice nada si el pago ya se confirmó", () => {
    expect(
      levyReturnNotice(NOT_WAITING_FOR_LEVY, PAID_WITH_THREE_BEFORE),
    ).toBeNull();
  });

  it("no dice nada sin vuelta de Stripe", () => {
    expect(levyReturnNotice(NOT_WAITING_FOR_LEVY, null)).toBeNull();
  });
});
