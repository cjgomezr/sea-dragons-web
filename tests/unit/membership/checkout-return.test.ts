import { describe, expect, it } from "vitest";
import { readLevyReturn } from "@/lib/membership/checkout-return";

/**
 * Con qué vuelve el socio de pagar un extra (#692): `levy=ok` con el
 * producto y las unidades que tenía, o `levy=cancelado`. Lo que no se sabe
 * leer vale tanto como no haber vuelto de Stripe.
 */

describe("readLevyReturn", () => {
  it("lee el producto y las unidades que tenía al volver pagado", () => {
    expect(
      readLevyReturn({ levy: "ok", extra: "prod_jersey", antes: "3" }),
    ).toEqual({ kind: "paid", productId: "prod_jersey", purchasedBefore: 3 });
  });

  it("acepta cero unidades, la primera compra", () => {
    expect(
      readLevyReturn({ levy: "ok", extra: "prod_jersey", antes: "0" }),
    ).toEqual({ kind: "paid", productId: "prod_jersey", purchasedBefore: 0 });
  });

  it("lee la vuelta cancelada sin más parámetros", () => {
    expect(readLevyReturn({ levy: "cancelado" })).toEqual({
      kind: "cancelled",
    });
  });

  it("no lee nada sin levy", () => {
    expect(readLevyReturn({ extra: "prod_jersey", antes: "3" })).toBeNull();
  });

  it("no lee nada con levy=ok sin el producto", () => {
    expect(readLevyReturn({ levy: "ok", antes: "3" })).toBeNull();
  });

  it("no lee nada con levy=ok sin las unidades", () => {
    expect(readLevyReturn({ levy: "ok", extra: "prod_jersey" })).toBeNull();
  });

  it.each(["-1", "tres", "1.5", "", "3abc"])(
    "no lee nada con unidades que no son un entero no negativo (%s)",
    (antes) => {
      expect(
        readLevyReturn({ levy: "ok", extra: "prod_jersey", antes }),
      ).toBeNull();
    },
  );

  it("no lee nada con un producto vacío", () => {
    expect(readLevyReturn({ levy: "ok", extra: "", antes: "3" })).toBeNull();
  });

  it("no lee nada con parámetros repetidos", () => {
    expect(
      readLevyReturn({ levy: "ok", extra: ["prod_a", "prod_b"], antes: "3" }),
    ).toBeNull();
  });
});
