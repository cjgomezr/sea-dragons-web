import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALE_COOKIE_NAME } from "@/lib/i18n/locale";

const incoming = { cookies: new Map<string, string>() };

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

const { default: AuthLayout } = await import("@/app/(auth)/layout");

async function renderAuthLayout(): Promise<void> {
  render(await AuthLayout({ children: <form aria-label="Entrar" /> }));
}

beforeEach(() => {
  incoming.cookies.clear();
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
