import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Un solo estado de carga en el grupo (app) cubre todas las secciones del
 * menú y sus subrutas (#435): Next lo pone entre el layout con el menú y
 * cualquier página de debajo. */
const APP_LOADING_PATH = path.resolve(
  __dirname,
  "../../src/app/(app)/loading.tsx",
);

describe("el estado de carga del grupo (app)", () => {
  it("existe como src/app/(app)/loading.tsx", () => {
    expect(existsSync(APP_LOADING_PATH)).toBe(true);
  });

  it("exporta el componente por defecto", async () => {
    const loadingModule: { default: unknown } =
      await import("@/app/(app)/loading");

    expect(loadingModule.default).toBeTypeOf("function");
  });
});
