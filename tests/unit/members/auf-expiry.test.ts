import { describe, expect, it } from "vitest";
import { aufExpiryOutlookOf } from "@/lib/members/auf-expiry";

/**
 * Lo que la tarjeta del AUF dice junto al vencimiento (#773, RF-4 del PRD de
 * E30): cuántos días faltan, en aviso si son menos de 90, o que ya venció.
 * Vence hoy cuenta como vigente, como en `isAufExpired`.
 */

const TODAY = "2026-10-20";

describe("el vencimiento del AUF (#773)", () => {
  it("cuenta los días que faltan y no avisa con 90 o más", () => {
    expect(aufExpiryOutlookOf("2027-01-18", TODAY)).toEqual({
      kind: "upcoming",
      days: 90,
      isSoon: false,
    });
  });

  it("avisa cuando faltan menos de 90 días", () => {
    expect(aufExpiryOutlookOf("2027-01-17", TODAY)).toEqual({
      kind: "upcoming",
      days: 89,
      isSoon: true,
    });
  });

  it("vence hoy sigue vigente, con cero días y en aviso", () => {
    expect(aufExpiryOutlookOf(TODAY, TODAY)).toEqual({
      kind: "upcoming",
      days: 0,
      isSoon: true,
    });
  });

  it("un vencimiento pasado ya venció", () => {
    expect(aufExpiryOutlookOf("2026-10-19", TODAY)).toEqual({
      kind: "expired",
    });
  });
});
