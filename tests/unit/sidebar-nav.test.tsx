import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarNav } from "@/components/SidebarNav";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname }));

describe("navegación", () => {
  it("contiene exactamente las siete secciones esperadas, cada una con su ruta", () => {
    usePathname.mockReturnValue("/dashboard");
    render(<SidebarNav locale="es" />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(7);
    expect(links.map((link) => link.textContent)).toEqual([
      "Dashboard",
      "Directorio",
      "Calendario",
      "Equipos",
      "Evaluaciones",
      "Noticias",
      "Pagos",
    ]);
    expect(screen.getByRole("link", { name: "Calendario" })).toHaveAttribute(
      "href",
      "/calendario",
    );
  });

  it("no marca ninguna sección como actual fuera del menú", () => {
    usePathname.mockReturnValue("/");
    render(<SidebarNav locale="es" />);

    expect(
      screen.queryByRole("link", { current: "page" }),
    ).not.toBeInTheDocument();
  });
});

describe("navegación traducida", () => {
  it("nombra las secciones en inglés sin cambiar a dónde llevan", () => {
    usePathname.mockReturnValue("/dashboard");
    render(<SidebarNav locale="en" />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Dashboard",
      "Directory",
      "Calendar",
      "Teams",
      "Evaluations",
      "News",
      "Payments",
    ]);
    expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute(
      "href",
      "/calendario",
    );
  });

  it.each([
    ["en", "Main"],
    ["es", "Principal"],
  ] as const)(
    "nombra el menú en el idioma de la visita (%s)",
    (locale, name) => {
      usePathname.mockReturnValue("/dashboard");
      render(<SidebarNav locale={locale} />);

      expect(screen.getByRole("navigation", { name })).toBeInTheDocument();
    },
  );

  it.each([
    ["en", "Calendar"],
    ["es", "Calendario"],
  ] as const)(
    "marca como actual la sección de la ruta activa, y solo esa (%s)",
    (locale, label) => {
      usePathname.mockReturnValue("/calendario");
      render(<SidebarNav locale={locale} />);

      const current = screen.getAllByRole("link", { current: "page" });
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveTextContent(label);
    },
  );
});
