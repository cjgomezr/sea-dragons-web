import { describe, expect, it, vi } from "vitest";

/**
 * #703: iOS sólo deja que la página llegue bajo la raya de inicio, y que
 * `env(safe-area-inset-bottom)` valga algo, con `viewport-fit=cover`.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/club/supabase-club-brand", () => ({
  readClubBrand: async () => null,
}));

const { viewport } = await import("@/app/layout");

describe("viewport del layout raíz", () => {
  it("cubre la pantalla entera, raya de inicio incluida", () => {
    expect(viewport.viewportFit).toBe("cover");
  });

  it("conserva el ancho del dispositivo y la escala inicial que Next pone", () => {
    expect(viewport).toMatchObject({ width: "device-width", initialScale: 1 });
  });
});
