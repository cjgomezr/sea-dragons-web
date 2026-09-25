import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ACCENT_COLOR,
  evaluateAccentColor,
} from "@/lib/club/accent-color";
import { buildAccentStylesheet } from "@/lib/club/accent-stylesheet";
import { type ClubBrand, DEFAULT_CLUB_BRAND } from "@/lib/club/club-brand";

/**
 * #294 (E18a, RF-3): el color del club llega en el HTML que sirve el
 * servidor, dentro del `<head>`, así que la página sale ya con él aunque el
 * navegador no ejecute JavaScript.
 */

const CLUB_ACCENT = "#7b3fa0";

/** El amarillo del prototipo (#341): rellena bien, pero no se lee como
 * enlace sobre el fondo claro. */
const LIGHT_CLUB_ACCENT = "#ffc94a";

function darkenedAccentText(accent: string): string {
  const evaluation = evaluateAccentColor(accent);
  if (evaluation.kind !== "accepted") {
    throw new Error(`${accent} fue rechazado: ${evaluation.reason}`);
  }
  return evaluation.palette.light.accentText;
}

const servedBrand = vi.hoisted(() => ({
  current: null as ClubBrand | null,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/club/supabase-club-brand", () => ({
  readClubBrand: async () => servedBrand.current,
}));

const { default: RootLayout } = await import("@/app/layout");

async function servedHead(): Promise<string> {
  const markup = renderToStaticMarkup(await RootLayout({ children: <main /> }));
  const head = /<head>([\s\S]*)<\/head>/.exec(markup)?.[1];
  if (head === undefined) {
    throw new Error(`El layout no pintó un <head>: ${markup}`);
  }
  return head;
}

function customProperty(stylesheet: string, name: string): string[] {
  return [...stylesheet.matchAll(new RegExp(`--${name}:\\s*([^;}]+)`, "g"))]
    .map((match) => match[1] ?? "")
    .map((value) => value.trim());
}

beforeEach(() => {
  servedBrand.current = { ...DEFAULT_CLUB_BRAND, accentColor: CLUB_ACCENT };
});

describe("hoja del acento", () => {
  it("pinta el acento del club en el tema claro", () => {
    const stylesheet = buildAccentStylesheet(CLUB_ACCENT) ?? "";

    expect(stylesheet).toMatch(
      new RegExp(`html:root\\s*\\{[^}]*--color-accent:\\s*${CLUB_ACCENT}`),
    );
  });

  it("calcula el texto encima en lugar del fijo", () => {
    const stylesheet = buildAccentStylesheet(CLUB_ACCENT) ?? "";

    expect(customProperty(stylesheet, "color-on-accent")[0]).toBe("#ffffff");
  });

  it("repite el acento oscuro para el tema del sistema y para el elegido", () => {
    const stylesheet = buildAccentStylesheet(CLUB_ACCENT) ?? "";

    expect(stylesheet).toContain("@media (prefers-color-scheme: dark)");
    expect(stylesheet).toContain('html:root:not([data-theme="light"])');
    expect(stylesheet).toContain('html:root[data-theme="dark"]');
    const [light, systemDark, chosenDark] = customProperty(
      stylesheet,
      "color-accent",
    );
    expect(systemDark).toBe(chosenDark);
    expect(systemDark).not.toBe(light);
  });

  it("sólo toca el acento, el texto encima y el acento como texto: el resto de la paleta no cambia", () => {
    const stylesheet = buildAccentStylesheet(CLUB_ACCENT) ?? "";

    const properties = [...stylesheet.matchAll(/--([\w-]+):/g)].map(
      (match) => match[1],
    );
    expect(new Set(properties)).toEqual(
      new Set(["color-accent", "color-on-accent", "color-accent-text"]),
    );
  });

  it("no hace falta con el acento de hoy: lo pinta globals.css", () => {
    expect(buildAccentStylesheet(DEFAULT_ACCENT_COLOR)).toBeNull();
  });

  it("con un acento guardado que no llega a AA deja el de hoy", () => {
    expect(buildAccentStylesheet("#7a7a7a")).toBeNull();
  });

  it("con un acento claro, el relleno es el del club y el enlace del tema claro, su variante oscura", () => {
    const stylesheet = buildAccentStylesheet(LIGHT_CLUB_ACCENT) ?? "";

    expect(customProperty(stylesheet, "color-accent")[0]).toBe(
      LIGHT_CLUB_ACCENT,
    );
    expect(customProperty(stylesheet, "color-accent-text")[0]).toBe(
      darkenedAccentText(LIGHT_CLUB_ACCENT),
    );
  });

  it("con un acento que ya se lee, el enlace del tema claro es el mismo color", () => {
    const stylesheet = buildAccentStylesheet(CLUB_ACCENT) ?? "";

    expect(customProperty(stylesheet, "color-accent-text")[0]).toBe(
      CLUB_ACCENT,
    );
  });

  it("en el tema oscuro, el enlace es el acento aclarado", () => {
    const stylesheet = buildAccentStylesheet(LIGHT_CLUB_ACCENT) ?? "";

    const [, systemDark, chosenDark] = customProperty(
      stylesheet,
      "color-accent-text",
    );
    const [, darkAccent] = customProperty(stylesheet, "color-accent");
    expect(systemDark).toBe(darkAccent);
    expect(chosenDark).toBe(darkAccent);
  });
});

describe("inyección del color", () => {
  it("la página trae el color del club en el <head>", async () => {
    const head = await servedHead();

    expect(head).toMatch(
      new RegExp(`<style>[^<]*--color-accent:\\s*${CLUB_ACCENT}`),
    );
  });

  // La marca que no se puede leer se sirve como DEFAULT_CLUB_BRAND: eso lo
  // prueba el lector en caché de club-brand.test.ts.
  it("con la marca por defecto no inyecta hoja y manda globals.css", async () => {
    servedBrand.current = DEFAULT_CLUB_BRAND;

    const head = await servedHead();

    expect(head).not.toContain("--color-accent");
  });
});
