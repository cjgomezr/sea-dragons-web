import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { RegistrationForm } from "@/components/auth/RegistrationForm";
import { listCountryOptions } from "@/lib/geo/countries";
import { renderAccountConfirmationEmail } from "@/lib/email/email-templates";
import {
  ACCOUNT_EXISTENCE_CLAIMS,
  expectNoneMatch,
} from "../helpers/confirmation-copy";
import {
  STATES_WITHOUT_A_VALID_LINK,
  readConfirmationPanel,
} from "../helpers/confirmation-panels";

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
 * Los cuatro textos que cuentan lo mismo en sitios distintos, leídos de
 * seguido. Ninguno puede decir si esa dirección tiene cuenta: la API se cuida
 * de no delatarlo (y eso lo vigila
 * `tests/unit/api/auth/email-delivery-enumeration.test.ts`), así que una
 * pantalla que lo diga con palabras tira abajo lo mismo que el #147 y el #158
 * levantaron.
 *
 * Decir "si ya te habías registrado antes…" sí vale: una condición se lee
 * igual la cumpla quien la lea o no, y no afirma nada de nadie.
 */
const EMAIL = "nerea@example.test";
const LIFETIME_MINUTES = 60;

const CONFIRMATION_PENDING_RESPONSE = {
  data: { outcome: "confirmation_pending", email: EMAIL },
};

async function readConfirmationScreen(): Promise<string> {
  const user = userEvent.setup();
  const { container } = render(
    <RegistrationForm countries={listCountryOptions("es")} />,
  );

  await user.type(screen.getByLabelText("Nombre completo"), "Nerea Silva");
  await user.type(screen.getByLabelText("Correo electrónico"), EMAIL);
  await user.selectOptions(screen.getByLabelText("País"), "AU");
  await user.selectOptions(screen.getByLabelText("Tipo de membresía"), "Full");
  await user.type(screen.getByLabelText("Fecha de nacimiento"), "1994-03-02");
  await user.type(screen.getByLabelText("Contraseña"), "bajoelagua");
  await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
  await screen.findByRole("heading", { name: /confirma tu correo/i });

  return container.textContent ?? "";
}

describe("la copia del enlace de confirmación no distingue direcciones", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(CONFIRMATION_PENDING_RESPONSE), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("el correo de confirmación no dice si esa dirección tiene cuenta", () => {
    const email = renderAccountConfirmationEmail({
      confirmUrl: "https://example.test/auth/confirmar?token_hash=abc",
      linkLifetimeMinutes: LIFETIME_MINUTES,
    });

    expectNoneMatch(email.subject, ACCOUNT_EXISTENCE_CLAIMS, "el asunto");
    expectNoneMatch(email.text, ACCOUNT_EXISTENCE_CLAIMS, "el correo");
  });

  it.each(STATES_WITHOUT_A_VALID_LINK)(
    "el panel de %s no dice si esa dirección tiene cuenta",
    async (state) => {
      expectNoneMatch(
        await readConfirmationPanel(state),
        ACCOUNT_EXISTENCE_CLAIMS,
        `el panel ${state}`,
      );
    },
  );

  it("la pantalla de confirmación no dice si esa dirección tiene cuenta", async () => {
    expectNoneMatch(
      await readConfirmationScreen(),
      ACCOUNT_EXISTENCE_CLAIMS,
      "la pantalla de confirmación",
    );
  });
});
