import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ClubBrand, DEFAULT_CLUB_BRAND } from "@/lib/club/club-brand";
import { LOCALE_COOKIE_NAME } from "@/lib/i18n/locale";

const incoming = { cookies: new Map<string, string>() };
const storedBrand: { current: ClubBrand } = {
  current: { ...DEFAULT_CLUB_BRAND, name: "Hobart Orcas", initials: "HO" },
};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = incoming.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/club/supabase-club-brand", () => ({
  readClubBrand: async () => storedBrand.current,
}));

const { default: AuthLayout } = await import("@/app/(auth)/layout");

async function renderAuthLayout(): Promise<void> {
  render(await AuthLayout({ children: <form aria-label="Entrar" /> }));
}

beforeEach(() => {
  incoming.cookies.clear();
  storedBrand.current = {
    ...DEFAULT_CLUB_BRAND,
    name: "Hobart Orcas",
    initials: "HO",
  };
});

// #292: la marca de la pantalla de entrar sale de la base, no del código.
describe("la marca en la pantalla de entrar", () => {
  it("enseña el nombre guardado del club", async () => {
    await renderAuthLayout();

    expect(screen.getByText("Hobart Orcas")).toBeInTheDocument();
    expect(screen.queryByText(/Victoria Seadragons/)).toBeNull();
  });

  it("enseña las iniciales guardadas en el recuadro de la marca", async () => {
    storedBrand.current = {
      ...DEFAULT_CLUB_BRAND,
      name: "Hobart Orcas",
      initials: "HOC",
    };

    await renderAuthLayout();

    expect(screen.getByText("HOC")).toBeInTheDocument();
  });

  // #295: el logo sustituye al recuadro de iniciales.
  it("con logo enseña el logo en vez de las iniciales", async () => {
    storedBrand.current = {
      ...DEFAULT_CLUB_BRAND,
      name: "Hobart Orcas",
      initials: "HO",
      logoUrl: "https://storage.example.test/club-logos/club/logo.png",
    };

    await renderAuthLayout();

    expect(
      screen.getByRole("img", { name: "Hobart Orcas logo" }),
    ).toHaveAttribute(
      "src",
      "https://storage.example.test/club-logos/club/logo.png",
    );
    expect(screen.queryByText("HO")).toBeNull();
  });
});

// #301: el lema y el párrafo los escribe el club, por idioma; si falta uno,
// sale el de la aplicación en ese idioma, nunca el del otro.
describe("pantalla de entrar", () => {
  function givenSignInTexts(signInTexts: ClubBrand["signInTexts"]): void {
    storedBrand.current = { ...storedBrand.current, signInTexts };
  }

  it("con textos del club enseña los suyos en vez de los de la aplicación", async () => {
    givenSignInTexts({
      en: { tagline: "Dive in with us.", welcome: "Hobart's finest." },
      es: { tagline: "Al agua con nosotros.", welcome: "Lo mejor de Hobart." },
    });

    await renderAuthLayout();

    expect(screen.getByText("Dive in with us.")).toBeInTheDocument();
    expect(screen.getByText("Hobart's finest.")).toBeInTheDocument();
    expect(screen.queryByText("Your club, beneath the surface.")).toBeNull();
  });

  it("con textos del club en español los enseña a quien eligió español", async () => {
    incoming.cookies.set(LOCALE_COOKIE_NAME, "es");
    givenSignInTexts({
      en: { tagline: "Dive in with us.", welcome: "Hobart's finest." },
      es: { tagline: "Al agua con nosotros.", welcome: "Lo mejor de Hobart." },
    });

    await renderAuthLayout();

    expect(screen.getByText("Al agua con nosotros.")).toBeInTheDocument();
    expect(screen.getByText("Lo mejor de Hobart.")).toBeInTheDocument();
    expect(screen.queryByText("Dive in with us.")).toBeNull();
  });

  it("con textos sólo en español, en inglés salen los de la aplicación", async () => {
    givenSignInTexts({
      en: { tagline: null, welcome: null },
      es: { tagline: "Al agua con nosotros.", welcome: "Lo mejor de Hobart." },
    });

    await renderAuthLayout();

    expect(
      screen.getByText("Your club, beneath the surface."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Al agua con nosotros.")).toBeNull();
    expect(screen.queryByText("Lo mejor de Hobart.")).toBeNull();
  });

  it("con sólo el lema del club, el párrafo sale de la aplicación", async () => {
    givenSignInTexts({
      en: { tagline: "Dive in with us.", welcome: null },
      es: { tagline: null, welcome: null },
    });

    await renderAuthLayout();

    expect(screen.getByText("Dive in with us.")).toBeInTheDocument();
    expect(
      screen.getByText(/Training, teams, assessments/),
    ).toBeInTheDocument();
  });

  it("sin textos del club salen los de hoy", async () => {
    await renderAuthLayout();

    expect(
      screen.getByText("Your club, beneath the surface."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Training, teams, assessments/),
    ).toBeInTheDocument();
  });

  it("enseña un texto con etiquetas HTML como texto plano, sin interpretarlo", async () => {
    const markup = '<img src=x onerror="alert(1)"><b>Hola</b>';
    givenSignInTexts({
      en: { tagline: markup, welcome: "<script>alert(2)</script>" },
      es: { tagline: null, welcome: null },
    });

    const { container } = render(
      await AuthLayout({ children: <form aria-label="Entrar" /> }),
    );

    expect(screen.getByText(markup)).toBeInTheDocument();
    expect(screen.getByText("<script>alert(2)</script>")).toBeInTheDocument();
    expect(container.querySelector("img[onerror], b, script")).toBeNull();
  });
});

// E17 RF-3: quien todavía no entró también tiene que poder cambiar de idioma,
// y el sitio es la cabecera donde ya vive el tema.
describe("disposición de las pantallas de autenticación", () => {
  it("ofrece cambiar al español a quien la ve en inglés", async () => {
    await renderAuthLayout();

    expect(
      screen.getByRole("button", { name: /switch to español/i }),
    ).toBeInTheDocument();
  });

  it("ofrece cambiar al inglés a quien eligió español", async () => {
    incoming.cookies.set(LOCALE_COOKIE_NAME, "es");

    await renderAuthLayout();

    expect(
      screen.getByRole("button", { name: /cambiar a english/i }),
    ).toBeInTheDocument();
  });

  it("pone el interruptor de idioma junto al del tema", async () => {
    await renderAuthLayout();

    const themeToggle = screen.getByRole("button", { name: /theme/i });
    const languageToggle = screen.getByRole("button", { name: /español/i });
    expect(themeToggle.nextElementSibling).toBe(languageToggle);
  });

  it("cuenta el club en inglés a quien la ve en inglés", async () => {
    await renderAuthLayout();

    expect(
      screen.getByText("Your club, beneath the surface."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Tu club, bajo la superficie.")).toBeNull();
  });

  it("cuenta el club en español a quien eligió español", async () => {
    incoming.cookies.set(LOCALE_COOKIE_NAME, "es");

    await renderAuthLayout();

    expect(
      screen.getByText("Tu club, bajo la superficie."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Rugby subacuático · Melbourne"),
    ).toBeInTheDocument();
  });
});
