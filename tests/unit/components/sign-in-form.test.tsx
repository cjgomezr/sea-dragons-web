import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInForm } from "@/components/auth/SignInForm";
import {
  DASHBOARD_PATH,
  PASSWORD_RECOVERY_PATH,
  REGISTRATION_PATH,
} from "@/lib/auth/routes";
import { INVALID_CREDENTIALS_MESSAGE } from "@/lib/auth/sign-in";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

type FetchCall = { readonly url: string; readonly body: unknown };

const calls: FetchCall[] = [];

function stubApi(
  response: { status: number; body: unknown } = {
    status: 200,
    body: { data: { destination: DASHBOARD_PATH } },
  },
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as unknown });
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

async function fillCredentials(password = "bajoelagua"): Promise<void> {
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText("Correo electrónico"),
    "nerea@example.test",
  );
  await user.type(screen.getByLabelText("Contraseña"), password);
}

function submitButton(): HTMLElement {
  return screen.getByRole("button", { name: "Entrar" });
}

describe("formulario de inicio de sesión", () => {
  beforeEach(() => {
    calls.length = 0;
    replace.mockClear();
    refresh.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pide correo y contraseña, cada uno con su etiqueta", () => {
    render(<SignInForm />);

    expect(screen.getByLabelText("Correo electrónico")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
  });

  it("lleva al destino que decide el servidor", async () => {
    stubApi({ status: 200, body: { data: { destination: "/dashboard" } } });
    render(<SignInForm />);
    await fillCredentials();

    await userEvent.click(submitButton());

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/dashboard");
    });
    expect(calls).toEqual([
      {
        url: "/api/v1/auth/session",
        body: { email: "nerea@example.test", password: "bajoelagua" },
      },
    ]);
  });

  it("refresca para que el servidor vuelva a renderizar ya con la sesión", async () => {
    stubApi();
    render(<SignInForm />);
    await fillCredentials();

    await userEvent.click(submitButton());

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("muestra el mensaje del servidor cuando las credenciales no valen", async () => {
    stubApi({
      status: 401,
      body: {
        error: {
          code: "unauthenticated",
          message: INVALID_CREDENTIALS_MESSAGE,
        },
      },
    });
    render(<SignInForm />);
    await fillCredentials("otracosa");

    await userEvent.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      INVALID_CREDENTIALS_MESSAGE,
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("no manda nada al servidor con los campos vacíos", async () => {
    stubApi();
    render(<SignInForm />);

    await userEvent.click(submitButton());

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("ofrece el camino a recuperar la contraseña y al registro", () => {
    render(<SignInForm />);

    expect(
      screen.getByRole("link", { name: /olvidaste tu contraseña/i }),
    ).toHaveAttribute("href", PASSWORD_RECOVERY_PATH);
    expect(
      screen.getByRole("link", { name: /crear una cuenta/i }),
    ).toHaveAttribute("href", REGISTRATION_PATH);
  });

  it("no dibuja los caminos de Google y Apple, aplazados a Release 2", () => {
    render(<SignInForm />);

    expect(screen.queryByRole("button", { name: /google/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /apple/i })).toBeNull();
  });
});
