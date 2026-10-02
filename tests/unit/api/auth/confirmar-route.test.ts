import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailConfirmationResult } from "@/lib/auth/email-confirmation";

/**
 * El enlace del correo se abre con un GET, y los escáneres de enlaces del
 * correo de empresa (Safe Links y similares) lo abren antes que la persona
 * (#477). Por eso el GET sólo pinta el botón y el canje del token de un solo
 * uso vive en el POST que manda ese botón.
 */
const APP_ORIGIN = "http://localhost";
const REDEEM_URL = `${APP_ORIGIN}/auth/confirmar/canjear`;
const TOKEN_HASH = "un-token-de-confirmacion";
const SEE_OTHER = 303;
const FORBIDDEN = 403;

type ConfirmArgs = { tokenHash: string; type: string };

const confirmCalls: ConfirmArgs[] = [];

function mockDependencies(
  options: {
    readonly result?: EmailConfirmationResult;
    readonly throws?: Error;
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
      if (options.throws) {
        throw options.throws;
      }
      return options.result ?? { kind: "activated" };
    },
  }));
}

async function pressConfirmButton(
  fields: Readonly<Record<string, string>>,
  origin: string | null = APP_ORIGIN,
): Promise<Response> {
  const { POST } = await import("@/app/(auth)/auth/confirmar/canjear/route");
  const headers = new Headers({
    "content-type": "application/x-www-form-urlencoded",
  });
  if (origin !== null) {
    headers.set("origin", origin);
  }
  return POST(
    new NextRequest(REDEEM_URL, {
      method: "POST",
      headers,
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

function locationOf(response: Response): string {
  const location = response.headers.get("location");
  if (location === null) {
    throw new Error("La respuesta no redirige a ninguna parte.");
  }
  return new URL(location).pathname + new URL(location).search;
}

const VALID_FIELDS = { token_hash: TOKEN_HASH, type: "signup" } as const;

describe("POST /auth/confirmar/canjear", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/auth/supabase-auth-gateways");
    vi.doUnmock("@/lib/auth/email-confirmation");
    vi.restoreAllMocks();
    confirmCalls.length = 0;
  });

  it("canjea el token y lleva a la pantalla que anuncia la cuenta activa", async () => {
    mockDependencies();

    const response = await pressConfirmButton(VALID_FIELDS);

    expect(confirmCalls).toEqual([{ tokenHash: TOKEN_HASH, type: "signup" }]);
    expect(locationOf(response)).toBe("/registro?confirmacion=ok");
  });

  it("redirige con 303 para que el navegador pida la pantalla con un GET", async () => {
    mockDependencies();

    const response = await pressConfirmButton(VALID_FIELDS);

    expect(response.status).toBe(SEE_OTHER);
  });

  it("avisa de que todavía falta algo si la cuenta no quedó activa", async () => {
    mockDependencies({ result: { kind: "confirmed_still_incomplete" } });

    const response = await pressConfirmButton(VALID_FIELDS);

    expect(locationOf(response)).toBe("/registro?confirmacion=pendiente");
  });

  it("trata un token caducado o ya canjeado como enlace inválido", async () => {
    mockDependencies({
      result: { kind: "rejected", reason: "Token has expired" },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await pressConfirmButton(VALID_FIELDS);

    expect(locationOf(response)).toBe("/registro?confirmacion=invalida");
  });

  it("no canjea nada si el formulario llega sin token", async () => {
    mockDependencies();

    const response = await pressConfirmButton({ type: "signup" });

    expect(confirmCalls).toEqual([]);
    expect(locationOf(response)).toBe("/registro?confirmacion=invalida");
  });

  it("no canjea nada si el tipo no confirma ningún correo", async () => {
    mockDependencies();

    const response = await pressConfirmButton({
      token_hash: TOKEN_HASH,
      type: "recovery",
    });

    expect(confirmCalls).toEqual([]);
    expect(locationOf(response)).toBe("/registro?confirmacion=invalida");
  });

  it("rechaza el POST que llega desde otro origen sin canjear nada", async () => {
    mockDependencies();

    const response = await pressConfirmButton(
      VALID_FIELDS,
      "https://otro-sitio.example",
    );

    expect(response.status).toBe(FORBIDDEN);
    expect(confirmCalls).toEqual([]);
  });

  it("rechaza el POST que no dice de qué origen viene", async () => {
    mockDependencies();

    const response = await pressConfirmButton(VALID_FIELDS, null);

    expect(response.status).toBe(FORBIDDEN);
    expect(confirmCalls).toEqual([]);
  });

  it("no deja al visitante en una página de error si el servidor falla al canjear", async () => {
    mockDependencies({ throws: new Error("members read failed") });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await pressConfirmButton(VALID_FIELDS);

    expect(locationOf(response)).toBe("/registro?confirmacion=error");
  });

  it("distingue un servidor sin configurar de un enlace que no vale", async () => {
    mockDependencies({ unconfigured: ["SUPABASE_SERVICE_ROLE_KEY"] });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await pressConfirmButton(VALID_FIELDS);

    expect(locationOf(response)).toBe("/registro?confirmacion=error");
  });
});
