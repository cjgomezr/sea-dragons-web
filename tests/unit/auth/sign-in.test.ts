import { describe, expect, it, vi } from "vitest";
import type { AccountStatus } from "@/lib/auth/account-status";
import { COMPLETE_REGISTRATION_PATH, DASHBOARD_PATH } from "@/lib/auth/routes";
import {
  ACCOUNT_UNAVAILABLE_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  type SignInGateways,
  signIn,
} from "@/lib/auth/sign-in";

const CREDENTIALS = { email: "nerea@example.test", password: "bajoelagua" };
const USER_ID = "5f1a1d6e-7f2b-4f0d-9a4c-1b2c3d4e5f60";

function gatewaysFor(options: {
  readonly authenticated: boolean;
  readonly accountStatus?: AccountStatus | null;
}): SignInGateways {
  return {
    identities: {
      authenticate: vi
        .fn()
        .mockResolvedValue(
          options.authenticated
            ? { kind: "authenticated", userId: USER_ID }
            : { kind: "rejected" },
        ),
      discardSession: vi.fn().mockResolvedValue(undefined),
    },
    accounts: {
      findAccountStatus: vi
        .fn()
        .mockResolvedValue(options.accountStatus ?? null),
    },
  };
}

describe("inicio de sesión", () => {
  it("lleva al panel principal a una cuenta activa", async () => {
    const gateways = gatewaysFor({
      authenticated: true,
      accountStatus: "active",
    });

    const outcome = await signIn(gateways, CREDENTIALS);

    expect(outcome).toEqual({ kind: "signed-in", destination: DASHBOARD_PATH });
  });

  it("lleva a completar registro a una cuenta incompleta, no al panel", async () => {
    const gateways = gatewaysFor({
      authenticated: true,
      accountStatus: "incomplete",
    });

    const outcome = await signIn(gateways, CREDENTIALS);

    expect(outcome).toEqual({
      kind: "signed-in",
      destination: COMPLETE_REGISTRATION_PATH,
    });
  });

  it("rechaza unas credenciales que no valen", async () => {
    const gateways = gatewaysFor({ authenticated: false });

    const outcome = await signIn(gateways, CREDENTIALS);

    expect(outcome).toEqual({
      kind: "rejected",
      reason: "invalid_credentials",
      message: INVALID_CREDENTIALS_MESSAGE,
    });
  });

  it("responde lo mismo a un correo sin cuenta que a una contraseña equivocada", async () => {
    const unknownEmail = await signIn(gatewaysFor({ authenticated: false }), {
      email: "nadie@example.test",
      password: "bajoelagua",
    });
    const wrongPassword = await signIn(gatewaysFor({ authenticated: false }), {
      email: CREDENTIALS.email,
      password: "otracosa",
    });

    expect(unknownEmail).toEqual(wrongPassword);
  });

  it("no deja sesión abierta a una cuenta dada de baja", async () => {
    const gateways = gatewaysFor({
      authenticated: true,
      accountStatus: "inactive",
    });

    const outcome = await signIn(gateways, CREDENTIALS);

    expect(outcome).toEqual({
      kind: "rejected",
      reason: "account_unavailable",
      message: ACCOUNT_UNAVAILABLE_MESSAGE,
    });
    expect(gateways.identities.discardSession).toHaveBeenCalledOnce();
  });

  it("no deja sesión abierta a una identidad sin fila de miembro", async () => {
    const gateways = gatewaysFor({
      authenticated: true,
      accountStatus: null,
    });

    const outcome = await signIn(gateways, CREDENTIALS);

    expect(outcome).toEqual({
      kind: "rejected",
      reason: "account_unavailable",
      message: ACCOUNT_UNAVAILABLE_MESSAGE,
    });
    expect(gateways.identities.discardSession).toHaveBeenCalledOnce();
  });

  it("no pregunta por el estado de la cuenta cuando las credenciales no valen", async () => {
    const gateways = gatewaysFor({ authenticated: false });

    await signIn(gateways, CREDENTIALS);

    expect(gateways.accounts.findAccountStatus).not.toHaveBeenCalled();
  });
});
