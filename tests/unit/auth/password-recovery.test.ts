import { describe, expect, it, vi } from "vitest";
import {
  MAX_RECOVERY_REQUESTS_PER_WINDOW,
  PASSWORD_RECOVERY_WINDOW_MINUTES,
  type PasswordRecoveryRequestGateways,
  type PasswordRecoveryRequestOutcome,
  type PasswordResetGateways,
  RecoveryEmailDeliveryError,
  type RecoveryTokenRedemption,
  requestPasswordRecovery,
  resetPassword,
} from "@/lib/auth/password-recovery";
import { validateRegistration } from "@/lib/auth/registration";

const REGISTERED_EMAIL = "nerea@example.test";
const UNKNOWN_EMAIL = "nadie@example.test";
const TOKEN_HASH = "9c1e0f7a3b2d4c5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7a8b9c";
const USER_ID = "5f1a1d6e-7f2b-4f0d-9a4c-1b2c3d4e5f60";
const NOW = new Date("2026-09-14T09:00:00Z");
const NEW_PASSWORD = "bajoelagua-nueva";

function buildResetUrl(tokenHash: string): string {
  return `https://club.example.test/recuperar-contrasena/nueva?token_hash=${tokenHash}`;
}

function requestGateways(
  options: {
    readonly requestsInWindow?: number;
    readonly failDelivery?: Error;
  } = {},
): PasswordRecoveryRequestGateways {
  return {
    requests: {
      recordAndCountRecent: vi
        .fn()
        .mockResolvedValue(options.requestsInWindow ?? 1),
    },
    tokens: {
      issueRecoveryToken: vi.fn(async (email: string) =>
        email === REGISTERED_EMAIL
          ? { kind: "issued" as const, tokenHash: TOKEN_HASH }
          : { kind: "no_account" as const },
      ),
    },
    emails: {
      sendRecoveryEmail: options.failDelivery
        ? vi.fn().mockRejectedValue(options.failDelivery)
        : vi.fn().mockResolvedValue(undefined),
    },
  };
}

function resetGateways(
  redemption: RecoveryTokenRedemption = {
    kind: "password_changed",
    userId: USER_ID,
  },
): PasswordResetGateways {
  return {
    tokens: { redeemRecoveryToken: vi.fn().mockResolvedValue(redemption) },
    audit: { recordPasswordChanged: vi.fn().mockResolvedValue(undefined) },
  };
}

/** Ejecuta la entrega que la ruta deja para después de responder. Falla si no
 * había entrega pendiente, para que ninguna prueba dé por bueno un envío que
 * nunca se intentó. */
async function deliverPending(
  outcome: PasswordRecoveryRequestOutcome,
): Promise<void> {
  if (outcome.kind !== "accepted") {
    throw new Error(`Se esperaba una entrega pendiente y llegó ${outcome.kind}.`);
  }
  await outcome.deliver();
}

describe("recuperación de contraseña", () => {
  it("con un correo registrado emite el enlace hacia ese correo y confirma el envío", async () => {
    const gateways = requestGateways();

    const outcome = await requestPasswordRecovery(gateways, {
      email: REGISTERED_EMAIL,
      now: NOW,
      buildResetUrl,
    });

    await deliverPending(outcome);
    expect(gateways.emails.sendRecoveryEmail).toHaveBeenCalledWith({
      to: REGISTERED_EMAIL,
      resetUrl: buildResetUrl(TOKEN_HASH),
    });
  });

  // La respuesta no puede esperar a nada que dependa de la cuenta: mandar el
  // correo sólo a cuentas reales las delataría por lo que tarda en responder.
  it("dentro del límite no mira la cuenta ni manda nada hasta que se entrega", async () => {
    const gateways = requestGateways();

    const outcome = await requestPasswordRecovery(gateways, {
      email: REGISTERED_EMAIL,
      now: NOW,
      buildResetUrl,
    });

    expect(outcome.kind).toBe("accepted");
    expect(gateways.tokens.issueRecoveryToken).not.toHaveBeenCalled();
    expect(gateways.emails.sendRecoveryEmail).not.toHaveBeenCalled();
  });

  it("con un correo inexistente la respuesta es idéntica y no se emite nada", async () => {
    const registered = await requestPasswordRecovery(requestGateways(), {
      email: REGISTERED_EMAIL,
      now: NOW,
      buildResetUrl,
    });
    const gateways = requestGateways();

    const unknown = await requestPasswordRecovery(gateways, {
      email: UNKNOWN_EMAIL,
      now: NOW,
      buildResetUrl,
    });

    expect(unknown.kind).toBe(registered.kind);
    await deliverPending(unknown);
    expect(gateways.emails.sendRecoveryEmail).not.toHaveBeenCalled();
  });

  it("cuenta la petición en la ventana que pide el límite, exista o no la cuenta", async () => {
    const gateways = requestGateways();

    await requestPasswordRecovery(gateways, {
      email: UNKNOWN_EMAIL,
      now: NOW,
      buildResetUrl,
    });

    expect(gateways.requests.recordAndCountRecent).toHaveBeenCalledWith({
      email: UNKNOWN_EMAIL,
      now: NOW,
      windowStart: new Date(
        NOW.getTime() - PASSWORD_RECOVERY_WINDOW_MINUTES * 60_000,
      ),
    });
  });

  it("superado el límite de peticiones, responde pidiendo esperar", async () => {
    const gateways = requestGateways({
      requestsInWindow: MAX_RECOVERY_REQUESTS_PER_WINDOW + 1,
    });

    const outcome = await requestPasswordRecovery(gateways, {
      email: REGISTERED_EMAIL,
      now: NOW,
      buildResetUrl,
    });

    expect(outcome).toEqual({
      kind: "rate_limited",
      retryAfterMinutes: PASSWORD_RECOVERY_WINDOW_MINUTES,
    });
    expect(gateways.tokens.issueRecoveryToken).not.toHaveBeenCalled();
    expect(gateways.emails.sendRecoveryEmail).not.toHaveBeenCalled();
  });

  it("deja pasar la última petición que cabe en el límite", async () => {
    const gateways = requestGateways({
      requestsInWindow: MAX_RECOVERY_REQUESTS_PER_WINDOW,
    });

    const outcome = await requestPasswordRecovery(gateways, {
      email: REGISTERED_EMAIL,
      now: NOW,
      buildResetUrl,
    });

    expect(outcome.kind).toBe("accepted");
  });

  it("si el envío falla, la entrega sube el error con contexto", async () => {
    const cause = new Error("el proveedor respondió 500");
    const gateways = requestGateways({ failDelivery: cause });
    const outcome = await requestPasswordRecovery(gateways, {
      email: REGISTERED_EMAIL,
      now: NOW,
      buildResetUrl,
    });

    const attempt = deliverPending(outcome);

    await expect(attempt).rejects.toBeInstanceOf(RecoveryEmailDeliveryError);
    await expect(attempt).rejects.toThrow(/el proveedor respondió 500/);
    await expect(attempt).rejects.toHaveProperty("cause", cause);
  });

  it("cambia la contraseña con un enlace válido", async () => {
    const gateways = resetGateways();

    const outcome = await resetPassword(gateways, {
      tokenHash: TOKEN_HASH,
      password: NEW_PASSWORD,
    });

    expect(outcome).toEqual({ kind: "password_changed" });
    expect(gateways.tokens.redeemRecoveryToken).toHaveBeenCalledWith({
      tokenHash: TOKEN_HASH,
      newPassword: NEW_PASSWORD,
    });
  });

  it("el enlace usado una vez ya no vale", async () => {
    const gateways = resetGateways({ kind: "link_unusable" });

    const outcome = await resetPassword(gateways, {
      tokenHash: TOKEN_HASH,
      password: NEW_PASSWORD,
    });

    expect(outcome).toEqual({ kind: "link_unusable" });
    expect(gateways.audit.recordPasswordChanged).not.toHaveBeenCalled();
  });

  it("rechaza la contraseña corta con el mismo mensaje que el registro, sin gastar el enlace", async () => {
    const shortPassword = "1234567";
    const registration = validateRegistration(
      {
        fullName: "Nerea Silva",
        email: REGISTERED_EMAIL,
        country: "AU",
        password: shortPassword,
        membershipType: "Full",
        dateOfBirth: "1994-03-02",
      },
      { now: NOW },
    );
    const registrationMessage = registration.ok
      ? null
      : registration.issues.find((issue) => issue.field === "password")
          ?.message;
    const gateways = resetGateways();

    const outcome = await resetPassword(gateways, {
      tokenHash: TOKEN_HASH,
      password: shortPassword,
    });

    expect(registrationMessage).toMatch(/8/);
    expect(outcome).toEqual({
      kind: "invalid_password",
      message: registrationMessage,
    });
    expect(gateways.tokens.redeemRecoveryToken).not.toHaveBeenCalled();
  });

  it("la bitácora registra el cambio con la identidad y nada más", async () => {
    const gateways = resetGateways();

    await resetPassword(gateways, {
      tokenHash: TOKEN_HASH,
      password: NEW_PASSWORD,
    });

    expect(gateways.audit.recordPasswordChanged).toHaveBeenCalledWith(USER_ID);
  });

  it("si el servicio no acepta la contraseña nueva, lo dice y no audita ningún cambio", async () => {
    const gateways = resetGateways({ kind: "password_rejected" });

    const outcome = await resetPassword(gateways, {
      tokenHash: TOKEN_HASH,
      password: NEW_PASSWORD,
    });

    expect(outcome).toEqual({ kind: "password_rejected" });
    expect(gateways.audit.recordPasswordChanged).not.toHaveBeenCalled();
  });
});
