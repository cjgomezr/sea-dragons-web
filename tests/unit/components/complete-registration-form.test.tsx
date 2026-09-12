import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompleteRegistrationForm } from "@/components/auth/CompleteRegistrationForm";
import type { PendingRequirement } from "@/lib/auth/account-activation";
import { ACCOUNT_API_PATH, DASHBOARD_PATH } from "@/lib/auth/routes";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

/**
 * La pantalla que ve una cuenta `incomplete`. Lo que este test vigila sobre
 * todo es que pida SÓLO lo que falta: un formulario que vuelva a pedir el
 * nombre y el correo que la persona ya dio es el defecto que el ticket nombra.
 */

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

const COUNTRIES = [
  { code: "AU", name: "Australia" },
  { code: "ES", name: "España" },
] as const;

const EMAIL = "nerea@example.test";

type FetchCall = { readonly url: string; readonly body: unknown };

const calls: FetchCall[] = [];

function stubApi(
  response: { status: number; body: unknown } = {
    status: 200,
    body: { data: { accountStatus: "active", pending: [] } },
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

function renderForm(pending: readonly PendingRequirement[]): void {
  render(
    <CompleteRegistrationForm
      pending={pending}
      countries={COUNTRIES}
      email={EMAIL}
    />,
  );
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "Guardar y continuar" });
}

beforeEach(() => {
  calls.length = 0;
  replace.mockClear();
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("completar registro: pide solo lo que falta", () => {
  it("pide el tipo de membresía y nada más cuando es lo único que falta", () => {
    renderForm(["membershipType"]);

    expect(screen.getByLabelText("Tipo de membresía")).toBeInTheDocument();
    expect(screen.queryByLabelText("País")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Fecha de nacimiento"),
    ).not.toBeInTheDocument();
  });

  it("pide los tres cuando faltan los tres", () => {
    renderForm(["country", "dateOfBirth", "membershipType"]);

    expect(screen.getByLabelText("País")).toBeInTheDocument();
    expect(screen.getByLabelText("Fecha de nacimiento")).toBeInTheDocument();
    expect(screen.getByLabelText("Tipo de membresía")).toBeInTheDocument();
  });

  it("nunca vuelve a pedir el nombre, el correo ni la contraseña", () => {
    renderForm(["country", "dateOfBirth", "membershipType"]);

    expect(screen.queryByLabelText("Nombre completo")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Correo electrónico"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();
  });

  it("no dibuja ningún campo cuando lo único pendiente es confirmar el correo", () => {
    renderForm(["emailConfirmation"]);

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(saveButton).toThrow();
  });

  it("dice qué correo hay que confirmar y ofrece reenviarlo", () => {
    renderForm(["emailConfirmation"]);

    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reenviar el correo" }),
    ).toBeInTheDocument();
  });

  // La frontera manda aquí todo lo que pida una cuenta incompleta, así que la
  // pantalla nunca puede quedarse sin nada que ofrecer.
  it("no deja un callejón sin salida cuando no queda nada pendiente", () => {
    renderForm([]);

    expect(
      screen.getByRole("link", { name: "Ir al panel" }),
    ).toHaveAttribute("href", DASHBOARD_PATH);
    expect(saveButton).toThrow();
  });

  it("ofrece cerrar sesión, que es la otra única cosa que esta cuenta puede hacer", () => {
    renderForm(["membershipType"]);

    expect(
      screen.getByRole("button", { name: "Cerrar sesión" }),
    ).toBeInTheDocument();
  });

  it("avisa del consentimiento del tutor sin pedírselo a la persona menor", () => {
    renderForm(["guardianConsent"]);

    expect(
      screen.getByRole("heading", { name: /consentimiento de tu tutor/i }),
    ).toBeInTheDocument();
    expect(saveButton).toThrow();
  });
});

describe("completar registro: guardar", () => {
  it("manda sólo el campo que falta al endpoint de la cuenta", async () => {
    stubApi();
    renderForm(["membershipType"]);
    const user = userEvent.setup();

    await user.selectOptions(
      screen.getByLabelText("Tipo de membresía"),
      "Student",
    );
    await user.click(saveButton());

    await waitFor(() => {
      expect(calls).toEqual([
        { url: ACCOUNT_API_PATH, body: { membershipType: "Student" } },
      ]);
    });
  });

  it("lleva al panel principal cuando la cuenta queda activa", async () => {
    stubApi();
    renderForm(["membershipType"]);
    const user = userEvent.setup();

    await user.selectOptions(
      screen.getByLabelText("Tipo de membresía"),
      "Full",
    );
    await user.click(saveButton());

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(DASHBOARD_PATH);
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("descarta un pendiente que no reconoce en vez de romper la pantalla", async () => {
    stubApi({
      status: 200,
      body: {
        data: {
          accountStatus: "incomplete",
          pending: ["emailConfirmation", "loQueSea"],
        },
      },
    });
    renderForm(["membershipType"]);
    const user = userEvent.setup();

    await user.selectOptions(
      screen.getByLabelText("Tipo de membresía"),
      "Full",
    );
    await user.click(saveButton());

    expect(
      await screen.findByRole("button", { name: "Reenviar el correo" }),
    ).toBeInTheDocument();
  });

  it("se queda pidiendo lo que el servidor dice que sigue faltando", async () => {
    stubApi({
      status: 200,
      body: {
        data: { accountStatus: "incomplete", pending: ["emailConfirmation"] },
      },
    });
    renderForm(["membershipType"]);
    const user = userEvent.setup();

    await user.selectOptions(
      screen.getByLabelText("Tipo de membresía"),
      "Casual",
    );
    await user.click(saveButton());

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Reenviar el correo" }),
      ).toBeInTheDocument();
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("no manda nada al servidor con un campo sin rellenar", async () => {
    stubApi();
    renderForm(["country"]);

    await userEvent.click(saveButton());

    expect(calls).toEqual([]);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("rechaza una fecha de nacimiento en el futuro sin preguntar al servidor", async () => {
    stubApi();
    renderForm(["dateOfBirth"]);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Fecha de nacimiento"), "2999-01-01");
    await user.click(saveButton());

    expect(calls).toEqual([]);
    expect(await screen.findByRole("alert")).toHaveTextContent(/futuro/i);
  });

  it("enseña el mensaje que devuelve el servidor cuando rechaza", async () => {
    stubApi({
      status: 422,
      body: {
        error: { code: "business_rule", message: "membershipType: no vale." },
      },
    });
    renderForm(["membershipType"]);
    const user = userEvent.setup();

    await user.selectOptions(
      screen.getByLabelText("Tipo de membresía"),
      "Full",
    );
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("no vale");
    expect(replace).not.toHaveBeenCalled();
  });
});
