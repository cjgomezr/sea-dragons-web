import { describe, expect, it } from "vitest";
import { readEmbeddedMembershipSummary } from "@/lib/membership/supabase-membership-gateways";

/**
 * Lo que la ficha del Admin (#457) lee de la membresía embebida en la fila del
 * socio: el estado que cuenta hoy y, si está exento, el motivo y la fecha de
 * fin de la exención.
 */

const NOW = new Date("2026-10-04T00:00:00.000Z");
const WAIVED_UNTIL = "2027-02-28T13:00:00+00:00";

function embeddedRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    status: "waived",
    stripe_subscription_id: null,
    trial_end: null,
    current_period_end: null,
    waived_until: WAIVED_UNTIL,
    waived_reason: "Entrenador",
    ...overrides,
  };
}

describe("readEmbeddedMembershipSummary", () => {
  it("trae el motivo y la fecha de fin de una exención vigente", () => {
    expect(readEmbeddedMembershipSummary(embeddedRow(), NOW)).toEqual({
      status: "waived",
      waiver: {
        reason: "Entrenador",
        until: new Date(WAIVED_UNTIL).toISOString(),
      },
    });
  });

  it("trae una exención sin fecha de fin", () => {
    expect(
      readEmbeddedMembershipSummary(embeddedRow({ waived_until: null }), NOW),
    ).toEqual({
      status: "waived",
      waiver: { reason: "Entrenador", until: null },
    });
  });

  it("no trae una exención vencida, y el estado vale lo que digan sus fechas", () => {
    expect(
      readEmbeddedMembershipSummary(
        embeddedRow({ waived_until: "2026-09-01T00:00:00+00:00" }),
        NOW,
      ),
    ).toEqual({ status: "pending", waiver: null });
  });

  it("trae el estado sin exención de una membresía que no está exenta", () => {
    expect(
      readEmbeddedMembershipSummary(
        [embeddedRow({ status: "active", waived_reason: null })],
        NOW,
      ),
    ).toEqual({ status: "active", waiver: null });
  });

  it("trae un estado nulo a quien no tiene membresía", () => {
    expect(readEmbeddedMembershipSummary(null, NOW)).toEqual({
      status: null,
      waiver: null,
    });
  });
});
