import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegistrationForm } from "@/components/auth/RegistrationForm";
import {
  CONFIRMATION_EMAIL_API_PATH,
  REGISTER_API_PATH,
} from "@/lib/auth/routes";
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
    expect(calls[0]?.url).toBe(REGISTER_API_PATH);
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

  it("cambia la pista de la contraseña por el error, en vez de apilar las dos", async () => {
    stubApi();
    const user = userEvent.setup();
    renderForm();

    await fillValidForm();
    expect(screen.getByText("Al menos 8 caracteres.")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Contraseña"));
    await user.type(screen.getByLabelText("Contraseña"), "1234567");
    await user.click(submitButton());

    await screen.findByRole("alert");
    expect(
      screen.queryByText("Al menos 8 caracteres."),
    ).not.toBeInTheDocument();
  });

  it("deshabilita el botón mientras el registro está en vuelo", async () => {
    let releaseResponse = (): void => {};
    const held = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await held;
        return new Response(
          JSON.stringify({
            data: { outcome: "confirmation_pending", email: "n@example.test" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    renderForm();

    await fillValidForm();
    await userEvent.setup().click(submitButton());

    await waitFor(() => expect(submitButton()).toBeDisabled());
    releaseResponse();
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
      url: CONFIRMATION_EMAIL_API_PATH,
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

const PENDING_RESPONSE = new Response(
  JSON.stringify({
    data: { outcome: "confirmation_pending", email: "nerea@example.test" },
  }),
  { status: 200, headers: { "content-type": "application/json" } },
);

type ResendReply = "ok" | "http_error" | "network_error";

/** El registro siempre sale bien; el reenvío responde lo que pida el test. */
function stubRegistrationThenResend(resend: ResendReply): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === REGISTER_API_PATH) {
        return PENDING_RESPONSE.clone();
      }
      switch (resend) {
        case "ok":
          return PENDING_RESPONSE.clone();
        case "http_error":
          return new Response("{}", { status: 500 });
        case "network_error":
          throw new Error("ECONNREFUSED 127.0.0.1:3417");
      }
    }),
  );
}

async function registerThroughForm(): Promise<void> {
  renderForm();
  await fillValidForm();
  await userEvent.setup().click(submitButton());
  await screen.findByRole("heading", { name: /confirma tu correo/i });
}

async function clickResend(): Promise<void> {
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Reenviar el correo" }));
}

describe("pantalla de confirmación", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dice que mandamos un enlace y que, si no llega en unos minutos, se puede reenviar desde ahí", async () => {
    stubRegistrationThenResend("ok");

    await registerThroughForm();

    expect(screen.getByText(/te mandamos un enlace/i)).toBeInTheDocument();
    expect(
      screen.getByText(/si no te llega en unos minutos/i),
    ).toHaveTextContent(/reenv/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("un reenvío que responde bien dice que el enlace va en camino", async () => {
    stubRegistrationThenResend("ok");
    await registerThroughForm();

    await clickResend();

    expect(await screen.findByRole("status")).toHaveTextContent(/en camino/i);
  });

  it("con un fallo de red del reenvío muestra su mensaje propio", async () => {
    stubRegistrationThenResend("network_error");
    await registerThroughForm();

    await clickResend();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no pudimos pedir otro correo/i);
    expect(alert).toHaveTextContent(/conexión/i);
    expect(alert).not.toHaveTextContent(/crear tu cuenta/i);
    expect(alert).not.toHaveTextContent("ECONNREFUSED");
  });

  it("con un error HTTP del reenvío muestra su mensaje propio", async () => {
    stubRegistrationThenResend("http_error");
    await registerThroughForm();

    await clickResend();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no pudimos pedir otro correo/i);
    expect(alert).not.toHaveTextContent(/crear tu cuenta/i);
  });
});

type ReceiptOutcome = "confirmation_pending" | "email_unavailable";

function receiptResponse(outcome: ReceiptOutcome): Response {
  return new Response(
    JSON.stringify({ data: { outcome, email: "nerea@example.test" } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** El registro responde `registration`; cada reenvío, el siguiente de
 * `resends`. Apunta a qué endpoint fue cada petición. */
function stubDelivery(
  registration: ReceiptOutcome,
  resends: readonly ReceiptOutcome[] = [],
): void {
  const pendingResends = [...resends];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as unknown });
      if (url === REGISTER_API_PATH) {
        return receiptResponse(registration);
      }
      const next = pendingResends.shift();
      if (next === undefined) {
        throw new Error("el test no preparó respuesta para otro reenvío");
      }
      return receiptResponse(next);
    }),
  );
}

async function clickRetry(): Promise<void> {
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Reintentar el envío" }));
}

describe("pantalla de confirmación con el envío no disponible", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("avisa que ahora no se pueden mandar correos y que lo intente más tarde", async () => {
    stubDelivery("email_unavailable");

    await registerThroughForm();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/ahora no podemos mandar correos/i);
    expect(alert).toHaveTextContent(/más tarde/i);
  });

  it("no dice que el enlace ya salió", async () => {
    stubDelivery("email_unavailable");

    await registerThroughForm();

    expect(
      screen.queryByText(/te mandamos un enlace/i),
    ).not.toBeInTheDocument();
  });

  it("ofrece reintentar el envío", async () => {
    stubDelivery("email_unavailable");

    await registerThroughForm();

    expect(
      screen.getByRole("button", { name: "Reintentar el envío" }),
    ).toBeEnabled();
  });

  it("con el envío disponible muestra el texto neutro del #147, sin aviso ni reintento", async () => {
    stubDelivery("confirmation_pending");

    await registerThroughForm();

    expect(screen.getByText(/te mandamos un enlace/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reintentar el envío" }),
    ).not.toBeInTheDocument();
  });

  it("reintentar pide el envío al endpoint del reenvío con la dirección", async () => {
    stubDelivery("email_unavailable", ["email_unavailable"]);
    await registerThroughForm();

    await clickRetry();

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({
      url: CONFIRMATION_EMAIL_API_PATH,
      body: { email: "nerea@example.test" },
    });
  });

  it("si al reintentar ya se puede mandar, quita el aviso y dice que el enlace va en camino", async () => {
    stubDelivery("email_unavailable", ["confirmation_pending"]);
    await registerThroughForm();

    await clickRetry();

    expect(await screen.findByRole("status")).toHaveTextContent(/en camino/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("si al reintentar sigue sin poder mandar, mantiene el aviso y dice que lo intentó", async () => {
    stubDelivery("email_unavailable", ["email_unavailable"]);
    await registerThroughForm();

    await clickRetry();

    expect(await screen.findByRole("status")).toHaveTextContent(/todavía no/i);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /ahora no podemos mandar correos/i,
    );
  });

  it("un reenvío que responde que no se puede mandar cambia la pantalla al aviso", async () => {
    stubDelivery("confirmation_pending", ["email_unavailable"]);
    await registerThroughForm();

    await clickResend();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /ahora no podemos mandar correos/i,
    );
    expect(
      screen.getByRole("button", { name: "Reintentar el envío" }),
    ).toBeInTheDocument();
  });
});
