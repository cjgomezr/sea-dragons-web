import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_EMAIL_WINDOW_MINUTES,
  MAX_CONFIRMATION_EMAILS_PER_WINDOW,
  resendConfirmationEmail,
} from "@/lib/auth/confirmation-email-resend";
import type { EmailRequestLog } from "@/lib/auth/email-request-log";
import type {
  ConfirmationEmailGateway,
  ConfirmationEmailOutcome,
} from "@/lib/auth/register-member";

const EMAIL = "nerea@example.test";
const APP_URL =
  "https://victoria-seadragons.vercel.app/api/v1/auth/confirmation-email";
const NOW = new Date("2026-09-14T10:00:00.000Z");
const MILLISECONDS_PER_MINUTE = 60_000;

type Recorded = {
  readonly logged: { email: string; now: Date; windowStart: Date }[];
  readonly requested: string[];
};

function doublesWith(options: {
  readonly requestsInWindow: number;
  readonly delivery?: ConfirmationEmailOutcome;
}): {
  readonly recorded: Recorded;
  readonly requests: EmailRequestLog;
  readonly confirmationEmail: ConfirmationEmailGateway;
} {
  const recorded: Recorded = { logged: [], requested: [] };
  return {
    recorded,
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

describe("límite del reenvío de la confirmación", () => {
  it("dentro del límite pide el correo y devuelve lo que pasó con el envío", async () => {
    const doubles = doublesWith({
      requestsInWindow: MAX_CONFIRMATION_EMAILS_PER_WINDOW,
      delivery: { kind: "not_requested" },
    });

    const outcome = await resendConfirmationEmail(doubles, {
      email: EMAIL,
      now: NOW,
      appUrl: APP_URL,
    });

    expect(outcome).toEqual({
      kind: "attempted",
      delivery: { kind: "not_requested" },
    });
    expect(doubles.recorded.requested).toEqual([EMAIL]);
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
});
