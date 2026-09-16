import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageToggle } from "@/components/LanguageToggle";
import { LOCALE_COOKIE_NAME } from "@/lib/i18n/locale";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

function storedLocaleCookie(): string | undefined {
  return document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${LOCALE_COOKIE_NAME}=`))
    ?.slice(`${LOCALE_COOKIE_NAME}=`.length);
}

// Aplicar el idioma nuevo a la pantalla es cosa del servidor, que lee la
// cookie al rehacerla; su prueba de punta a punta está en
// tests/language-toggle.spec.ts. Lo que este componente decide es qué cookie
// escribe, que pide la pantalla otra vez y cómo se nombra.
describe("interruptor de idioma", () => {
  beforeEach(() => {
    document.cookie = `${LOCALE_COOKIE_NAME}=; Max-Age=0; Path=/`;
    refresh.mockClear();
  });

  it("escribe la cookie en español al pulsarlo en inglés", async () => {
    const user = userEvent.setup();
    render(<LanguageToggle locale="en" />);

    await user.click(screen.getByRole("button"));

    expect(storedLocaleCookie()).toBe("es");
  });

  it("escribe la cookie en inglés al pulsarlo en español", async () => {
    const user = userEvent.setup();
    render(<LanguageToggle locale="es" />);

    await user.click(screen.getByRole("button"));

    expect(storedLocaleCookie()).toBe("en");
  });

  it("pide la pantalla al servidor otra vez para que la rehaga en el idioma nuevo", async () => {
    const user = userEvent.setup();
    render(<LanguageToggle locale="en" />);

    await user.click(screen.getByRole("button"));

    expect(refresh).toHaveBeenCalledOnce();
  });

  it("nombra el español como destino cuando la pantalla está en inglés", () => {
    render(<LanguageToggle locale="en" />);

    expect(
      screen.getByRole("button", { name: /switch to español/i }),
    ).toBeInTheDocument();
  });

  it("nombra el inglés como destino cuando la pantalla está en español", () => {
    render(<LanguageToggle locale="es" />);

    expect(
      screen.getByRole("button", { name: /cambiar a english/i }),
    ).toBeInTheDocument();
  });

  it("dice en su nombre accesible en qué idioma está la pantalla", () => {
    render(<LanguageToggle locale="es" />);

    expect(
      screen.getByRole("button", { name: /idioma: español/i }),
    ).toBeInTheDocument();
  });

  it("repite en su nombre accesible el código que se ve, para el control por voz", () => {
    render(<LanguageToggle locale="es" />);

    const toggle = screen.getByRole("button");
    expect(toggle).toHaveTextContent("EN");
    expect(toggle).toHaveAccessibleName(/\bEN\b/);
  });

  it("muestra a la vista el idioma al que lleva", () => {
    render(<LanguageToggle locale="en" />);

    expect(screen.getByRole("button")).toHaveTextContent("ES");
  });
});
