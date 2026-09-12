import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { SIGN_IN_PATH } from "@/lib/auth/routes";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

type FetchCall = { readonly url: string; readonly method: string | undefined };

const calls: FetchCall[] = [];

function stubApi(status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method });
      return new Response(JSON.stringify({ data: { signedOut: true } }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

function button(): HTMLElement {
  return screen.getByRole("button", { name: "Cerrar sesión" });
}

describe("cierre de sesión", () => {
  beforeEach(() => {
    calls.length = 0;
    replace.mockClear();
    refresh.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tira la sesión contra el endpoint de la API", async () => {
    stubApi();
    render(<SignOutButton />);

    await userEvent.click(button());

    await waitFor(() => {
      expect(calls).toEqual([
        { url: "/api/v1/auth/session", method: "DELETE" },
      ]);
    });
  });

  it("aterriza en la pantalla de entrada", async () => {
    stubApi();
    render(<SignOutButton />);

    await userEvent.click(button());

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(SIGN_IN_PATH);
    });
  });

  it("lleva igualmente a la entrada si el servidor no contesta bien, porque quedarse dentro sería peor", async () => {
    stubApi(500);
    render(<SignOutButton />);

    await userEvent.click(button());

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(SIGN_IN_PATH);
    });
  });

  it("en texto dice lo mismo que el icono, y hace lo mismo", async () => {
    stubApi();
    render(<SignOutButton appearance="text" />);

    await userEvent.click(button());

    await waitFor(() => {
      expect(calls).toEqual([
        { url: "/api/v1/auth/session", method: "DELETE" },
      ]);
    });
    expect(replace).toHaveBeenCalledWith(SIGN_IN_PATH);
  });
});
