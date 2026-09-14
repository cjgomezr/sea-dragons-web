import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordRecoveryRequestForm } from "@/components/auth/PasswordRecoveryRequestForm";
import { PASSWORD_RECOVERY_API_PATH, SIGN_IN_PATH } from "@/lib/auth/routes";

type FetchCall = { readonly url: string; readonly body: unknown };

const calls: FetchCall[] = [];

function stubApi(response: { status: number; body: unknown }): void {
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

function stubRequested(email: string): void {
  stubApi({
    status: 200,
    body: { data: { outcome: "recovery_requested", email } },
  });
}

async function requestLinkFor(email: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Correo electrónico"), email);
  await user.click(screen.getByRole("button", { name: "Enviar enlace" }));
}

describe("formulario para pedir el enlace de recuperación", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pide el correo y lo manda al endpoint de recuperación", async () => {
    stubRequested("nerea@example.test");
    render(<PasswordRecoveryRequestForm />);

    await requestLinkFor("nerea@example.test");

    expect(
      await screen.findByRole("heading", { name: "Revisa tu correo" }),
    ).toBeInTheDocument();
    expect(calls).toEqual([
      {
        url: PASSWORD_RECOVERY_API_PATH,
        body: { email: "nerea@example.test" },
      },
    ]);
  });

  it("confirma el envío con el mismo texto exista o no la cuenta", async () => {
    stubRequested("nerea@example.test");
    const registered = render(<PasswordRecoveryRequestForm />);
    await requestLinkFor("nerea@example.test");
    await screen.findByRole("heading", { name: "Revisa tu correo" });
    const registeredText = registered.container.textContent;
    registered.unmount();
    vi.unstubAllGlobals();

    stubRequested("nerea@example.test");
    const unknown = render(<PasswordRecoveryRequestForm />);
    await requestLinkFor("nerea@example.test");
    await screen.findByRole("heading", { name: "Revisa tu correo" });

    expect(unknown.container.textContent).toBe(registeredText);
  });

  it("dice cuánto vive el enlace y que sirve una sola vez", async () => {
    stubRequested("nerea@example.test");
    render(<PasswordRecoveryRequestForm />);

    await requestLinkFor("nerea@example.test");

    const confirmation = await screen.findByRole("region", {
      name: "Revisa tu correo",
    });
    expect(confirmation).toHaveTextContent(/60 minutos/);
    expect(confirmation).toHaveTextContent(/una sola vez/);
  });

  it("muestra el aviso de esperar cuando el servidor responde 429", async () => {
    const waitMessage =
      "Pediste varios enlaces seguidos. Espera 15 minutos antes de pedir otro.";
    stubApi({
      status: 429,
      body: { error: { code: "rate_limited", message: waitMessage } },
    });
    render(<PasswordRecoveryRequestForm />);

    await requestLinkFor("nerea@example.test");

    expect(await screen.findByRole("alert")).toHaveTextContent(waitMessage);
    expect(
      screen.queryByRole("heading", { name: "Revisa tu correo" }),
    ).toBeNull();
  });

  it("no confirma nada cuando el envío falla en el servidor", async () => {
    stubApi({
      status: 500,
      body: { error: { code: "internal_error", message: "Ocurrió un error" } },
    });
    render(<PasswordRecoveryRequestForm />);

    await requestLinkFor("nerea@example.test");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Revisa tu correo" }),
    ).toBeNull();
  });

  it("no manda nada al servidor con el correo vacío", async () => {
    stubRequested("");
    render(<PasswordRecoveryRequestForm />);

    await userEvent.click(
      screen.getByRole("button", { name: "Enviar enlace" }),
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("ofrece volver a la entrada", () => {
    render(<PasswordRecoveryRequestForm />);

    expect(
      screen.getByRole("link", { name: "Volver a entrar" }),
    ).toHaveAttribute("href", SIGN_IN_PATH);
  });
});
