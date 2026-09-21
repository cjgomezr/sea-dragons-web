import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/AppShell";

const { usePathname, useRouter } = vi.hoisted(() => ({
  usePathname: vi.fn(),
  // La cáscara lleva el control de cerrar sesión, que navega al salir.
  useRouter: vi.fn(() => ({ replace: vi.fn(), refresh: vi.fn() })),
}));
vi.mock("next/navigation", () => ({ usePathname, useRouter }));

describe("app shell", () => {
  it("renderiza marca, navegación, contenido y conmutador de tema", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <AppShell locale="en" role="Player">
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    expect(screen.getByText("Victoria Seadragons")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Main" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /theme/i })).toBeInTheDocument();
  });

  // FR-007: se cierra sesión desde cualquier pantalla, y la cáscara es lo
  // único que dibujan las siete por igual.
  it("ofrece cerrar sesión en cualquier pantalla de la aplicación", () => {
    usePathname.mockReturnValue("/calendario");
    render(
      <AppShell locale="en" role="Player">
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });

  // #209: Mi cuenta se alcanza desde la cabecera, junto a cerrar sesión.
  it("enlaza Mi cuenta justo antes de cerrar sesión", () => {
    usePathname.mockReturnValue("/calendario");
    render(
      <AppShell locale="en" role="Player">
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    const accountLink = screen.getByRole("link", { name: "My account" });
    expect(accountLink).toHaveAttribute("href", "/cuenta");
    expect(accountLink.nextElementSibling).toBe(
      screen.getByRole("button", { name: "Sign out" }),
    );
  });

  it("nombra el enlace a Mi cuenta en el idioma de la visita", () => {
    usePathname.mockReturnValue("/calendario");
    render(
      <AppShell locale="es" role="Player">
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    expect(screen.getByRole("link", { name: "Mi cuenta" })).toHaveAttribute(
      "href",
      "/cuenta",
    );
  });

  it("nombra el botón de cerrar sesión en el idioma de la visita", () => {
    usePathname.mockReturnValue("/calendario");
    render(
      <AppShell locale="es" role="Player">
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    expect(
      screen.getByRole("button", { name: "Cerrar sesión" }),
    ).toBeInTheDocument();
  });

  // E17 RF-3: un socio con sesión cambia de idioma sin salir de la aplicación.
  it("ofrece cambiar de idioma en cualquier pantalla de la aplicación", () => {
    usePathname.mockReturnValue("/equipos");
    render(
      <AppShell locale="es" role="Player">
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    expect(
      screen.getByRole("button", { name: /cambiar a english/i }),
    ).toBeInTheDocument();
  });

  it("pone el interruptor de idioma junto al del tema", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <AppShell locale="en" role="Player">
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    const themeToggle = screen.getByRole("button", { name: /theme/i });
    const languageToggle = screen.getByRole("button", { name: /español/i });
    expect(themeToggle.nextElementSibling).toBe(languageToggle);
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
