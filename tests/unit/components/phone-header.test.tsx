/**
 * #957: en el móvil la cabecera se queda fija, y las barras que se pegan
 * arriba empiezan justo debajo. Su alto no es fijo (un nombre largo se parte
 * en dos líneas), así que la cabecera lo mide y lo publica en :root.
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhoneHeader } from "@/components/PhoneHeader";

const PHONE_QUERY = "(width < 768px)";
const HEIGHT_PROPERTY = "--app-phone-header-height";
const desktopMatchMedia = window.matchMedia;

let reportResize: () => void = () => undefined;
const disconnect = vi.fn();

class FakeResizeObserver {
  constructor(callback: () => void) {
    reportResize = callback;
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    disconnect();
  }
}

function emulatePhone(): void {
  window.matchMedia = (query: string) => ({
    ...desktopMatchMedia(query),
    matches: query === PHONE_QUERY,
  });
}

function setHeaderHeight(height: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width: 375, height }),
  );
}

function publishedHeight(): string {
  return document.documentElement.style.getPropertyValue(HEIGHT_PROPERTY);
}

function renderHeader(): ReturnType<typeof render> {
  return render(
    <PhoneHeader>
      <span>Victoria Seadragons</span>
    </PhoneHeader>,
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  window.matchMedia = desktopMatchMedia;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  disconnect.mockReset();
  document.documentElement.style.removeProperty(HEIGHT_PROPERTY);
});

describe("PhoneHeader", () => {
  it("pinta la cabecera con lo que lleva dentro", () => {
    const { getByRole } = renderHeader();

    expect(getByRole("complementary")).toHaveTextContent("Victoria Seadragons");
  });

  it("en el móvil publica su alto en :root al montarse", () => {
    emulatePhone();
    setHeaderHeight(77);

    renderHeader();

    expect(publishedHeight()).toBe("77px");
  });

  it("en el móvil vuelve a publicarlo cuando cambia su alto", () => {
    emulatePhone();
    setHeaderHeight(77);
    renderHeader();

    setHeaderHeight(101.5);
    act(() => reportResize());

    expect(publishedHeight()).toBe("101.5px");
  });

  it("al desmontarse quita la medida y deja de observar", () => {
    emulatePhone();
    setHeaderHeight(77);
    const { unmount } = renderHeader();

    unmount();

    expect(publishedHeight()).toBe("");
    expect(disconnect).toHaveBeenCalled();
  });

  // Desde 768 px la cabecera es la barra lateral, del alto de la ventana: su
  // medida no le sirve a nadie, y se queda el valor por defecto de la hoja.
  it("en tableta y escritorio no publica nada", () => {
    setHeaderHeight(900);

    renderHeader();

    expect(publishedHeight()).toBe("");
  });
});
