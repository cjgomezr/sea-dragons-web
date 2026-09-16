import { describe, expect, it } from "vitest";
import {
  MAX_REGISTRATIONS_PER_BUCKET_PER_WINDOW,
  MAX_REGISTRATIONS_PER_EMAIL_PER_WINDOW,
  REGISTRATION_WINDOW_MINUTES,
  type RegistrationRequestLog,
  type RegistrationSubject,
  RegistrationRateLimitedError,
  enforceRegistrationRateLimit,
} from "@/lib/auth/registration-rate-limit";

/**
 * El límite del registro (#173): sin él, 80 peticiones con direcciones
 * inventadas agotan el cupo propio de correos y dejan al club 24 horas sin
 * confirmaciones.
 */

const NOW = new Date("2026-09-16T03:00:00.000Z");
const EMAIL = "nerea@example.test";
const BUCKET = "203.0.113.7";

type LogCall = {
  readonly subject: RegistrationSubject;
  readonly now: Date;
  readonly windowStart: Date;
};

type Recorder = {
  readonly log: RegistrationRequestLog;
  readonly calls: LogCall[];
};

/** Un doble que cuenta de verdad: anota cada petición y devuelve cuántas van
 * de ese sujeto, que es el contrato del puerto. */
function recordingLog(seed: Partial<Record<string, number>> = {}): Recorder {
  const calls: LogCall[] = [];
  const counts = new Map<string, number>(
    Object.entries(seed) as [string, number][],
  );
  return {
    calls,
    log: {
      async recordAndCountRecent(input) {
        calls.push(input);
        const key = `${input.subject.kind}:${input.subject.value}`;
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return next;
      },
    },
  };
}

function enforce(
  log: RegistrationRequestLog,
  overrides: { readonly bucket?: string; readonly email?: string } = {},
): Promise<void> {
  return enforceRegistrationRateLimit(log, {
    clientBucket: overrides.bucket ?? BUCKET,
    email: overrides.email ?? EMAIL,
    now: NOW,
  });
}

describe("límite del registro por procedencia", () => {
  it("deja pasar las peticiones que caben en la ventana", async () => {
    const { log } = recordingLog();

    for (
      let attempt = 0;
      attempt < MAX_REGISTRATIONS_PER_BUCKET_PER_WINDOW;
      attempt++
    ) {
      await expect(
        enforce(log, { email: `socio${attempt}@example.test` }),
      ).resolves.toBeUndefined();
    }
  });

  it("rechaza la petición siguiente al tope desde la misma procedencia", async () => {
    const { log } = recordingLog({
      [`ip:${BUCKET}`]: MAX_REGISTRATIONS_PER_BUCKET_PER_WINDOW,
    });

    await expect(enforce(log)).rejects.toBeInstanceOf(
      RegistrationRateLimitedError,
    );
  });

  it("dice cuánto esperar, que es la ventana del límite", async () => {
    const { log } = recordingLog({
      [`ip:${BUCKET}`]: MAX_REGISTRATIONS_PER_BUCKET_PER_WINDOW,
    });

    await expect(enforce(log)).rejects.toMatchObject({
      retryAfterMinutes: REGISTRATION_WINDOW_MINUTES,
    });
  });

  it("deja pasar la misma dirección desde otra procedencia", async () => {
    const { log } = recordingLog({
      [`ip:${BUCKET}`]: MAX_REGISTRATIONS_PER_BUCKET_PER_WINDOW,
    });

    await expect(
      enforce(log, { bucket: "198.51.100.4" }),
    ).resolves.toBeUndefined();
  });

  it("mide la ventana desde el instante que se le pasa", async () => {
    const { log, calls } = recordingLog();

    await enforce(log);

    const esperada = new Date(
      NOW.getTime() - REGISTRATION_WINDOW_MINUTES * 60_000,
    );
    expect(calls.map((call) => call.windowStart)).toEqual([esperada, esperada]);
    expect(calls.map((call) => call.now)).toEqual([NOW, NOW]);
  });

  it("no cuenta la petición rechazada contra la dirección", async () => {
    const { log, calls } = recordingLog({
      [`ip:${BUCKET}`]: MAX_REGISTRATIONS_PER_BUCKET_PER_WINDOW,
    });

    await expect(enforce(log)).rejects.toBeInstanceOf(
      RegistrationRateLimitedError,
    );
    expect(calls.map((call) => call.subject.kind)).toEqual(["ip"]);
  });
});

describe("límite del registro por dirección", () => {
  it("rechaza la petición siguiente al tope aunque cambie la procedencia", async () => {
    const { log } = recordingLog({
      [`email:${EMAIL}`]: MAX_REGISTRATIONS_PER_EMAIL_PER_WINDOW,
    });

    await expect(
      enforce(log, { bucket: "198.51.100.4" }),
    ).rejects.toBeInstanceOf(RegistrationRateLimitedError);
  });

  it("deja pasar otra dirección desde la misma procedencia", async () => {
    const { log } = recordingLog({
      [`email:${EMAIL}`]: MAX_REGISTRATIONS_PER_EMAIL_PER_WINDOW,
    });

    await expect(
      enforce(log, { email: "otra@example.test" }),
    ).resolves.toBeUndefined();
  });

  it("cuenta la dirección y la procedencia como dos sujetos distintos", async () => {
    const { log, calls } = recordingLog();

    await enforce(log);

    expect(calls.map((call) => call.subject)).toEqual([
      { kind: "ip", value: BUCKET },
      { kind: "email", value: EMAIL },
    ]);
  });
});

describe("el motivo del rechazo no delata direcciones", () => {
  it("no nombra el correo en el mensaje del error", async () => {
    const { log } = recordingLog({
      [`email:${EMAIL}`]: MAX_REGISTRATIONS_PER_EMAIL_PER_WINDOW,
    });

    const error = await enforce(log).catch((thrown: unknown) => thrown);

    expect(String(error)).not.toContain(EMAIL);
  });
});

describe("el límite falla ruidosamente", () => {
  it("propaga el fallo de la tabla en vez de dejar pasar la petición", async () => {
    const rota: RegistrationRequestLog = {
      async recordAndCountRecent() {
        throw new Error("no se pudo anotar la petición");
      },
    };

    await expect(enforce(rota)).rejects.toThrow(
      "no se pudo anotar la petición",
    );
  });
});
