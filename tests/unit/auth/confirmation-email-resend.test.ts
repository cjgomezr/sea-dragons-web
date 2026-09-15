import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_EMAIL_WINDOW_MINUTES,
  type ConfirmationEmailResendOutcome,
  MAX_CONFIRMATION_EMAILS_PER_WINDOW,
  resendConfirmationEmail,
} from "@/lib/auth/confirmation-email-resend";
import type { EmailRequestLog } from "@/lib/auth/email-request-log";
import type {
  ConfirmationEmailGateway,
  ConfirmationEmailOutcome,
} from "@/lib/auth/register-member";
import type {
  EmailDeliveryAvailability,
  EmailDeliveryAvailabilityCheck,
} from "@/lib/email/email-delivery-availability";

const EMAIL = "nerea@example.test";
const APP_URL =
  "https://victoria-seadragons.vercel.app/api/v1/auth/confirmation-email";
const NOW = new Date("2026-09-14T10:00:00.000Z");
const MILLISECONDS_PER_MINUTE = 60_000;

type Recorded = {
  readonly logged: { email: string; now: Date; windowStart: Date }[];
  readonly requested: string[];
  readonly availabilityChecks: Date[];
};

function doublesWith(options: {
  readonly requestsInWindow: number;
  readonly delivery?: ConfirmationEmailOutcome;
  readonly emailDelivery?: EmailDeliveryAvailability;
}): {
  readonly recorded: Recorded;
  readonly requests: EmailRequestLog;
  readonly confirmationEmail: ConfirmationEmailGateway;
  readonly emailDelivery: EmailDeliveryAvailabilityCheck;
} {
  const recorded: Recorded = {
    logged: [],
    requested: [],
    availabilityChecks: [],
  };
  return {
    recorded,
    emailDelivery: {
      async checkAvailability(now) {
        recorded.availabilityChecks.push(now);
        return options.emailDelivery ?? { kind: "available" };
      },
    },
    requests: {
      async recordAndCountRecent(input) {
        recorded.logged.push({ ...input });
        return options.requestsInWindow;
      },
    },
    confirmationEmail: {
      async requestConfirmationEmail(email) {
        recorded.requested.push(email);
        return options.delivery ?? { kind: "requested" };
      },
    },
  };
}

/** Ejecuta la entrega que la ruta deja para después de responder. Falla si no
 * había entrega pendiente. */
async function deliverPending(
  outcome: ConfirmationEmailResendOutcome,
): Promise<ConfirmationEmailOutcome> {
  if (outcome.kind !== "accepted") {
    throw new Error(
      `Se esperaba una entrega pendiente y llegó ${outcome.kind}.`,
    );
  }
  return outcome.deliver();
}

describe("límite del reenvío de la confirmación", () => {
  it("al entregar pide el correo y devuelve lo que pasó con el envío", async () => {
    const doubles = doublesWith({
      requestsInWindow: MAX_CONFIRMATION_EMAILS_PER_WINDOW,
      delivery: { kind: "not_requested" },
    });

    const outcome = await resendConfirmationEmail(doubles, {
      email: EMAIL,
      now: NOW,
      appUrl: APP_URL,
    });

    await expect(deliverPending(outcome)).resolves.toEqual({
      kind: "not_requested",
    });
    expect(doubles.recorded.requested).toEqual([EMAIL]);
  });

  // Pedir el correo depende de la cuenta. Si la respuesta lo esperara, lo que
  // tarda delataría qué direcciones tienen una confirmación pendiente.
  it("dentro del límite no pide el correo hasta que se entrega", async () => {
    const doubles = doublesWith({ requestsInWindow: 1 });

    const outcome = await resendConfirmationEmail(doubles, {
      email: EMAIL,
      now: NOW,
      appUrl: APP_URL,
    });

    expect(outcome.kind).toBe("accepted");
    expect(doubles.recorded.requested).toEqual([]);
  });

  it("anota la petición con la ventana que cuenta", async () => {
    const doubles = doublesWith({ requestsInWindow: 1 });

    await resendConfirmationEmail(doubles, {
      email: EMAIL,
      now: NOW,
      appUrl: APP_URL,
    });

    expect(doubles.recorded.logged).toEqual([
      {
        email: EMAIL,
        now: NOW,
        windowStart: new Date(
          NOW.getTime() -
            CONFIRMATION_EMAIL_WINDOW_MINUTES * MILLISECONDS_PER_MINUTE,
        ),
      },
    ]);
  });

  // Emitir un enlace invalida el anterior y gasta cupo del proveedor, que
  // comparte con la recuperación de contraseña. Pasado el tope no se toca
  // ninguno de los dos.
  it("superado el límite no pide ningún correo y dice cuánto esperar", async () => {
    const doubles = doublesWith({
      requestsInWindow: MAX_CONFIRMATION_EMAILS_PER_WINDOW + 1,
    });

    const outcome = await resendConfirmationEmail(doubles, {
      email: EMAIL,
      now: NOW,
      appUrl: APP_URL,
    });

    expect(outcome).toEqual({
      kind: "rate_limited",
      retryAfterMinutes: CONFIRMATION_EMAIL_WINDOW_MINUTES,
    });
    expect(doubles.recorded.requested).toEqual([]);
  });

  // El límite por dirección se responde antes: una ráfaga contra una sola
  // dirección no debe gastar el cupo que comparten todas.
  it("superado el límite no pregunta por la disponibilidad del envío", async () => {
    const doubles = doublesWith({
      requestsInWindow: MAX_CONFIRMATION_EMAILS_PER_WINDOW + 1,
    });

    await resendConfirmationEmail(doubles, {
      email: EMAIL,
      now: NOW,
      appUrl: APP_URL,
    });

    expect(doubles.recorded.availabilityChecks).toEqual([]);
  });
});

describe("reenvío con el envío no disponible", () => {
  const UNAVAILABLE: EmailDeliveryAvailability = {
    kind: "unavailable",
    reason: "Resend respondió 503",
  };

  it("dice que no se puede mandar, con el motivo, y no deja entrega pendiente", async () => {
    const doubles = doublesWith({
      requestsInWindow: 1,
      emailDelivery: UNAVAILABLE,
    });

    const outcome = await resendConfirmationEmail(doubles, {
      email: EMAIL,
      now: NOW,
      appUrl: APP_URL,
    });

    expect(outcome).toEqual({
      kind: "email_unavailable",
      reason: "Resend respondió 503",
    });
    expect(doubles.recorded.requested).toEqual([]);
  });

  it("pregunta por la disponibilidad con el instante de la petición", async () => {
    const doubles = doublesWith({ requestsInWindow: 1 });

    await resendConfirmationEmail(doubles, {
      email: EMAIL,
      now: NOW,
      appUrl: APP_URL,
    });

    expect(doubles.recorded.availabilityChecks).toEqual([NOW]);
  });
});
