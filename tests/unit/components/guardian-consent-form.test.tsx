import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompleteRegistrationForm } from "@/components/auth/CompleteRegistrationForm";
import type { PendingRequirement } from "@/lib/auth/account-activation";
import { DASHBOARD_PATH, GUARDIAN_CONSENT_API_PATH } from "@/lib/auth/routes";

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
 * El bloque del tutor dentro de completar registro (FR-082). El consentimiento
 * se recoge en la misma pantalla: nombre, correo y una casilla explícita.
 */

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
      locale="es"
      pending={pending}
      countries={[{ code: "AU", name: "Australia" }]}
      email="nerea@example.test"
    />,
  );
}

function consentButton(): HTMLElement {
  return screen.getByRole("button", { name: "Registrar el consentimiento" });
}

async function fillGuardian(options: {
  readonly name?: string;
  readonly email?: string;
  readonly consent?: boolean;
}): Promise<void> {
  const user = userEvent.setup();
  if (options.name !== undefined) {
    await user.type(screen.getByLabelText("Nombre del tutor"), options.name);
  }
  if (options.email !== undefined) {
    await user.type(screen.getByLabelText("Correo del tutor"), options.email);
  }
  if (options.consent) {
    await user.click(screen.getByRole("checkbox"));
  }
  await user.click(consentButton());
}

beforeEach(() => {
  calls.length = 0;
  replace.mockClear();
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bloque del tutor", () => {
  it("pide nombre, correo y un consentimiento explícito cuando falta", () => {
    renderForm(["guardianConsent"]);

    expect(
      screen.getByRole("heading", { name: /consentimiento de tu tutor/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre del tutor")).toBeInTheDocument();
    expect(screen.getByLabelText("Correo del tutor")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /doy mi consentimiento/i }),
    ).not.toBeChecked();
  });

  it("dice que la cuenta no se activa hasta tener el consentimiento", () => {
    renderForm(["guardianConsent"]);

    expect(screen.getByText(/no se activa/i)).toBeInTheDocument();
  });

  it("no aparece cuando el consentimiento no hace falta", () => {
    renderForm(["membershipType"]);

    expect(screen.queryByLabelText("Nombre del tutor")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("manda los tres datos al endpoint del consentimiento", async () => {
    stubApi();
    renderForm(["guardianConsent"]);

    await fillGuardian({
      name: "Marta Silva",
      email: "marta.silva@example.test",
      consent: true,
    });

    await waitFor(() => {
      expect(calls).toEqual([
        {
          url: GUARDIAN_CONSENT_API_PATH,
          body: {
            guardianName: "Marta Silva",
            guardianEmail: "marta.silva@example.test",
            consent: true,
          },
        },
      ]);
    });
  });

  it("lleva al panel cuando la cuenta queda activa", async () => {
    stubApi();
    renderForm(["guardianConsent"]);

    await fillGuardian({
      name: "Marta Silva",
      email: "marta.silva@example.test",
      consent: true,
    });

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(DASHBOARD_PATH);
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("no manda nada sin la casilla del consentimiento marcada", async () => {
    stubApi();
    renderForm(["guardianConsent"]);

    await fillGuardian({
      name: "Marta Silva",
      email: "marta.silva@example.test",
    });

    expect(calls).toEqual([]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /consentimiento/i,
    );
  });

  it("no manda nada con un correo del tutor que no lo es", async () => {
    stubApi();
    renderForm(["guardianConsent"]);

    await fillGuardian({ name: "Marta Silva", email: "marta", consent: true });

    expect(calls).toEqual([]);
    expect(await screen.findByRole("alert")).toHaveTextContent(/correo/i);
  });

  it("traduce el rechazo del servidor a partir de su código, no de su frase", async () => {
    stubApi({
      status: 409,
      body: { error: { code: "conflict", message: "Ya estaba registrado." } },
    });
    renderForm(["guardianConsent"]);

    await fillGuardian({
      name: "Marta Silva",
      email: "marta.silva@example.test",
      consent: true,
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/recarga la página/i);
    expect(alert).not.toHaveTextContent("Ya estaba registrado.");
    expect(replace).not.toHaveBeenCalled();
  });

  it("sigue mostrando lo que quede pendiente después del consentimiento", async () => {
    stubApi({
      status: 200,
      body: {
        data: { accountStatus: "incomplete", pending: ["emailConfirmation"] },
      },
    });
    renderForm(["guardianConsent", "emailConfirmation"]);

    await fillGuardian({
      name: "Marta Silva",
      email: "marta.silva@example.test",
      consent: true,
    });

    await waitFor(() => {
      expect(
        screen.queryByLabelText("Nombre del tutor"),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Reenviar el correo" }),
    ).toBeInTheDocument();
  });
});
