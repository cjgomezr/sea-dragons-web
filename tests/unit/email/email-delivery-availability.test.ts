import { describe, expect, expectTypeOf, it } from "vitest";
import {
  EMAIL_BUDGET_WINDOW_HOURS,
  type EmailDeliveryAvailabilityCheck,
  type EmailProviderStatus,
  type EmailSendBudget,
  MAX_EMAIL_REQUESTS_PER_WINDOW,
  createEmailDeliveryAvailabilityCheck,
} from "@/lib/email/email-delivery-availability";
import type { EmailSenderConnection } from "@/lib/email/resend-email-sender";

const NOW = new Date("2026-09-16T10:00:00.000Z");
const MILLISECONDS_PER_HOUR = 3_600_000;

const CONNECTED: EmailSenderConnection = {
  kind: "connected",
  sender: {
    sendEmail: async () => {
      throw new Error("comprobar la disponibilidad no manda ningún correo");
    },
  },
};

type Recorded = {
  probes: number;
  readonly countedSince: Date[];
  readonly recordedAt: Date[];
};

function checkWith(options: {
  readonly connection?: EmailSenderConnection;
  readonly provider?: EmailProviderStatus;
  readonly requestsInWindow?: number;
}): {
  readonly check: EmailDeliveryAvailabilityCheck;
  readonly recorded: Recorded;
} {
  const recorded: Recorded = { probes: 0, countedSince: [], recordedAt: [] };
  const budget: EmailSendBudget = {
    async countSince(windowStart) {
      recorded.countedSince.push(windowStart);
      return options.requestsInWindow ?? 0;
    },
    async recordRequest(now) {
      recorded.recordedAt.push(now);
    },
  };
  const check = createEmailDeliveryAvailabilityCheck({
    connection: options.connection ?? CONNECTED,
    provider: {
      async probeProvider() {
        recorded.probes += 1;
        return options.provider ?? { kind: "reachable" };
      },
    },
    budget,
  });
  return { check, recorded };
}

describe("disponibilidad del envío", () => {
  // La señal que ve cualquiera no puede depender de la cuenta: si lo hiciera,
  // sería el mismo oráculo que el #147 cerró. Por eso ni siquiera recibe la
  // dirección, y sus dependencias no incluyen nada que consulte cuentas.
  it("se decide sin recibir la dirección: sólo el instante", () => {
    const { check } = checkWith({});

    expectTypeOf(check.checkAvailability).parameters.toEqualTypeOf<[Date]>();
    expect(check.checkAvailability).toHaveLength(1);
  });

  it("con el proveedor conectado, contestando y cupo libre, está disponible", async () => {
    const doubles = checkWith({ requestsInWindow: 3 });

    await expect(doubles.check.checkAvailability(NOW)).resolves.toEqual({
      kind: "available",
    });
  });

  it("cuenta el cupo en la ventana de un día hacia atrás", async () => {
    const doubles = checkWith({});

    await doubles.check.checkAvailability(NOW);

    expect(doubles.recorded.countedSince).toEqual([
      new Date(
        NOW.getTime() - EMAIL_BUDGET_WINDOW_HOURS * MILLISECONDS_PER_HOUR,
      ),
    ]);
  });

  it("cuando está disponible anota la petición en el cupo", async () => {
    const doubles = checkWith({});

    await doubles.check.checkAvailability(NOW);

    expect(doubles.recorded.recordedAt).toEqual([NOW]);
  });

  it("sin el proveedor configurado no está disponible, y no sondea ni gasta cupo", async () => {
    const doubles = checkWith({
      connection: { kind: "not_connected", reason: "faltan RESEND_API_KEY" },
    });

    const availability = await doubles.check.checkAvailability(NOW);

    expect(availability).toEqual({
      kind: "unavailable",
      reason: "faltan RESEND_API_KEY",
    });
    expect(doubles.recorded.probes).toBe(0);
    expect(doubles.recorded.recordedAt).toEqual([]);
  });

  it("con el proveedor caído no está disponible, nombra el motivo y no gasta cupo", async () => {
    const doubles = checkWith({
      provider: { kind: "unreachable", reason: "Resend respondió 503" },
    });

    const availability = await doubles.check.checkAvailability(NOW);

    expect(availability).toEqual({
      kind: "unavailable",
      reason: "Resend respondió 503",
    });
    expect(doubles.recorded.recordedAt).toEqual([]);
  });

  it("con el cupo propio agotado no está disponible, sin sondear ni anotar", async () => {
    const doubles = checkWith({
      requestsInWindow: MAX_EMAIL_REQUESTS_PER_WINDOW,
    });

    const availability = await doubles.check.checkAvailability(NOW);

    expect(availability.kind).toBe("unavailable");
    expect(doubles.recorded.probes).toBe(0);
    expect(doubles.recorded.recordedAt).toEqual([]);
  });

  it("con una petición menos que el tope sigue disponible", async () => {
    const doubles = checkWith({
      requestsInWindow: MAX_EMAIL_REQUESTS_PER_WINDOW - 1,
    });

    await expect(doubles.check.checkAvailability(NOW)).resolves.toEqual({
      kind: "available",
    });
  });
});
