import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import type { Locale } from "@/lib/i18n/locale";

const { usePathname, useRouter } = vi.hoisted(() => ({
  usePathname: vi.fn(),
  // La cáscara lleva el control de cerrar sesión, que navega al salir.
  useRouter: vi.fn(() => ({ replace: vi.fn(), refresh: vi.fn() })),
}));
vi.mock("next/navigation", () => ({ usePathname, useRouter }));

function renderShell(locale: Locale = "en"): void {
  render(
    <AppShell locale={locale} role="Player">
      <p>Contenido de la sección</p>
    </AppShell>,
  );
}

async function openAccountMenu(name = "My account"): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole("button", { name }));
  return screen.getByRole("region", { name });
}

describe("app shell", () => {
  it("renderiza marca, navegación y contenido", () => {
    usePathname.mockReturnValue("/dashboard");
    renderShell();

    expect(screen.getByText("Victoria Seadragons")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Main" }),
    ).toBeInTheDocument();
  });

  // #287: tema, idioma, Mi perfil y cerrar sesión viven en el menú de la
  // cuenta, así que la cabecera sólo lleva el nombre y dos controles.
  it("la cabecera lleva sólo el nombre, la campana y el botón de la cuenta", () => {
    usePathname.mockReturnValue("/calendario");
    renderShell();

    const sidebar = screen.getByRole("complementary");
    const controls = within(sidebar).getAllByRole("button");
    expect(controls).toHaveLength(2);
    expect(controls[0]).toHaveAccessibleName(/^Notifications/);
    expect(controls[1]).toHaveAccessibleName("My account");
    expect(screen.queryByRole("button", { name: /theme/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  // #266: la campana sigue en la cabecera, justo antes de la cuenta.
  it("pone la campana de avisos justo antes del botón de la cuenta", () => {
    usePathname.mockReturnValue("/calendario");
    renderShell();

    const bell = screen.getByRole("button", { name: /^Notifications/ });
    const account = screen.getByRole("button", { name: "My account" });
    expect(bell.compareDocumentPosition(account)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("nombra el botón de la cuenta en el idioma de la visita", () => {
    usePathname.mockReturnValue("/calendario");
    renderShell("es");

    expect(
      screen.getByRole("button", { name: "Mi cuenta" }),
    ).toBeInTheDocument();
  });

  // FR-007: se cierra sesión desde cualquier pantalla, y la cáscara es lo
  // único que dibujan las siete por igual.
  it("ofrece cerrar sesión en cualquier pantalla de la aplicación", async () => {
    usePathname.mockReturnValue("/calendario");
    renderShell();

    const menu = await openAccountMenu();

    expect(
      within(menu).getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });

  // #209: Mi cuenta (ahora Mi perfil) se alcanza desde la cabecera.
  it("enlaza Mi perfil desde el menú de la cuenta", async () => {
    usePathname.mockReturnValue("/calendario");
    renderShell();

    const menu = await openAccountMenu();

    expect(
      within(menu).getByRole("link", { name: "My profile" }),
    ).toHaveAttribute("href", "/cuenta");
  });

  it("nombra Mi perfil y cerrar sesión en el idioma de la visita", async () => {
    usePathname.mockReturnValue("/calendario");
    renderShell("es");

    const menu = await openAccountMenu("Mi cuenta");

    expect(
      within(menu).getByRole("link", { name: "Mi perfil" }),
    ).toHaveAttribute("href", "/cuenta");
    expect(
      within(menu).getByRole("button", { name: "Cerrar sesión" }),
    ).toBeInTheDocument();
  });

  // E17 RF-3: un socio con sesión cambia de idioma sin salir de la aplicación.
  it("ofrece cambiar de idioma en cualquier pantalla de la aplicación", async () => {
    usePathname.mockReturnValue("/equipos");
    renderShell("es");

    const menu = await openAccountMenu("Mi cuenta");

    expect(
      within(menu).getByRole("button", { name: /cambiar a english/i }),
    ).toBeInTheDocument();
  });

  it("pone el interruptor de idioma justo después del del tema", async () => {
    usePathname.mockReturnValue("/dashboard");
    renderShell();

    const menu = await openAccountMenu();

    const themeToggle = within(menu).getByRole("button", { name: /theme/i });
    const languageToggle = within(menu).getByRole("button", {
      name: /español/i,
    });
    const buttons = within(menu).getAllByRole("button");
    expect(buttons.indexOf(languageToggle)).toBe(
      buttons.indexOf(themeToggle) + 1,
    );
  });

  // E17 RF-5: la cáscara pasa el idioma a las dos navegaciones, que son hojas
  // de cliente y no pueden leer la cookie por su cuenta.
  it("nombra las dos navegaciones en el idioma de la visita", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <AppShell locale="es" role="Player">
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    expect(
      screen.getByRole("navigation", { name: "Principal" }),
    ).toHaveTextContent("Directorio");
    expect(
      screen.getByRole("navigation", { name: "Secciones" }),
    ).toHaveTextContent("Inicio");
  });

  // #213: la cáscara reparte el rol que leyó el servidor a las dos
  // navegaciones, que esconden lo que ese rol no puede abrir.
  it("ofrece a cada navegación sólo lo que el rol recibido puede abrir", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <AppShell locale="en" role="Player">
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    const sidebar = screen.getByRole("navigation", { name: "Main" });
    expect(sidebar).not.toHaveTextContent("Teams");
    expect(sidebar).not.toHaveTextContent("Evaluations");
    expect(
      screen.getByRole("navigation", { name: "Sections" }),
    ).not.toHaveTextContent("Teams");
  });

  // La administración vive dentro del directorio desde #240: ninguna de las
  // dos navegaciones la ofrece, ni siquiera a un Admin.
  it("no enseña Administración en ninguna de las dos navegaciones a un Admin", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <AppShell locale="en" role="Admin">
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    expect(
      screen.getByRole("navigation", { name: "Main" }),
    ).not.toHaveTextContent("Administration");
    expect(
      screen.getByRole("navigation", { name: "Sections" }),
    ).not.toHaveTextContent("Administration");
  });

  it("muestra el contenido recibido dentro del área principal", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <AppShell locale="en" role="Player">
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByText("Contenido de la sección"));
  });
});
