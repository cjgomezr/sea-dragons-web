import { describe, expect, it } from "vitest";
import { readEmbeddedMembershipSummary } from "@/lib/membership/supabase-membership-gateways";

/**
 * Lo que la ficha del Admin (#457) lee de la membresía embebida en la fila del
 * socio: el estado que cuenta hoy y, si está exento, el motivo y la fecha de
 * fin de la exención. Desde #770, también el plan, y desde #774 el día del
 * club en que se renueva, con la regla del próximo cobro de Pagos.
 */

const NOW = new Date("2026-10-04T00:00:00.000Z");
const WAIVED_UNTIL = "2027-02-28T13:00:00+00:00";

function embeddedRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    plan: "Full",
    status: "waived",
    stripe_subscription_id: null,
    trial_end: null,
    current_period_end: null,
    waived_until: WAIVED_UNTIL,
    waived_reason: "Entrenador",
    scheduled_plan: null,
    scheduled_at: null,
    ...overrides,
  };
}

describe("readEmbeddedMembershipSummary", () => {
  it("trae el motivo y la fecha de fin de una exención vigente", () => {
    expect(readEmbeddedMembershipSummary(embeddedRow(), NOW)).toEqual({
      status: "waived",
      plan: "Full",
      renewsOn: null,
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
      plan: "Full",
      renewsOn: null,
      waiver: { reason: "Entrenador", until: null },
    });
  });

  it("no trae una exención vencida, y el estado vale lo que digan sus fechas", () => {
    expect(
      readEmbeddedMembershipSummary(
        embeddedRow({ waived_until: "2026-09-01T00:00:00+00:00" }),
        NOW,
      ),
    ).toEqual({
      status: "pending",
      plan: "Full",
      renewsOn: null,
      waiver: null,
    });
  });

  it("trae el estado sin exención de una membresía que no está exenta", () => {
    expect(
      readEmbeddedMembershipSummary(
        [embeddedRow({ status: "active", waived_reason: null })],
        NOW,
      ),
    ).toEqual({ status: "active", plan: "Full", renewsOn: null, waiver: null });
  });

  it("trae el día del club en que se renueva una membresía activa (#774)", () => {
    expect(
      readEmbeddedMembershipSummary(
        embeddedRow({
          status: "active",
          stripe_subscription_id: "sub_1",
          // Medianoche y media en Melbourne del 30 de junio.
          current_period_end: "2027-06-29T14:30:00+00:00",
          waived_until: null,
          waived_reason: null,
        }),
        NOW,
      ),
    ).toMatchObject({ status: "active", renewsOn: "2027-06-30" });
  });

  it("trae el fin de la prueba como el día de la renovación (#774)", () => {
    expect(
      readEmbeddedMembershipSummary(
        embeddedRow({
          status: "trialing",
          stripe_subscription_id: "sub_1",
          trial_end: "2026-10-20T00:00:00+00:00",
          waived_until: null,
          waived_reason: null,
        }),
        NOW,
      ),
    ).toMatchObject({ status: "trialing", renewsOn: "2026-10-20" });
  });

  it("no trae renovación a quien pasa a Casual al acabar el periodo (#774)", () => {
    expect(
      readEmbeddedMembershipSummary(
        embeddedRow({
          status: "active",
          stripe_subscription_id: "sub_1",
          current_period_end: "2027-06-29T14:30:00+00:00",
          waived_until: null,
          waived_reason: null,
          scheduled_plan: "Casual",
          scheduled_at: "2027-06-29T14:30:00+00:00",
        }),
        NOW,
      ),
    ).toMatchObject({ status: "active", renewsOn: null });
  });

  it("trae el plan en null a quien todavía no eligió ninguno", () => {
    expect(
      readEmbeddedMembershipSummary(
        embeddedRow({ plan: null, status: "pending", waived_reason: null }),
        NOW,
      ),
    ).toMatchObject({ plan: null });
  });

  it("trae un estado nulo a quien no tiene membresía", () => {
    expect(readEmbeddedMembershipSummary(null, NOW)).toEqual({
      status: null,
      waiver: null,
      plan: null,
      renewsOn: null,
    });
  });
});
