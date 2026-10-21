import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileTabBar } from "@/components/MobileTabBar";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname }));

const PHONE_QUERY = "(width < 768px)";
const BAR_BOTTOM = 664;
const TAB_BAR_NAME = "Secciones";

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

/** Los cuadros quedan en cola hasta que el test los pinta con `paintFrame`. */
function stubAnimationFrames(): {
  readonly paintFrame: () => void;
  readonly cancelAnimationFrame: ReturnType<typeof vi.fn>;
} {
  const pending = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  const cancelAnimationFrame = vi.fn((id: number) => pending.delete(id));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextId++;
    pending.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
  return {
    paintFrame: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      act(() => callbacks.forEach((callback) => callback(0)));
    },
    cancelAnimationFrame,
  };
}

/** jsdom no maqueta: la barra dice dónde está su borde, sin el transform. */
function stubBarBottom(): ReturnType<typeof vi.spyOn> {
  return vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement): DOMRect {
      const offset = Number(
        /translateY\((-?[\d.]+)px\)/.exec(this.style.transform)?.[1] ?? 0,
      );
      return DOMRect.fromRect({ y: 0, height: BAR_BOTTOM + offset });
    });
}

function renderTabBar(): ReturnType<typeof render> {
  usePathname.mockReturnValue("/dashboard");
  return render(
    <MobileTabBar
      locale="es"
      access={{ role: "Player", membershipCurrent: true }}
    />,
  );
}

/** También escondida: entonces no tiene nombre accesible que buscar. */
function tabBar(): HTMLElement {
  return screen.getByRole("navigation", { hidden: true });
}

function emit(visualViewport: FakeVisualViewport, type: string): void {
  act(() => {
    visualViewport.dispatchEvent(new Event(type));
  });
}

function addField(markup: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = markup;
  document.body.append(container);
  const field = container.firstElementChild;
  if (!(field instanceof HTMLElement)) {
    throw new Error(`No se pudo crear el campo ${markup}`);
  }
  return field;
}

/** jsdom no calcula `isContentEditable`: lo deduce el test del atributo,
 * como haría el navegador. */
function withContentEditable(field: HTMLElement): HTMLElement {
  if (field.getAttribute("contenteditable") === "true") {
    Object.defineProperty(field, "isContentEditable", { value: true });
    field.tabIndex = 0;
  }
  return field;
}

function focus(element: HTMLElement): void {
  act(() => element.focus());
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

// #703: Chrome en el iPhone esconde su barra de abajo y la ventana visible
// crece, pero la barra de pestañas se queda donde estaba. La barra sigue el
// fondo de `visualViewport`; cómo se ve lo prueba Playwright.
describe("barra pegada al fondo de la ventana visible", () => {
  beforeEach(() => {
    stubBarBottom();
  });

  it("baja la barra cuando la ventana visible crece al cambiar de tamaño", () => {
    stubPhoneScreen(true);
    const { paintFrame } = stubAnimationFrames();
    const visualViewport = stubVisualViewport();
    renderTabBar();

    visualViewport.height = BAR_BOTTOM + 49;
    emit(visualViewport, "resize");
    paintFrame();

    expect(tabBar().style.transform).toBe("translateY(49px)");
  });

  it("recoloca la barra al hacer scroll", () => {
    stubPhoneScreen(true);
    const { paintFrame } = stubAnimationFrames();
    const visualViewport = stubVisualViewport();
    renderTabBar();
    visualViewport.height = BAR_BOTTOM + 49;
    emit(visualViewport, "resize");
    paintFrame();

    visualViewport.height = BAR_BOTTOM;
    emit(visualViewport, "scroll");
    paintFrame();

    expect(tabBar().style.transform).toBe("");
  });

  it("no desplaza la barra cuando ya coincide con el fondo visible", () => {
    stubPhoneScreen(true);
    stubVisualViewport();

    renderTabBar();

    expect(tabBar().style.transform).toBe("");
  });

  it("deja la barra abajo cuando el teclado encoge la ventana visible", () => {
    stubPhoneScreen(true);
    const { paintFrame } = stubAnimationFrames();
    const visualViewport = stubVisualViewport();
    renderTabBar();
    focus(addField("<input>"));

    visualViewport.height = BAR_BOTTOM - 300;
    emit(visualViewport, "resize");
    paintFrame();

    expect(tabBar().style.transform).toBe("");
  });

  it("no sube la barra cuando la ventana visible queda más arriba al tirar para refrescar", () => {
    stubPhoneScreen(true);
    const { paintFrame } = stubAnimationFrames();
    const visualViewport = stubVisualViewport();
    renderTabBar();

    visualViewport.offsetTop = -80;
    emit(visualViewport, "scroll");
    paintFrame();

    expect(tabBar().style.transform).toBe("");
  });

  it("deja de escuchar la ventana visible al desmontarse", () => {
    stubPhoneScreen(true);
    const visualViewport = stubVisualViewport();
    const addListener = vi.spyOn(visualViewport, "addEventListener");
    const removeListener = vi.spyOn(visualViewport, "removeEventListener");
    const { unmount } = renderTabBar();

    unmount();

    const added = addListener.mock.calls.map(([type, listener]) => [
      type,
      listener,
    ]);
    const removed = removeListener.mock.calls.map(([type, listener]) => [
      type,
      listener,
    ]);
    expect(added.map(([type]) => type).sort()).toEqual(["resize", "scroll"]);
    expect(removed).toEqual(added);
  });

  it("no escucha la ventana visible a 768 px o más", () => {
    stubPhoneScreen(false);
    const visualViewport = stubVisualViewport();
    const addListener = vi.spyOn(visualViewport, "addEventListener");

    renderTabBar();

    expect(addListener).not.toHaveBeenCalled();
  });

  it("se queda como hoy en un navegador sin visualViewport", () => {
    stubPhoneScreen(true);
    vi.stubGlobal("visualViewport", undefined);

    renderTabBar();

    expect(tabBar().style.transform).toBe("");
  });
});

describe("recolocación en un cuadro", () => {
  it("varios eventos seguidos de la ventana visible miden la barra una sola vez", () => {
    stubPhoneScreen(true);
    const { paintFrame } = stubAnimationFrames();
    const visualViewport = stubVisualViewport();
    const measure = stubBarBottom();
    renderTabBar();
    measure.mockClear();

    visualViewport.height = BAR_BOTTOM + 49;
    emit(visualViewport, "scroll");
    emit(visualViewport, "resize");
    emit(visualViewport, "scroll");
    expect(measure).not.toHaveBeenCalled();
    paintFrame();

    expect(measure).toHaveBeenCalledTimes(1);
    expect(tabBar().style.transform).toBe("translateY(49px)");
  });

  it("cancela el cuadro pendiente al desmontarse", () => {
    stubPhoneScreen(true);
    const { cancelAnimationFrame } = stubAnimationFrames();
    const visualViewport = stubVisualViewport();
    stubBarBottom();
    const { unmount } = renderTabBar();
    emit(visualViewport, "scroll");

    unmount();

    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
  });
});

describe("barra de pestañas al escribir", () => {
  beforeEach(() => {
    stubBarBottom();
    stubVisualViewport();
  });

  it.each([
    ["un campo de texto", "<input>"],
    ["un campo de correo", '<input type="email">'],
    ["un área de texto", "<textarea></textarea>"],
    ["un elemento editable", '<div contenteditable="true"></div>'],
  ])(
    "se esconde en el móvil con el foco en %s, sin anunciarse",
    (_, markup) => {
      stubPhoneScreen(true);
      renderTabBar();

      focus(withContentEditable(addField(markup)));

      expect(tabBar()).not.toBeVisible();
      expect(
        screen.queryByRole("navigation", { name: TAB_BAR_NAME }),
      ).not.toBeInTheDocument();
    },
  );

  it.each([
    ["una casilla", '<input type="checkbox">'],
    ["un radio", '<input type="radio">'],
    ["un rango", '<input type="range">'],
    ["un botón", "<button>Guardar</button>"],
    ["un selector de archivo", '<input type="file">'],
    ["un selector de color", '<input type="color">'],
  ])("no se esconde con el foco en %s", (_, markup) => {
    stubPhoneScreen(true);
    renderTabBar();

    focus(addField(markup));

    expect(tabBar()).toBeVisible();
  });

  it("vuelve cuando el foco sale del campo", () => {
    stubPhoneScreen(true);
    renderTabBar();
    const field = addField("<input>");
    focus(field);

    act(() => field.blur());

    expect(
      screen.getByRole("navigation", { name: TAB_BAR_NAME }),
    ).toBeVisible();
  });

  it("vuelve cuando el foco pasa del campo a un botón", () => {
    stubPhoneScreen(true);
    renderTabBar();
    const field = addField("<input>");
    const button = addField("<button>Guardar</button>");
    focus(field);

    focus(button);

    expect(tabBar()).toBeVisible();
  });

  it("no reaparece mientras el foco sale de un campo camino de otro", () => {
    stubPhoneScreen(true);
    renderTabBar();
    const first = addField("<input>");
    const second = addField("<textarea></textarea>");
    focus(first);

    act(() => {
      first.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: second }),
      );
    });

    expect(tabBar()).not.toBeVisible();
  });

  it("no cambia nada a 768 px o más", () => {
    stubPhoneScreen(false);
    renderTabBar();

    focus(addField("<input>"));

    expect(tabBar()).not.toHaveAttribute("hidden");
  });
});
