import { act, render, screen } from "@testing-library/react";
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
    ["Player", ["Pagos"]],
    ["Committee", ["Pagos", "Grupos"]],
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

  it("un Coach tiene fijas Inicio, Agenda, Equipos y Noticias, y en Más Directorio, Asistencia, Evaluaciones, Pagos y Grupos", async () => {
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
  it("un Player tiene fijas Inicio, Agenda y Pagos, y ningún Más vacío", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <MobileTabBar
        locale="es"
        access={{ role: "Player", membershipCurrent: false }}
      />,
    );

    expect(fixedTabLabels()).toEqual(["Inicio", "Agenda", "Pagos"]);
    expect(
      screen.queryByRole("button", { name: "Más" }),
    ).not.toBeInTheDocument();
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

// #703: Chrome en el iPhone esconde su barra de abajo y la ventana visible
// crece, pero la barra de pestañas se queda donde estaba. La barra sigue el
// fondo de `visualViewport`; cómo se ve lo prueba Playwright.
describe("barra pegada al fondo de la ventana visible", () => {
  const PHONE_QUERY = "(width < 768px)";
  const BAR_BOTTOM = 664;

  class FakeVisualViewport extends EventTarget {
    height = BAR_BOTTOM;
    offsetTop = 0;
    scale = 1;
  }

  function stubPhoneScreen(isPhone: boolean): void {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: isPhone && query === PHONE_QUERY,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
  }

  function stubVisualViewport(): FakeVisualViewport {
    const visualViewport = new FakeVisualViewport();
    vi.stubGlobal("visualViewport", visualViewport);
    return visualViewport;
  }

  /** jsdom no maqueta: la barra dice dónde está su borde, sin el transform. */
  function stubBarBottom(): void {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement): DOMRect {
        const offset = Number(
          /translateY\((-?[\d.]+)px\)/.exec(this.style.transform)?.[1] ?? 0,
        );
        return DOMRect.fromRect({ y: 0, height: BAR_BOTTOM + offset });
      },
    );
  }

  function renderPhoneBar(): ReturnType<typeof render> {
    usePathname.mockReturnValue("/dashboard");
    return render(
      <MobileTabBar
        locale="es"
        access={{ role: "Player", membershipCurrent: true }}
      />,
    );
  }

  function tabBar(): HTMLElement {
    return screen.getByRole("navigation");
  }

  function emit(visualViewport: FakeVisualViewport, type: string): void {
    act(() => {
      visualViewport.dispatchEvent(new Event(type));
    });
  }

  beforeEach(() => stubBarBottom());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("baja la barra cuando la ventana visible crece al cambiar de tamaño", () => {
    stubPhoneScreen(true);
    const visualViewport = stubVisualViewport();
    renderPhoneBar();

    visualViewport.height = BAR_BOTTOM + 49;
    emit(visualViewport, "resize");

    expect(tabBar().style.transform).toBe("translateY(49px)");
  });

  it("recoloca la barra al hacer scroll", () => {
    stubPhoneScreen(true);
    const visualViewport = stubVisualViewport();
    renderPhoneBar();
    visualViewport.height = BAR_BOTTOM + 49;
    emit(visualViewport, "resize");

    visualViewport.height = BAR_BOTTOM;
    emit(visualViewport, "scroll");

    expect(tabBar().style.transform).toBe("");
  });

  it("no desplaza la barra cuando ya coincide con el fondo visible", () => {
    stubPhoneScreen(true);
    stubVisualViewport();

    renderPhoneBar();

    expect(tabBar().style.transform).toBe("");
  });

  it("deja la barra abajo cuando el teclado encoge la ventana visible", () => {
    stubPhoneScreen(true);
    const visualViewport = stubVisualViewport();
    renderPhoneBar();
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();

    visualViewport.height = BAR_BOTTOM - 300;
    emit(visualViewport, "resize");

    expect(tabBar().style.transform).toBe("");
    field.remove();
  });

  it("deja de escuchar la ventana visible al desmontarse", () => {
    stubPhoneScreen(true);
    const visualViewport = stubVisualViewport();
    const removeListener = vi.spyOn(visualViewport, "removeEventListener");
    const { unmount } = renderPhoneBar();

    unmount();

    expect(removeListener.mock.calls.map(([type]) => type).sort()).toEqual([
      "resize",
      "scroll",
    ]);
  });

  it("no escucha la ventana visible a 768 px o más", () => {
    stubPhoneScreen(false);
    const visualViewport = stubVisualViewport();
    const addListener = vi.spyOn(visualViewport, "addEventListener");

    renderPhoneBar();

    expect(addListener).not.toHaveBeenCalled();
  });

  it("se queda como hoy en un navegador sin visualViewport", () => {
    stubPhoneScreen(true);
    vi.stubGlobal("visualViewport", undefined);

    renderPhoneBar();

    expect(tabBar().style.transform).toBe("");
  });
});
