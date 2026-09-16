import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompleteRegistrationForm } from "@/components/auth/CompleteRegistrationForm";
import {
  NewPasswordForm,
  RecoveryLinkUnusable,
} from "@/components/auth/NewPasswordForm";
import { PasswordRecoveryRequestForm } from "@/components/auth/PasswordRecoveryRequestForm";
import { RegistrationConfirmationPanel } from "@/components/auth/RegistrationConfirmationPanel";
import { RegistrationForm } from "@/components/auth/RegistrationForm";
import { SignInForm } from "@/components/auth/SignInForm";
import { listCountryOptions } from "@/lib/geo/countries";
import type { Locale } from "@/lib/i18n/locale";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const requestLocale = { current: "en" as Locale };

vi.mock("@/lib/i18n/request-locale", () => ({
  readRequestLocale: async () => requestLocale.current,
}));

const COUNTRIES_EN = listCountryOptions("en");
const COUNTRIES_ES = listCountryOptions("es");

function stubApi(response: { status: number; body: unknown }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(response.body), {
          status: response.status,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

type ScreenCase = {
  readonly name: string;
  readonly render: (locale: Locale) => void;
  readonly english: string;
  readonly spanish: string;
};

const SCREENS: readonly ScreenCase[] = [
  {
    name: "entrar",
    render: (locale) => render(<SignInForm locale={locale} />),
    english: "Welcome back",
    spanish: "Bienvenido de vuelta",
  },
  {
    name: "registro",
    render: (locale) =>
      render(
        <RegistrationForm
          locale={locale}
          countries={locale === "en" ? COUNTRIES_EN : COUNTRIES_ES}
        />,
      ),
    english: "Create your account",
    spanish: "Crear tu cuenta",
  },
  {
    name: "completar registro",
    render: (locale) =>
      render(
        <CompleteRegistrationForm
          locale={locale}
          pending={["country", "emailConfirmation"]}
          countries={locale === "en" ? COUNTRIES_EN : COUNTRIES_ES}
          email="nerea@example.test"
        />,
      ),
    english: "Finish signing up",
    spanish: "Termina tu registro",
  },
  {
    name: "consentimiento del tutor",
    render: (locale) =>
      render(
        <CompleteRegistrationForm
          locale={locale}
          pending={["guardianConsent"]}
          countries={COUNTRIES_EN}
          email="nerea@example.test"
        />,
      ),
    english: "Your guardian's consent is missing",
    spanish: "Falta el consentimiento de tu tutor",
  },
  {
    name: "recuperar contraseña",
    render: (locale) => render(<PasswordRecoveryRequestForm locale={locale} />),
    english: "Reset your password",
    spanish: "Recuperar tu contraseña",
  },
  {
    name: "contraseña nueva",
    render: (locale) =>
      render(<NewPasswordForm locale={locale} tokenHash="hash" />),
    english: "Choose your new password",
    spanish: "Elige tu contraseña nueva",
  },
  {
    name: "enlace de recuperación que no sirve",
    render: (locale) => render(<RecoveryLinkUnusable locale={locale} />),
    english: "This link no longer works",
    spanish: "Este enlace ya no sirve",
  },
  {
    name: "correo confirmado",
    render: (locale) =>
      render(<RegistrationConfirmationPanel locale={locale} state="ok" />),
    english: "Your email is confirmed",
    spanish: "Tu correo quedó confirmado",
  },
  {
    name: "enlace de confirmación que no sirve",
    render: (locale) =>
      render(
        <RegistrationConfirmationPanel locale={locale} state="invalida" />,
      ),
    english: "This link no longer works",
    spanish: "Este enlace ya no sirve",
  },
  {
    name: "confirmación que falló",
    render: (locale) =>
      render(<RegistrationConfirmationPanel locale={locale} state="error" />),
    english: "We couldn't confirm your email",
    spanish: "No pudimos confirmar tu correo",
  },
];

describe("pantallas de autenticación en los dos idiomas", () => {
  it.each(SCREENS)("$name se pinta en inglés", (screenCase) => {
    screenCase.render("en");

    expect(
      screen.getByRole("heading", { name: screenCase.english }),
    ).toBeInTheDocument();
    expect(screen.queryByText(screenCase.spanish)).toBeNull();
  });

  it.each(SCREENS)("$name se pinta en español", (screenCase) => {
    screenCase.render("es");

    expect(
      screen.getByRole("heading", { name: screenCase.spanish }),
    ).toBeInTheDocument();
    expect(screen.queryByText(screenCase.english)).toBeNull();
  });

  it("entrar en inglés etiqueta sus campos, su botón y sus enlaces en inglés", () => {
    render(<SignInForm locale="en" />);

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Forgot your password?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Create an account" }),
    ).toBeInTheDocument();
  });

  it("el registro en inglés etiqueta sus campos y la pista de la contraseña en inglés", () => {
    render(<RegistrationForm locale="en" countries={COUNTRIES_EN} />);

    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
    expect(screen.getByLabelText("Date of birth")).toBeInTheDocument();
    expect(screen.getByLabelText("Membership type")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(
      "At least 8 characters.",
    );
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeInTheDocument();
  });

  it("el bloque del tutor en inglés pide el consentimiento en inglés", () => {
    render(
      <CompleteRegistrationForm
        locale="en"
        pending={["guardianConsent"]}
        countries={COUNTRIES_EN}
        email="nerea@example.test"
      />,
    );

    expect(screen.getByLabelText("Guardian's name")).toBeInTheDocument();
    expect(screen.getByLabelText("Guardian's email")).toBeInTheDocument();
    expect(
      screen.getByLabelText(/I am their parent or legal guardian/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });

  it("completar registro en inglés pinta el correo pendiente con la dirección resaltada", () => {
    render(
      <CompleteRegistrationForm
        locale="en"
        pending={["emailConfirmation"]}
        countries={COUNTRIES_EN}
        email="nerea@example.test"
      />,
    );

    const notice = screen.getByRole("heading", { name: "Confirm your email" })
      .parentElement as HTMLElement;
    expect(notice).toHaveTextContent(
      "We sent a link to nerea@example.test. Open it to finish",
    );
    expect(within(notice).getByText("nerea@example.test").tagName).toBe(
      "STRONG",
    );
  });
});

describe("validación traducida", () => {
  it("la contraseña corta se explica en inglés", async () => {
    render(<NewPasswordForm locale="en" tokenHash="hash" />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("New password"), "1234567");
    await user.click(screen.getByRole("button", { name: "Save password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Password must be at least 8 characters.",
    );
  });

  it("la contraseña corta se explica en español", async () => {
    render(<NewPasswordForm locale="es" tokenHash="hash" />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Contraseña nueva"), "1234567");
    await user.click(
      screen.getByRole("button", { name: "Guardar contraseña" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La contraseña debe tener al menos 8 caracteres.",
    );
  });

  it("el correo mal escrito del registro se explica en inglés, con el nombre del campo", async () => {
    render(<RegistrationForm locale="en" countries={COUNTRIES_EN} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Email"), "nerea-sin-arroba");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("Check these fields before continuing:");
    expect(summary).toHaveTextContent("Email: The email address is not valid.");
  });

  it("el correo mal escrito del registro se explica en español", async () => {
    render(<RegistrationForm locale="es" countries={COUNTRIES_ES} />);
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText("Correo electrónico"),
      "nerea-sin-arroba",
    );
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Correo electrónico: El correo no tiene una forma válida.",
    );
  });

  it.each([
    {
      locale: "en" as const,
      name: "Guardian's name",
      submit: "Record consent",
      message: "Tick the consent box: without it the account is not activated.",
    },
    {
      locale: "es" as const,
      name: "Nombre del tutor",
      submit: "Registrar el consentimiento",
      message:
        "Marca la casilla del consentimiento: sin ella la cuenta no se activa.",
    },
  ])(
    "el menor sin consentimiento lo lee en $locale",
    async ({ locale, name, submit, message }) => {
      render(
        <CompleteRegistrationForm
          locale={locale}
          pending={["guardianConsent"]}
          countries={COUNTRIES_EN}
          email="nerea@example.test"
        />,
      );
      const user = userEvent.setup();

      await user.type(screen.getByLabelText(name), "Marta Silva");
      await user.click(screen.getByRole("button", { name: submit }));

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
    },
  );

  it("un campo pendiente que se manda vacío se explica en inglés", async () => {
    render(
      <CompleteRegistrationForm
        locale="en"
        pending={["country"]}
        countries={COUNTRIES_EN}
        email="nerea@example.test"
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Save and continue" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Country: This detail is required.",
    );
  });
});

describe("errores del servidor", () => {
  const SERVER_PHRASE = "Frase del servidor que ninguna pantalla lee.";

  beforeEach(() => {
    stubApi({
      status: 401,
      body: { error: { code: "unauthenticated", message: SERVER_PHRASE } },
    });
  });

  it.each([
    {
      locale: "en" as const,
      email: "Email",
      password: "Password",
      submit: "Sign in",
      message: "The email or password is incorrect.",
    },
    {
      locale: "es" as const,
      email: "Correo electrónico",
      password: "Contraseña",
      submit: "Entrar",
      message: "El correo o la contraseña no coinciden.",
    },
  ])(
    "el mismo código sale traducido en $locale",
    async ({ locale, email, password, submit, message }) => {
      render(<SignInForm locale={locale} />);
      const user = userEvent.setup();

      await user.type(screen.getByLabelText(email), "nerea@example.test");
      await user.type(screen.getByLabelText(password), "otracosa");
      await user.click(screen.getByRole("button", { name: submit }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(message);
      expect(alert).not.toHaveTextContent(SERVER_PHRASE);
    },
  );

  it.each([
    {
      locale: "en" as const,
      message:
        "You asked for several links in a row. Wait 15 minutes before asking for another.",
    },
    {
      locale: "es" as const,
      message:
        "Pediste varios enlaces seguidos. Espera 15 minutos antes de pedir otro.",
    },
  ])(
    "el límite de peticiones sale traducido en $locale",
    async ({ locale, message }) => {
      stubApi({
        status: 429,
        body: { error: { code: "rate_limited", message: SERVER_PHRASE } },
      });
      render(<PasswordRecoveryRequestForm locale={locale} />);
      const user = userEvent.setup();

      await user.type(screen.getByRole("textbox"), "nerea@example.test");
      await user.click(screen.getByRole("button"));

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
    },
  );

  it("una contraseña rechazada se explica en inglés a partir de su motivo", async () => {
    stubApi({
      status: 410,
      body: {
        error: {
          code: "gone",
          reason: "password_rejected",
          message: SERVER_PHRASE,
        },
      },
    });
    render(<NewPasswordForm locale="en" tokenHash="hash" />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("New password"), "bajoelagua-nueva");
    await user.click(screen.getByRole("button", { name: "Save password" }));

    const panel = await screen.findByRole("region", {
      name: "This link no longer works",
    });
    expect(panel).toHaveTextContent(/same as the previous one or too weak/);
    expect(panel).not.toHaveTextContent(SERVER_PHRASE);
  });

  it("una respuesta que no es de la API da el error genérico de la pantalla", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502</html>", { status: 502 })),
    );
    render(<SignInForm locale="en" />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Email"), "nerea@example.test");
    await user.type(screen.getByLabelText("Password"), "bajoelagua");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't sign you in. Try again in a moment.",
    );
  });
});

describe("países", () => {
  function optionNames(): string[] {
    const select = screen.getByRole("combobox", { name: /country|país/i });
    return within(select)
      .getAllByRole("option")
      .slice(1)
      .map((option) => option.textContent ?? "");
  }

  it.each([
    { locale: "en" as const, spain: "Spain", germany: "Germany" },
    { locale: "es" as const, spain: "España", germany: "Alemania" },
  ])(
    "la página del registro los nombra en $locale",
    async ({ locale, spain, germany }) => {
      requestLocale.current = locale;
      const { default: RegistrationPage } =
        await import("@/app/(auth)/registro/page");

      render(await RegistrationPage({ searchParams: Promise.resolve({}) }));

      expect(optionNames()).toContain(spain);
      expect(optionNames()).toContain(germany);
    },
  );

  it.each<Locale>(["en", "es"])(
    "la página del registro los ordena alfabéticamente en %s",
    async (locale) => {
      requestLocale.current = locale;
      const { default: RegistrationPage } =
        await import("@/app/(auth)/registro/page");

      render(await RegistrationPage({ searchParams: Promise.resolve({}) }));

      const names = optionNames();
      const collator = new Intl.Collator(locale);
      expect(names).toEqual([...names].sort(collator.compare));
    },
  );
});

describe("títulos de las pantallas", () => {
  it.each([
    { locale: "en" as const, title: "Sign in · Victoria Seadragons" },
    { locale: "es" as const, title: "Entrar · Victoria Seadragons" },
  ])("la entrada se titula en $locale", async ({ locale, title }) => {
    requestLocale.current = locale;
    const { generateMetadata } = await import("@/app/(auth)/entrar/page");

    await expect(generateMetadata()).resolves.toMatchObject({ title });
  });

  it.each([
    "@/app/(auth)/registro/page",
    "@/app/(auth)/completar-registro/page",
    "@/app/(auth)/recuperar-contrasena/page",
    "@/app/(auth)/recuperar-contrasena/nueva/page",
  ])("%s cambia de título con el idioma", async (path) => {
    const { generateMetadata } = (await import(path)) as {
      generateMetadata: () => Promise<{ title: string }>;
    };

    requestLocale.current = "en";
    const english = await generateMetadata();
    requestLocale.current = "es";
    const spanish = await generateMetadata();

    expect(english.title).not.toBe(spanish.title);
  });
});
