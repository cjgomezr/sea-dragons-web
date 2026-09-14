import { describe, expect, it } from "vitest";
import { toConfirmationEmailOutcome } from "@/lib/auth/confirmation-email-sender";

const EMAIL = "nerea@example.test";

describe("límite de envíos", () => {
  it("un 429 de Supabase es un límite de envíos, no un fallo genérico", () => {
    const outcome = toConfirmationEmailOutcome(
      { status: 429, message: "email rate limit exceeded" },
      EMAIL,
    );

    expect(outcome).toEqual({
      kind: "rate_limited",
      reason: "429: email rate limit exceeded",
    });
  });

  it("reconoce el límite por su código aunque no traiga estado", () => {
    const outcome = toConfirmationEmailOutcome(
      { code: "over_email_send_rate_limit", message: "slow down" },
      EMAIL,
    );

    expect(outcome.kind).toBe("rate_limited");
  });

  it("un 400 de Supabase es un fallo genérico", () => {
    const outcome = toConfirmationEmailOutcome(
      { status: 400, message: "Email address is invalid" },
      EMAIL,
    );

    expect(outcome.kind).toBe("failed");
  });
});

describe("registro del motivo", () => {
  it("el motivo no lleva la dirección, que es un dato personal", () => {
    const outcome = toConfirmationEmailOutcome(
      { status: 400, message: `Email address "${EMAIL}" is invalid` },
      EMAIL,
    );

    expect(outcome).toEqual({
      kind: "failed",
      reason: '400: Email address "<correo>" is invalid',
    });
  });
});

describe("clasificación del envío", () => {
  it("sin error de Supabase el correo cuenta como pedido", () => {
    expect(toConfirmationEmailOutcome(null, EMAIL)).toEqual({
      kind: "requested",
    });
  });
});
