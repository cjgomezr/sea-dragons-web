import { afterEach, describe, expect, it, vi } from "vitest";
import { goBackOrHome } from "@/components/go-back";

/**
 * El atrás de un botón de volver: a la pantalla de antes si la hay, y si no
 * al inicio. Sin la API de navegación (Safari antiguo) decide la historia.
 */

function fakeRouter(): { back: () => void; push: (href: string) => void } {
  return { back: vi.fn(), push: vi.fn() };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sin la API de navegación", () => {
  it("con más de una entrada en la historia vuelve atrás", () => {
    vi.stubGlobal("navigation", undefined);
    vi.spyOn(window.history, "length", "get").mockReturnValue(3);
    const router = fakeRouter();

    goBackOrHome(router);

    expect(router.back).toHaveBeenCalledOnce();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("con sólo esta entrada lleva al inicio", () => {
    vi.stubGlobal("navigation", undefined);
    vi.spyOn(window.history, "length", "get").mockReturnValue(1);
    const router = fakeRouter();

    goBackOrHome(router);

    expect(router.push).toHaveBeenCalledWith("/dashboard");
    expect(router.back).not.toHaveBeenCalled();
  });
});
