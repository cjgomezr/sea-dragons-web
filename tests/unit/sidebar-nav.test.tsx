import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarNav } from "@/components/SidebarNav";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname }));

function renderedLabels(): (string | null)[] {
  return screen.getAllByRole("link").map((link) => link.textContent);
}

const MEMBER_LABELS = [
  "Dashboard",
  "Directorio",
  "Calendario",
  "Noticias",
  "Pagos",
];

describe("secciones por rol", () => {
  it.each(["Player", "Committee"] as const)(
    "un %s ve Panel, Directorio, Calendario, Noticias y Pagos",
    (role) => {
      usePathname.mockReturnValue("/dashboard");
      render(<SidebarNav locale="es" role={role} />);

      expect(renderedLabels()).toEqual(MEMBER_LABELS);
      expect(
        screen.queryByRole("link", { name: "Administración" }),
      ).not.toBeInTheDocument();
    },
  );

  it("un Coach ve además Equipos y Evaluaciones, y no Administración", () => {
    usePathname.mockReturnValue("/dashboard");
    render(<SidebarNav locale="es" role="Coach" />);

    expect(renderedLabels()).toEqual([
      "Dashboard",
      "Directorio",
      "Calendario",
      "Equipos",
      "Evaluaciones",
      "Noticias",
      "Pagos",
    ]);
  });

  it("un Admin ve todas las secciones y Administración", () => {
    usePathname.mockReturnValue("/dashboard");
    render(<SidebarNav locale="es" role="Admin" />);

    expect(renderedLabels()).toEqual([
      "Dashboard",
      "Directorio",
      "Calendario",
      "Equipos",
      "Evaluaciones",
      "Noticias",
      "Pagos",
      "Administración",
    ]);
    expect(
      screen.getByRole("link", { name: "Administración" }),
    ).toHaveAttribute("href", "/administracion");
  });
});

describe("navegación", () => {
  it("enlaza cada sección a su ruta", () => {
    usePathname.mockReturnValue("/dashboard");
    render(<SidebarNav locale="es" role="Player" />);

    expect(screen.getByRole("link", { name: "Calendario" })).toHaveAttribute(
      "href",
      "/calendario",
    );
  });

  it("no marca ninguna sección como actual fuera del menú", () => {
    usePathname.mockReturnValue("/");
    render(<SidebarNav locale="es" role="Player" />);

    expect(
      screen.queryByRole("link", { current: "page" }),
    ).not.toBeInTheDocument();
  });
});

describe("navegación traducida", () => {
  it("nombra las secciones en inglés sin cambiar a dónde llevan", () => {
    usePathname.mockReturnValue("/dashboard");
    render(<SidebarNav locale="en" role="Admin" />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Dashboard",
      "Directory",
      "Calendar",
      "Teams",
      "Evaluations",
      "News",
      "Payments",
      "Administration",
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
      render(<SidebarNav locale={locale} role="Player" />);

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
      render(<SidebarNav locale={locale} role="Player" />);

      const current = screen.getAllByRole("link", { current: "page" });
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveTextContent(label);
    },
  );
});
