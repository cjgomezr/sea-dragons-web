import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailConfirmationResult } from "@/lib/auth/email-confirmation";

const CONFIRM_URL = "http://localhost/auth/confirmar";
const TOKEN_HASH = "un-token-de-confirmacion";

type ConfirmArgs = { tokenHash: string; type: string };

const confirmCalls: ConfirmArgs[] = [];

function mockDependencies(
  options: {
    readonly result?: EmailConfirmationResult;
    readonly unconfigured?: readonly string[];
  } = {},
): void {
  vi.doMock("@/lib/auth/supabase-auth-gateways", () => ({
    describeMissingAuthKeys: (missingKeys: readonly string[]) =>
      `faltan ${missingKeys.join(", ")}`,
    createSupabaseAuthGateways: () =>
      options.unconfigured
        ? { kind: "unconfigured", missingKeys: options.unconfigured }
        : { kind: "ready", gateways: {} },
  }));
  vi.doMock("@/lib/auth/email-confirmation", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/auth/email-confirmation")>()),
    confirmEmailAndActivate: async (
      _gateways: unknown,
      input: { tokenHash: string; type: string },
    ) => {
      confirmCalls.push({ tokenHash: input.tokenHash, type: input.type });
      return options.result ?? { kind: "activated" };
    },
  }));
}

async function openConfirmationLink(query: string): Promise<Response> {
  const { GET } = await import("@/app/auth/confirmar/route");
  return GET(new NextRequest(`${CONFIRM_URL}${query}`));
}

function locationOf(response: Response): string {
  const location = response.headers.get("location");
  if (location === null) {
    throw new Error("La respuesta no redirige a ninguna parte.");
  }
  return new URL(location).pathname + new URL(location).search;
}

describe("GET /auth/confirmar", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/auth/supabase-auth-gateways");
    vi.doUnmock("@/lib/auth/email-confirmation");
    confirmCalls.length = 0;
  });

  it("canjea el enlace y lleva a la pantalla que anuncia la cuenta activa", async () => {
    mockDependencies();

    const response = await openConfirmationLink(
      `?token_hash=${TOKEN_HASH}&type=signup`,
    );

    expect(confirmCalls).toEqual([{ tokenHash: TOKEN_HASH, type: "signup" }]);
    expect(locationOf(response)).toBe("/registro?confirmacion=ok");
  });

  it("avisa de que todavía falta algo si la cuenta no quedó activa", async () => {
    mockDependencies({ result: { kind: "confirmed_still_incomplete" } });

    const response = await openConfirmationLink(
      `?token_hash=${TOKEN_HASH}&type=signup`,
    );

    expect(locationOf(response)).toBe("/registro?confirmacion=pendiente");
  });

  it("trata un enlace caducado o ya usado como enlace inválido", async () => {
    mockDependencies({
      result: { kind: "rejected", reason: "Token has expired" },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await openConfirmationLink(
      `?token_hash=${TOKEN_HASH}&type=signup`,
    );

    expect(locationOf(response)).toBe("/registro?confirmacion=invalida");
  });

  it("no canjea nada si el enlace llega sin token", async () => {
    mockDependencies();

    const response = await openConfirmationLink("?type=signup");

    expect(confirmCalls).toEqual([]);
    expect(locationOf(response)).toBe("/registro?confirmacion=invalida");
  });

  it("no canjea nada si el tipo del enlace no confirma ningún correo", async () => {
    mockDependencies();

    const response = await openConfirmationLink(
      `?token_hash=${TOKEN_HASH}&type=recovery`,
    );

    expect(confirmCalls).toEqual([]);
    expect(locationOf(response)).toBe("/registro?confirmacion=invalida");
  });

  it("distingue un servidor sin configurar de un enlace que no vale", async () => {
    mockDependencies({ unconfigured: ["SUPABASE_SERVICE_ROLE_KEY"] });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await openConfirmationLink(
      `?token_hash=${TOKEN_HASH}&type=signup`,
    );

    expect(locationOf(response)).toBe("/registro?confirmacion=error");
  });
});
