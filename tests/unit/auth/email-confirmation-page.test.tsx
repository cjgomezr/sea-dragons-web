import { render, screen } from "@testing-library/react";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/lib/i18n/locale";

/**
 * Abrir el enlace del correo (#477) es un GET que puede hacer un escáner de
 * enlaces antes que la persona. La pantalla sólo pinta el botón: el token de
 * un solo uso se canjea cuando alguien lo pulsa.
 */
const TOKEN_HASH = "un-token-de-confirmacion";
const APP_ORIGIN = "http://localhost";

class RedirectSignal extends Error {
  constructor(readonly destination: string) {
    super(`redirect ${destination}`);
  }
}

const requestLocale = { current: "en" as Locale };
const confirmCalls: string[] = [];

vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new RedirectSignal(destination);
  },
}));

vi.mock("@/lib/i18n/request-locale", () => ({
  readRequestLocale: async () => requestLocale.current,
}));

vi.mock("@/lib/auth/supabase-auth-gateways", () => ({
  describeMissingAuthKeys: () => "",
  createSupabaseAuthGateways: () => ({ kind: "ready", gateways: {} }),
}));

vi.mock("@/lib/auth/email-confirmation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/email-confirmation")>()),
  confirmEmailAndActivate: async (
    _gateways: unknown,
    input: { tokenHash: string },
  ) => {
    confirmCalls.push(input.tokenHash);
    return { kind: "activated" };
  },
}));

async function openConfirmationLink(
  query: Record<string, string>,
): Promise<void> {
  const { default: EmailConfirmationPage } =
    await import("@/app/(auth)/auth/confirmar/page");
  render(await EmailConfirmationPage({ searchParams: Promise.resolve(query) }));
}

async function redirectOf(
  query: Record<string, string>,
): Promise<string | null> {
  try {
    await openConfirmationLink(query);
    return null;
  } catch (error) {
    if (error instanceof RedirectSignal) {
      return error.destination;
    }
    throw error;
  }
}

function hiddenValue(form: HTMLFormElement, name: string): string | null {
  const field = form.elements.namedItem(name);
  return field instanceof HTMLInputElement ? field.value : null;
}

const VALID_LINK = { token_hash: TOKEN_HASH, type: "signup" } as const;

describe("GET /auth/confirmar", () => {
  beforeEach(() => {
    requestLocale.current = "en";
    confirmCalls.length = 0;
  });

  it("pinta el botón para confirmar sin canjear el token", async () => {
    await openConfirmationLink(VALID_LINK);

    expect(
      screen.getByRole("button", { name: "Confirm my email" }),
    ).toBeInTheDocument();
    expect(confirmCalls).toEqual([]);
  });

  it("lleva el token y el tipo del enlace al POST que los canjea", async () => {
    await openConfirmationLink(VALID_LINK);

    const form = screen.getByRole("button").closest("form");
    if (form === null) {
      throw new Error("El botón no está dentro de un formulario.");
    }
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/auth/confirmar/canjear");
    expect(hiddenValue(form, "token_hash")).toBe(TOKEN_HASH);
    expect(hiddenValue(form, "type")).toBe("signup");
  });

  it("habla español a quien eligió español", async () => {
    requestLocale.current = "es";

    await openConfirmationLink(VALID_LINK);

    expect(
      screen.getByRole("heading", { name: "Confirma tu correo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirmar mi correo" }),
    ).toBeInTheDocument();
  });

  it("manda al aviso de enlace inválido si el enlace llega sin token", async () => {
    const destination = await redirectOf({ type: "signup" });

    expect(destination).toBe("/registro?confirmacion=invalida");
    expect(confirmCalls).toEqual([]);
  });

  it("manda al aviso de enlace inválido si el tipo no confirma ningún correo", async () => {
    const destination = await redirectOf({
      token_hash: TOKEN_HASH,
      type: "recovery",
    });

    expect(destination).toBe("/registro?confirmacion=invalida");
    expect(confirmCalls).toEqual([]);
  });

  it("confirma con el botón aunque el enlace se haya abierto dos veces antes", async () => {
    await openConfirmationLink(VALID_LINK);
    await openConfirmationLink(VALID_LINK);
    const { POST } = await import("@/app/(auth)/auth/confirmar/canjear/route");

    const response = await POST(
      new NextRequest(`${APP_ORIGIN}/auth/confirmar/canjear`, {
        method: "POST",
        headers: {
          origin: APP_ORIGIN,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(VALID_LINK).toString(),
      }),
    );

    expect(confirmCalls).toEqual([TOKEN_HASH]);
    expect(response.headers.get("location")).toBe(
      `${APP_ORIGIN}/registro?confirmacion=ok`,
    );
  });
});
