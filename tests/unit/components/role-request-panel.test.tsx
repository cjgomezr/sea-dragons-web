import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountHeader } from "@/components/account/AccountHeader";
import { RoleRequestPanel } from "@/components/account/RoleRequestPanel";
import {
  JUSTIFICATION_MAX_LENGTH,
  type RoleRequest,
} from "@/lib/auth/role-request";
import { ROLE_REQUESTS_API_PATH } from "@/lib/auth/routes";

/**
 * Mi cuenta (#209): quién soy, qué rol tengo y, si me toca, el formulario para
 * pedir Coach o Committee. Lo que la pantalla ofrece sale de la misma función
 * del dominio que decide qué acepta el servidor.
 */

const PENDING_COACH: RoleRequest = {
  id: "0f0e0d0c-0b0a-4908-8706-050403020100",
  requestedRole: "Coach",
  status: "pending",
  // 18:30 en Melbourne.
  createdAt: "2026-09-17T08:30:00.000Z",
};

type FetchCall = { readonly url: string; readonly body: unknown };

const calls: FetchCall[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubApi(respond: () => Promise<Response>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return respond();
    }),
  );
}

function stubCreated(request: RoleRequest = PENDING_COACH): void {
  stubApi(async () => jsonResponse(201, { data: request }));
}

function stubError(status: number, code: string, reason?: string): void {
  stubApi(async () =>
    jsonResponse(status, { error: { code, message: "x", reason } }),
  );
}

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("página Mi cuenta", () => {
  it("muestra el nombre, sus iniciales y el rol actual", () => {
    render(<AccountHeader locale="en" fullName="Nerea Ruiz" role="Coach" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Nerea Ruiz" }),
    ).toBeInTheDocument();
    expect(screen.getByText("NR")).toBeInTheDocument();
    expect(screen.getByText("Role: Coach")).toBeInTheDocument();
  });

  it("nombra el rol en el idioma de la visita", () => {
    render(<AccountHeader locale="es" fullName="Nerea Ruiz" role="Player" />);

    expect(screen.getByText("Rol: Jugador")).toBeInTheDocument();
  });

  it("sin solicitud, un Player ve el formulario con Coach y Committee", () => {
    render(<RoleRequestPanel locale="en" role="Player" latestRequest={null} />);

    expect(screen.getByRole("radio", { name: "Coach" })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Committee" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Why do you want this role? (optional)"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send request" }),
    ).toBeInTheDocument();
  });

  it("un Coach sólo puede pedir Committee", () => {
    render(<RoleRequestPanel locale="en" role="Coach" latestRequest={null} />);

    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "Committee" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Coach" })).toBeNull();
  });

  it("con una pendiente muestra el rol pedido, la fecha y el estado, sin formulario", () => {
    render(
      <RoleRequestPanel
        locale="en"
        role="Player"
        latestRequest={PENDING_COACH}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Request pending" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "You asked to be Coach on 17 September 2026 at 6:30 pm. An Admin hasn't answered yet.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send request" })).toBeNull();
  });

  it("tras un rechazo vuelve a mostrar el formulario", () => {
    render(
      <RoleRequestPanel
        locale="en"
        role="Player"
        latestRequest={{ ...PENDING_COACH, status: "rejected" }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Send request" }),
    ).toBeInTheDocument();
  });

  it("un Admin ve por qué no tiene nada que pedir, sin formulario", () => {
    render(<RoleRequestPanel locale="en" role="Admin" latestRequest={null} />);

    expect(
      screen.getByText(
        "As an Admin you already have every capability, so there is no role to request.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("en español, la solicitud pendiente sale entera en español", () => {
    render(
      <RoleRequestPanel
        locale="es"
        role="Player"
        latestRequest={{ ...PENDING_COACH, requestedRole: "Committee" }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Solicitud pendiente" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/^Pediste ser Comité el 17 de septiembre de 2026/),
    ).toBeInTheDocument();
  });
});

describe("envío del formulario", () => {
  it("manda el rol y la justificación, y pasa a mostrar la pendiente sin recargar", async () => {
    const user = userEvent.setup();
    stubCreated();
    render(<RoleRequestPanel locale="en" role="Player" latestRequest={null} />);

    await user.click(screen.getByRole("radio", { name: "Coach" }));
    await user.type(
      screen.getByLabelText("Why do you want this role? (optional)"),
      "I coach the juniors.",
    );
    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(
      await screen.findByRole("heading", { name: "Request pending" }),
    ).toBeInTheDocument();
    expect(calls).toEqual([
      {
        url: ROLE_REQUESTS_API_PATH,
        body: { requestedRole: "Coach", justification: "I coach the juniors." },
      },
    ]);
  });

  it("desactiva el botón mientras se envía", async () => {
    const user = userEvent.setup();
    let answer: (response: Response) => void = () => undefined;
    stubApi(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    render(<RoleRequestPanel locale="en" role="Coach" latestRequest={null} />);

    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    await act(async () => {
      answer(jsonResponse(201, { data: PENDING_COACH }));
    });
  });

  it("un doble clic produce una sola petición", async () => {
    const user = userEvent.setup();
    stubCreated();
    render(<RoleRequestPanel locale="en" role="Coach" latestRequest={null} />);

    await user.dblClick(screen.getByRole("button", { name: "Send request" }));

    await screen.findByRole("heading", { name: "Request pending" });
    expect(calls).toHaveLength(1);
  });

  it("pide elegir un rol antes de enviar nada", async () => {
    const user = userEvent.setup();
    stubCreated();
    render(<RoleRequestPanel locale="en" role="Player" latestRequest={null} />);

    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose the role you want to request.",
    );
    expect(calls).toEqual([]);
  });

  it("avisa de una justificación larga en cuanto se escribe, y no la envía", async () => {
    const user = userEvent.setup();
    stubCreated();
    render(<RoleRequestPanel locale="en" role="Coach" latestRequest={null} />);
    const justification = screen.getByLabelText(
      "Why do you want this role? (optional)",
    );

    await user.click(justification);
    await user.paste("a".repeat(JUSTIFICATION_MAX_LENGTH + 1));

    expect(
      screen.getByText(
        `The note can be at most ${JUSTIFICATION_MAX_LENGTH} characters. Shorten it to send the request.`,
      ),
    ).toBeInTheDocument();
    expect(justification).toHaveAttribute("aria-invalid", "true");

    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(calls).toEqual([]);
  });

  it("cuenta los caracteres de la justificación contra el límite", async () => {
    const user = userEvent.setup();
    render(<RoleRequestPanel locale="en" role="Coach" latestRequest={null} />);

    await user.type(
      screen.getByLabelText("Why do you want this role? (optional)"),
      "Hola",
    );

    expect(screen.getByText("4/500")).toBeInTheDocument();
  });

  it("con un error de red muestra el mensaje y deja volver a intentar", async () => {
    const user = userEvent.setup();
    stubApi(async () => {
      throw new TypeError("Failed to fetch");
    });
    render(<RoleRequestPanel locale="en" role="Coach" latestRequest={null} />);

    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server",
    );
    stubCreated();
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(
      await screen.findByRole("heading", { name: "Request pending" }),
    ).toBeInTheDocument();
  });

  it.each([
    [409, "conflict", undefined, "You already have a request waiting"],
    [422, "business_rule", "role_already_held", "You already have that role."],
    [
      422,
      "business_rule",
      "admin_has_every_capability",
      "As an Admin you already have every capability",
    ],
    [400, "validation_error", undefined, "at most 500 characters"],
    [401, "unauthenticated", undefined, "Your session has ended"],
    [500, "internal_error", undefined, "We couldn't send the request"],
  ])(
    "traduce por su código la respuesta %i %s (%s)",
    async (status, code, reason, message) => {
      const user = userEvent.setup();
      stubError(status, code, reason);
      render(
        <RoleRequestPanel locale="en" role="Coach" latestRequest={null} />,
      );

      await user.click(screen.getByRole("button", { name: "Send request" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
    },
  );

  it("en español, el error sale en español", async () => {
    const user = userEvent.setup();
    stubError(409, "conflict");
    render(<RoleRequestPanel locale="es" role="Coach" latestRequest={null} />);

    await user.click(screen.getByRole("button", { name: "Enviar solicitud" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Ya tienes una solicitud esperando respuesta",
      ),
    );
  });
});
