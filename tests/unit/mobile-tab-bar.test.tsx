import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MobileTabBar } from "@/components/MobileTabBar";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname }));

describe("barra de pestañas móvil", () => {
  it("muestra las cuatro secciones frecuentes como pestañas fijas", () => {
    usePathname.mockReturnValue("/dashboard");
    render(<MobileTabBar locale="es" />);

    const tabs = screen.getAllByRole("link");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Inicio",
      "Agenda",
      "Equipos",
      "Noticias",
    ]);
  });

  it("la pestaña Inicio sigue enlazando a /dashboard aunque su etiqueta cambie (#85)", () => {
    usePathname.mockReturnValue("/dashboard");
    render(<MobileTabBar locale="es" />);

    expect(screen.getByRole("link", { name: "Inicio" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("mantiene las secciones restantes fuera del alcance hasta abrir Más", () => {
    usePathname.mockReturnValue("/dashboard");
    render(<MobileTabBar locale="es" />);

    expect(
      screen.queryByRole("link", { name: "Pagos" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Más" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("revela las tres secciones restantes al pulsar Más", async () => {
    const user = userEvent.setup();
    usePathname.mockReturnValue("/dashboard");
    render(<MobileTabBar locale="es" />);

    await user.click(screen.getByRole("button", { name: "Más" }));

    expect(
      screen.getByRole("link", { name: "Directorio" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Evaluaciones" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pagos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Más" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("marca como actual la pestaña que corresponde a la ruta activa, y solo esa", () => {
    usePathname.mockReturnValue("/calendario");
    render(<MobileTabBar locale="es" />);

    const current = screen.getAllByRole("link", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Agenda");
  });

  it("marca el botón Más cuando la ruta activa vive en el desbordamiento", () => {
    usePathname.mockReturnValue("/pagos");
    render(<MobileTabBar locale="es" />);

    expect(screen.getByRole("button", { name: "Más" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(
      screen.queryByRole("link", { current: "page" }),
    ).not.toBeInTheDocument();
  });

  it("no marca nada cuando la ruta no pertenece al menú", () => {
    usePathname.mockReturnValue("/");
    render(<MobileTabBar locale="es" />);

    expect(
      screen.queryByRole("link", { current: "page" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Más" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("muestra un icono decorativo además de la etiqueta en cada pestaña fija", () => {
    usePathname.mockReturnValue("/dashboard");
    render(<MobileTabBar locale="es" />);

    const tabs = screen.getAllByRole("link");
    expect(tabs).toHaveLength(4);
    for (const tab of tabs) {
      const icon = tab.querySelector("svg");
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("el nombre accesible de cada pestaña es solo su etiqueta, sin texto del icono", () => {
    usePathname.mockReturnValue("/dashboard");
    render(<MobileTabBar locale="es" />);

    for (const label of ["Inicio", "Agenda", "Equipos", "Noticias"]) {
      expect(screen.getByRole("link", { name: label })).toHaveAccessibleName(
        label,
      );
    }
  });

  it("el botón Más tiene icono propio, distinto de los de sección, y conserva aria-expanded", () => {
    usePathname.mockReturnValue("/dashboard");
    render(<MobileTabBar locale="es" />);

    const moreButton = screen.getByRole("button", { name: "Más" });
    const moreIcon = moreButton.querySelector("svg");
    expect(moreIcon).not.toBeNull();
    expect(moreIcon).toHaveAttribute("aria-hidden", "true");

    const sectionIconMarkup = screen
      .getAllByRole("link")
      .map((tab) => tab.querySelector("svg")?.outerHTML);
    expect(sectionIconMarkup).not.toContain(moreIcon?.outerHTML);

    expect(moreButton).toHaveAccessibleName("Más");
    expect(moreButton).toHaveAttribute("aria-expanded", "false");
  });
});

// E17 RF-5: las pestañas en inglés siguen el mockup móvil
// (docs/mockups/mobile-home-light.png).
describe("navegación traducida en la barra móvil", () => {
  it("nombra las pestañas fijas en inglés", () => {
    usePathname.mockReturnValue("/dashboard");
    render(<MobileTabBar locale="en" />);

    const tabs = screen.getAllByRole("link");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Home",
      "Calendar",
      "Teams",
      "News",
    ]);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("revela en inglés las tres secciones restantes al pulsar More", async () => {
    const user = userEvent.setup();
    usePathname.mockReturnValue("/dashboard");
    render(<MobileTabBar locale="en" />);

    await user.click(screen.getByRole("button", { name: "More" }));

    const overflow = ["Directory", "Evaluations", "Payments"];
    for (const label of overflow) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it.each([
    ["en", "Sections"],
    ["es", "Secciones"],
  ] as const)(
    "nombra la barra en el idioma de la visita (%s)",
    (locale, name) => {
      usePathname.mockReturnValue("/dashboard");
      render(<MobileTabBar locale={locale} />);

      expect(screen.getByRole("navigation", { name })).toBeInTheDocument();
    },
  );

  it.each([
    ["en", "Calendar"],
    ["es", "Agenda"],
  ] as const)(
    "marca la pestaña de la ruta activa igual en los dos idiomas (%s)",
    (locale, label) => {
      usePathname.mockReturnValue("/calendario");
      render(<MobileTabBar locale={locale} />);

      const current = screen.getAllByRole("link", { current: "page" });
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveTextContent(label);
    },
  );

  it("marca el botón More cuando la ruta activa vive en el desbordamiento", () => {
    usePathname.mockReturnValue("/pagos");
    render(<MobileTabBar locale="en" />);

    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});
