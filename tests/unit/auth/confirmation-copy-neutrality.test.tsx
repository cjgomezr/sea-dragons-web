import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { RegistrationForm } from "@/components/auth/RegistrationForm";
import { listCountryOptions } from "@/lib/geo/countries";
import { renderAccountConfirmationEmail } from "@/lib/email/email-templates";
import type { Locale } from "@/lib/i18n/locale";
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

const LOCALES: readonly Locale[] = ["en", "es"];

/** Las etiquetas del registro en cada idioma, sólo las que este recorrido
 * necesita para llegar a la pantalla de confirmación. */
const REGISTRATION_LABELS: Readonly<
  Record<
    Locale,
    {
      readonly fullName: string;
      readonly email: string;
      readonly country: string;
      readonly membershipType: string;
      readonly dateOfBirth: string;
      readonly password: string;
      readonly submit: string;
      readonly confirmTitle: RegExp;
    }
  >
> = {
  en: {
    fullName: "Full name",
    email: "Email",
    country: "Country",
    membershipType: "Membership type",
    dateOfBirth: "Date of birth",
    password: "Password",
    submit: "Create account",
    confirmTitle: /confirm your email/i,
  },
  es: {
    fullName: "Nombre completo",
    email: "Correo electrónico",
    country: "País",
    membershipType: "Tipo de membresía",
    dateOfBirth: "Fecha de nacimiento",
    password: "Contraseña",
    submit: "Crear cuenta",
    confirmTitle: /confirma tu correo/i,
  },
};

async function readConfirmationScreen(locale: Locale): Promise<string> {
  const labels = REGISTRATION_LABELS[locale];
  const user = userEvent.setup();
  const { container } = render(
    <RegistrationForm locale={locale} countries={listCountryOptions(locale)} />,
  );

  await user.type(screen.getByLabelText(labels.fullName), "Nerea Silva");
  await user.type(screen.getByLabelText(labels.email), EMAIL);
  await user.selectOptions(screen.getByLabelText(labels.country), "AU");
  await user.selectOptions(
    screen.getByLabelText(labels.membershipType),
    "Full",
  );
  await user.type(screen.getByLabelText(labels.dateOfBirth), "1994-03-02");
  await user.type(screen.getByLabelText(labels.password), "bajoelagua");
  await user.click(screen.getByRole("button", { name: labels.submit }));
  await screen.findByRole("heading", { name: labels.confirmTitle });

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

  it.each(
    LOCALES.flatMap((locale) =>
      STATES_WITHOUT_A_VALID_LINK.map((state) => ({ state, locale })),
    ),
  )(
    "el panel de $state en $locale no dice si esa dirección tiene cuenta",
    ({ state, locale }) => {
      expectNoneMatch(
        readConfirmationPanel(state, locale),
        ACCOUNT_EXISTENCE_CLAIMS,
        `el panel ${state}`,
      );
    },
  );

  it.each(LOCALES)(
    "la pantalla de confirmación en %s no dice si esa dirección tiene cuenta",
    async (locale) => {
      expectNoneMatch(
        await readConfirmationScreen(locale),
        ACCOUNT_EXISTENCE_CLAIMS,
        "la pantalla de confirmación",
      );
    },
  );
});
