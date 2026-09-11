import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegistrationForm } from "@/components/auth/RegistrationForm";
import { listCountryOptions } from "@/lib/geo/countries";

// Las mismas opciones que calcula la página en el servidor: el componente ya
// no las genera, las recibe.
const COUNTRIES = listCountryOptions("es");

function renderForm(): void {
  render(<RegistrationForm countries={COUNTRIES} />);
}

type FetchCall = { url: string; body: unknown };

const calls: FetchCall[] = [];

function stubApi(
  response: { status: number; body: unknown } = {
    status: 200,
    body: {
      data: { outcome: "confirmation_pending", email: "nerea@example.test" },
    },
  },
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        body: JSON.parse(String(init.body)) as unknown,
      });
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

async function fillValidForm(): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Nombre completo"), "Nerea Silva");
  await user.type(
    screen.getByLabelText("Correo electrónico"),
    "nerea@example.test",
  );
  await user.selectOptions(screen.getByLabelText("País"), "AU");
  await user.selectOptions(screen.getByLabelText("Tipo de membresía"), "Full");
  await user.type(screen.getByLabelText("Fecha de nacimiento"), "1994-03-02");
  await user.type(screen.getByLabelText("Contraseña"), "bajoelagua");
}

function submitButton(): HTMLElement {
  return screen.getByRole("button", { name: "Crear cuenta" });
}

describe("formulario de registro", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pide los datos que exige FR-001, cada uno con su etiqueta", () => {
    renderForm();

    for (const label of [
      "Nombre completo",
      "Correo electrónico",
      "País",
      "Fecha de nacimiento",
      "Tipo de membresía",
      "Contraseña",
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("ofrece exactamente los tres tipos de membresía del SRD", () => {
    renderForm();
    const options = screen
      .getAllByRole("option")
      .filter((option) =>
        ["Full", "Student", "Casual"].includes(
          (option as HTMLOptionElement).value,
        ),
      );

    expect(options).toHaveLength(3);
  });

  it("envía el registro al endpoint de la API v1", async () => {
    stubApi();
    renderForm();

    await fillValidForm();
    await userEvent.setup().click(submitButton());

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.url).toBe("/api/v1/auth/register");
    expect(calls[0]?.body).toEqual({
      fullName: "Nerea Silva",
      email: "nerea@example.test",
      country: "AU",
      password: "bajoelagua",
      membershipType: "Full",
      dateOfBirth: "1994-03-02",
    });
  });

  it("rechaza una contraseña de 7 caracteres sin llamar al servidor", async () => {
    stubApi();
    const user = userEvent.setup();
    renderForm();

    await fillValidForm();
    await user.clear(screen.getByLabelText("Contraseña"));
    await user.type(screen.getByLabelText("Contraseña"), "1234567");
    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("8");
    expect(calls).toEqual([]);
  });

  it("no envía el formulario sin país", async () => {
    stubApi();
    const user = userEvent.setup();
    renderForm();

    await fillValidForm();
    await user.selectOptions(screen.getByLabelText("País"), "");
    await user.click(submitButton());

    await screen.findByRole("alert");
    expect(calls).toEqual([]);
  });

  it("marca como inválido el campo que falló", async () => {
    stubApi();
    const user = userEvent.setup();
    renderForm();

    await fillValidForm();
    await user.clear(screen.getByLabelText("Contraseña"));
    await user.type(screen.getByLabelText("Contraseña"), "corta");
    await user.click(submitButton());

    await screen.findByRole("alert");
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("tras registrarse dice que falta confirmar el correo y lo nombra", async () => {
    stubApi();
    renderForm();

    await fillValidForm();
    await userEvent.setup().click(submitButton());

    expect(
      await screen.findByRole("heading", { name: /confirma tu correo/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/nerea@example\.test/)).toBeInTheDocument();
  });

  it("ofrece reenviar el correo de confirmación", async () => {
    stubApi();
    const user = userEvent.setup();
    renderForm();

    await fillValidForm();
    await user.click(submitButton());
    await user.click(
      await screen.findByRole("button", { name: "Reenviar el correo" }),
    );

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({
      url: "/api/v1/auth/confirmation-email",
      body: { email: "nerea@example.test" },
    });
  });

  it("muestra el mensaje del servidor cuando rechaza el registro", async () => {
    stubApi({
      status: 422,
      body: {
        error: {
          code: "business_rule",
          message: "membershipType: no es un tipo válido.",
        },
      },
    });
    renderForm();

    await fillValidForm();
    await userEvent.setup().click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "membershipType",
    );
  });

  it("avisa sin filtrar detalles técnicos si la red falla", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED 127.0.0.1:3417");
      }),
    );
    renderForm();

    await fillValidForm();
    await userEvent.setup().click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/conexión/i);
    expect(alert).not.toHaveTextContent("ECONNREFUSED");
  });
});
