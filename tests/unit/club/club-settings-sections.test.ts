import { describe, expect, it } from "vitest";
import {
  readClubSettingsSection,
  searchWithClubSettingsSection,
} from "@/lib/club/club-settings-sections";

/**
 * Qué sección de la configuración del club abre `?tab=` (#718, D9 del PRD
 * de E26): la que nombra, si existe y el rol la ve; si no, ninguna. El
 * Committee sólo tiene Packs, diga lo que diga la dirección (D8).
 */

describe("la sección de la dirección de un Admin", () => {
  it.each([
    ["general", "general"],
    ["sign-in", "sign-in"],
    ["positions", "positions"],
    ["packs", "packs"],
  ] as const)("?tab=%s abre %s", (queryValue, section) => {
    expect(readClubSettingsSection(queryValue, true)).toBe(section);
  });

  it("no abre ninguna sin tab", () => {
    expect(readClubSettingsSection(null, true)).toBeNull();
  });

  it("no abre ninguna con un tab que no existe", () => {
    expect(readClubSettingsSection("billing", true)).toBeNull();
  });

  it("no confunde mayúsculas con una sección", () => {
    expect(readClubSettingsSection("General", true)).toBeNull();
  });
});

describe("la sección de la dirección de un Committee", () => {
  it.each([null, "general", "positions", "packs", "billing"])(
    "con ?tab=%s abre Packs",
    (queryValue) => {
      expect(readClubSettingsSection(queryValue, false)).toBe("packs");
    },
  );
});

describe("la dirección con una sección", () => {
  it("pone la sección en tab", () => {
    expect(searchWithClubSettingsSection(new URLSearchParams(), "packs")).toBe(
      "?tab=packs",
    );
  });

  it("cambia la sección que ya había", () => {
    expect(
      searchWithClubSettingsSection(
        new URLSearchParams("tab=general"),
        "sign-in",
      ),
    ).toBe("?tab=sign-in");
  });

  it("sin sección quita tab y deja la búsqueda vacía", () => {
    expect(
      searchWithClubSettingsSection(new URLSearchParams("tab=positions"), null),
    ).toBe("");
  });

  it("no toca los demás parámetros", () => {
    expect(
      searchWithClubSettingsSection(new URLSearchParams("a=1&tab=packs"), null),
    ).toBe("?a=1");
  });
});
