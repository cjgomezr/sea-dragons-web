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
      <AppShell locale="en">
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    expect(screen.getByText("Victoria Seadragons")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Principal" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tema/i })).toBeInTheDocument();
  });

  // FR-007: se cierra sesión desde cualquier pantalla, y la cáscara es lo
  // único que dibujan las siete por igual.
  it("ofrece cerrar sesión en cualquier pantalla de la aplicación", () => {
    usePathname.mockReturnValue("/calendario");
    render(
      <AppShell locale="en">
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
      <AppShell locale="es">
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
      <AppShell locale="en">
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    const themeToggle = screen.getByRole("button", { name: /tema/i });
    const languageToggle = screen.getByRole("button", { name: /español/i });
    expect(themeToggle.nextElementSibling).toBe(languageToggle);
  });

  it("muestra el contenido recibido dentro del área principal", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <AppShell locale="en">
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByText("Contenido de la sección"));
  });
});
