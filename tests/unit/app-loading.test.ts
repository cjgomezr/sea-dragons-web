import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_PAGE_PATH, CLUB_SETTINGS_PATH } from "@/lib/auth/routes";
import { NAV_SECTIONS } from "@/lib/navigation";

/** Un solo estado de carga en el grupo (app) cubre todas las secciones del
 * menú y sus subrutas (#435): Next lo pone entre el layout con el menú y
 * cualquier página de debajo. */
const APP_DIRECTORY = path.resolve(__dirname, "../../src/app");
const APP_GROUP_DIRECTORY = path.join(APP_DIRECTORY, "(app)");
const APP_LOADING_PATH = path.join(APP_GROUP_DIRECTORY, "loading.tsx");
const SECTION_PATHS = [
  ...NAV_SECTIONS.map((section) => section.href),
  ACCOUNT_PAGE_PATH,
  CLUB_SETTINGS_PATH,
];

function isLoadingFile(fileName: string): boolean {
  return /^loading\.(tsx|ts|jsx|js)$/.test(path.basename(fileName));
}

describe("el estado de carga del grupo (app)", () => {
  it("existe como src/app/(app)/loading.tsx", () => {
    expect(existsSync(APP_LOADING_PATH)).toBe(true);
  });

  it("exporta el componente por defecto", async () => {
    const loadingModule: { default: unknown } =
      await import("@/app/(app)/loading");

    expect(loadingModule.default).toBeTypeOf("function");
  });

  it.each(SECTION_PATHS)("la sección %s vive bajo el grupo (app)", (href) => {
    expect(existsSync(path.join(APP_GROUP_DIRECTORY, href))).toBe(true);
  });

  it("es el único loading de la aplicación", () => {
    const loadingFiles = readdirSync(APP_DIRECTORY, { recursive: true })
      .map(String)
      .filter(isLoadingFile);

    expect(loadingFiles).toEqual([path.join("(app)", "loading.tsx")]);
  });
});
