import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileTabBar } from "@/components/MobileTabBar";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname }));

function fixedTabLabels(): (string | null)[] {
  return screen.getAllByRole("link").map((tab) => tab.textContent);
}

async function openMoreAndListIt(): Promise<(string | null)[]> {
  const user = userEvent.setup();
  const before = new Set(screen.getAllByRole("link"));
  await user.click(screen.getByRole("button", { name: /^(Más|More)$/ }));
  return screen
    .getAllByRole("link")
    .filter((link) => !before.has(link))
    .map((link) => link.textContent);
}

// FR-013 (#213): las cuatro fijas son las primeras de uso diario que el rol
// puede abrir, y Directorio ocupa el hueco de Equipos.
describe("barra móvil por rol", () => {
  it.each([
    ["Player", ["Entrenamiento", "Pagos"]],
    ["Committee", ["Entrenamiento", "Pagos", "Grupos"]],
  ] as const)(
    "un %s tiene fijas Inicio, Agenda, Gente y Noticias, y el resto en Más",
    async (role, overflowLabels) => {
      usePathname.mockReturnValue("/dashboard");
      render(
        <MobileTabBar locale="es" access={{ role, membershipCurrent: true }} />,
      );

      expect(fixedTabLabels()).toEqual([
        "Inicio",
        "Agenda",
        "Gente",
        "Noticias",
      ]);
      expect(await openMoreAndListIt()).toEqual([...overflowLabels]);
    },
  );

  it("un Coach tiene fijas Inicio, Agenda, Equipos y Noticias, y en Más Directorio, Asistencia, Evaluaciones, Entrenamiento, Pagos y Grupos", async () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <MobileTabBar
        locale="es"
        access={{ role: "Coach", membershipCurrent: true }}
      />,
    );

    expect(fixedTabLabels()).toEqual([
      "Inicio",
      "Agenda",
      "Equipos",
      "Noticias",
    ]);
    expect(await openMoreAndListIt()).toEqual([
      "Directorio",
      "Asistencia",
      "Evaluaciones",
      "Entrenamiento",
      "Pagos",
      "Grupos",
    ]);
  });

  it("un Admin tiene las fijas del Coach, y en Más Grupos pero ninguna Administración", async () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <MobileTabBar
        locale="en"
        access={{ role: "Admin", membershipCurrent: true }}
      />,
    );

    expect(fixedTabLabels()).toEqual(["Home", "Events", "Teams", "News"]);
    expect(await openMoreAndListIt()).toEqual([
      "Directory",
      "Attendance",
      "Evaluations",
      "Training",
      "Payments",
      "Groups",
    ]);
  });

  // La etiqueta corta es sólo para la pestaña: el panel de Más ocupa todo el
  // ancho y nombra la sección como la barra lateral.
  it("nombra Directorio completo en Más aunque su pestaña use la corta", async () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <MobileTabBar
        locale="en"
        access={{ role: "Coach", membershipCurrent: true }}
      />,
    );

    expect(await openMoreAndListIt()).toContain("Directory");
  });

  it("marca Más cuando un Admin está en Grupos", () => {
    usePathname.mockReturnValue("/grupos");
    render(
      <MobileTabBar
        locale="es"
        access={{ role: "Admin", membershipCurrent: true }}
      />,
    );

    expect(screen.getByRole("button", { name: "Más" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});

describe("barra de pestañas móvil", () => {
  it("muestra las cuatro secciones frecuentes como pestañas fijas", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <MobileTabBar
        locale="es"
        access={{ role: "Coach", membershipCurrent: true }}
      />,
    );

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
    render(
      <MobileTabBar
        locale="es"
        access={{ role: "Coach", membershipCurrent: true }}
      />,
    );

    expect(screen.getByRole("link", { name: "Inicio" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("mantiene las secciones restantes fuera del alcance hasta abrir Más", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <MobileTabBar
        locale="es"
        access={{ role: "Coach", membershipCurrent: true }}
      />,
    );

    expect(
      screen.queryByRole("link", { name: "Pagos" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Más" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("revela las secciones restantes al pulsar Más", async () => {
    const user = userEvent.setup();
    usePathname.mockReturnValue("/dashboard");
    render(
      <MobileTabBar
        locale="es"
        access={{ role: "Coach", membershipCurrent: true }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Más" }));

    expect(
      screen.getByRole("link", { name: "Directorio" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Evaluaciones" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pagos" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Grupos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Más" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("marca como actual la pestaña que corresponde a la ruta activa, y solo esa", () => {
    usePathname.mockReturnValue("/calendario");
    render(
      <MobileTabBar
        locale="es"
        access={{ role: "Coach", membershipCurrent: true }}
      />,
    );

    const current = screen.getAllByRole("link", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Agenda");
  });

  it("marca el botón Más cuando la ruta activa vive en el desbordamiento", () => {
    usePathname.mockReturnValue("/pagos");
    render(
      <MobileTabBar
        locale="es"
        access={{ role: "Coach", membershipCurrent: true }}
      />,
    );

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
    render(
      <MobileTabBar
        locale="es"
        access={{ role: "Coach", membershipCurrent: true }}
      />,
    );

    expect(
      screen.queryByRole("link", { current: "page" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Más" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("muestra un icono decorativo además de la etiqueta en cada pestaña fija", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <MobileTabBar
        locale="es"
        access={{ role: "Coach", membershipCurrent: true }}
      />,
    );

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
    render(
      <MobileTabBar
        locale="es"
        access={{ role: "Coach", membershipCurrent: true }}
      />,
    );

    for (const label of ["Inicio", "Agenda", "Equipos", "Noticias"]) {
      expect(screen.getByRole("link", { name: label })).toHaveAccessibleName(
        label,
      );
    }
  });

  it("el botón Más tiene icono propio, distinto de los de sección, y conserva aria-expanded", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <MobileTabBar
        locale="es"
        access={{ role: "Coach", membershipCurrent: true }}
      />,
    );

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
// (docs/mockups/mobile-home-light.png), salvo Calendar, que se acorta a Events
// por ancho (ver messages/en.ts).
describe("navegación traducida en la barra móvil", () => {
  it("nombra las pestañas fijas en inglés", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <MobileTabBar
        locale="en"
        access={{ role: "Coach", membershipCurrent: true }}
      />,
    );

    const tabs = screen.getAllByRole("link");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Home",
      "Events",
      "Teams",
      "News",
    ]);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("revela en inglés las secciones restantes al pulsar More", async () => {
    const user = userEvent.setup();
    usePathname.mockReturnValue("/dashboard");
    render(
      <MobileTabBar
        locale="en"
        access={{ role: "Coach", membershipCurrent: true }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "More" }));

    const overflow = [
      "Directory",
      "Attendance",
      "Evaluations",
      "Training",
      "Payments",
      "Groups",
    ];
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
      render(
        <MobileTabBar
          locale={locale}
          access={{ role: "Coach", membershipCurrent: true }}
        />,
      );

      expect(screen.getByRole("navigation", { name })).toBeInTheDocument();
    },
  );

  it.each([
    ["en", "Events"],
    ["es", "Agenda"],
  ] as const)(
    "marca la pestaña de la ruta activa igual en los dos idiomas (%s)",
    (locale, label) => {
      usePathname.mockReturnValue("/calendario");
      render(
        <MobileTabBar
          locale={locale}
          access={{ role: "Coach", membershipCurrent: true }}
        />,
      );

      const current = screen.getAllByRole("link", { current: "page" });
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveTextContent(label);
    },
  );

  it("marca el botón More cuando la ruta activa vive en el desbordamiento", () => {
    usePathname.mockReturnValue("/pagos");
    render(
      <MobileTabBar
        locale="en"
        access={{ role: "Coach", membershipCurrent: true }}
      />,
    );

    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});

describe("barra móvil de quien no tiene la membresía al día (#453)", () => {
  it("un Player tiene fijas Inicio, Agenda y Pagos, y Entrenamiento en Más", async () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <MobileTabBar
        locale="es"
        access={{ role: "Player", membershipCurrent: false }}
      />,
    );

    expect(fixedTabLabels()).toEqual(["Inicio", "Agenda", "Pagos"]);
    expect(await openMoreAndListIt()).toEqual(["Entrenamiento"]);
  });
});

// #577: la barra vive en el layout y no se desmonta al navegar; si nada cierra
// Más, el menú se queda abierto encima de la página nueva.
describe("cierre del menú Más (#577)", () => {
  function coachBar(): React.JSX.Element {
    return (
      <MobileTabBar
        locale="es"
        access={{ role: "Coach", membershipCurrent: true }}
      />
    );
  }

  function renderCoachBarAt(pathname: string): {
    rerenderAt: (nextPathname: string) => void;
  } {
    usePathname.mockReturnValue(pathname);
    const { rerender } = render(coachBar());
    return {
      rerenderAt: (nextPathname) => {
        usePathname.mockReturnValue(nextPathname);
        rerender(coachBar());
      },
    };
  }

  function moreButton(): HTMLElement {
    return screen.getByRole("button", { name: "Más" });
  }

  function expectMenuClosed(): void {
    expect(moreButton()).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("link", { name: "Pagos" }),
    ).not.toBeInTheDocument();
  }

  // Los enlaces de la barra no navegan en jsdom: el clic basta para probar
  // que el menú se cierra sin esperar a que cambie la ruta.
  function preventNavigation(event: MouseEvent): void {
    event.preventDefault();
  }
  beforeEach(() => document.addEventListener("click", preventNavigation));
  afterEach(() => document.removeEventListener("click", preventNavigation));

  it("cierra el menú al elegir una de sus secciones", async () => {
    const user = userEvent.setup();
    renderCoachBarAt("/dashboard");
    await user.click(moreButton());

    await user.click(screen.getByRole("link", { name: "Pagos" }));

    expectMenuClosed();
  });

  it("cierra el menú al pulsar otra pestaña", async () => {
    const user = userEvent.setup();
    renderCoachBarAt("/dashboard");
    await user.click(moreButton());

    await user.click(screen.getByRole("link", { name: "Agenda" }));

    expectMenuClosed();
  });

  it("cierra el menú con un toque fuera de la barra", async () => {
    const user = userEvent.setup();
    renderCoachBarAt("/dashboard");
    await user.click(moreButton());

    await user.click(document.body);

    expectMenuClosed();
  });

  it("Escape cierra el menú y devuelve el foco a Más", async () => {
    const user = userEvent.setup();
    renderCoachBarAt("/dashboard");
    await user.click(moreButton());
    screen.getByRole("link", { name: "Pagos" }).focus();

    await user.keyboard("{Escape}");

    expectMenuClosed();
    expect(moreButton()).toHaveFocus();
  });

  it("cierra el menú cuando cambia la ruta", async () => {
    const user = userEvent.setup();
    const { rerenderAt } = renderCoachBarAt("/dashboard");
    await user.click(moreButton());

    rerenderAt("/noticias");

    expectMenuClosed();
  });

  it("sigue cerrado al volver atrás a la ruta donde se abrió", async () => {
    const user = userEvent.setup();
    const { rerenderAt } = renderCoachBarAt("/dashboard");
    await user.click(moreButton());
    rerenderAt("/noticias");

    rerenderAt("/dashboard");

    expectMenuClosed();
  });

  it("pulsar Más con el menú abierto lo cierra una sola vez", async () => {
    const user = userEvent.setup();
    renderCoachBarAt("/dashboard");
    await user.click(moreButton());

    await user.click(moreButton());

    expectMenuClosed();
  });
});
