import { describe, expect, it } from "vitest";
import {
  summarizeGeneral,
  summarizePositions,
  summarizeSessionPacks,
  summarizeSignInTexts,
} from "@/lib/club/club-settings-summaries";
import type { ClubSettings } from "@/lib/club/club-settings";
import type {
  ManagedPosition,
  ManagedPositions,
} from "@/lib/club/manage-club-positions";
import { NO_SIGN_IN_TEXTS } from "@/lib/club/sign-in-texts";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * Los resúmenes de una línea de la lista de la configuración en el móvil
 * (#718, #3a del handoff de E26): salen de lo que guardó el club.
 */

const english = createTranslator("en");
const spanish = createTranslator("es");

const SETTINGS: ClubSettings = {
  name: "Victoria Seadragons",
  initials: "VS",
  accentColor: "#33a1e0",
  logoUrl: "https://logos.example.test/club.png",
  seasonStartsOn: null,
};

function position(id: string, isArchived: boolean): ManagedPosition {
  return {
    id,
    names: { en: id, es: id },
    isArchived,
    coverage: null,
    minPerTeam: 0,
    shortNames: { en: null, es: null },
  };
}

const SIX_ACTIVE_ONE_ARCHIVED: ManagedPositions = [
  ...["gk", "fb", "hb", "c", "f", "u"].map((id) => position(id, false)),
  position("old", true),
];

describe("el resumen de General", () => {
  it("nombra lo que tiene el club, con el color en mayúsculas", () => {
    expect(summarizeGeneral(spanish, SETTINGS)).toBe(
      "Nombre, iniciales, color #33A1E0, logo",
    );
  });

  it("sale en inglés", () => {
    expect(summarizeGeneral(english, SETTINGS)).toBe(
      "Name, initials, colour #33A1E0, logo",
    );
  });

  it("sin logo no lo nombra", () => {
    expect(summarizeGeneral(spanish, { ...SETTINGS, logoUrl: null })).toBe(
      "Nombre, iniciales, color #33A1E0",
    );
  });

  it("sin iniciales no las nombra", () => {
    expect(summarizeGeneral(spanish, { ...SETTINGS, initials: null })).toBe(
      "Nombre, color #33A1E0, logo",
    );
  });
});

describe("el resumen de la página de inicio de sesión", () => {
  it("dice qué idioma tiene texto propio", () => {
    const texts = {
      ...NO_SIGN_IN_TEXTS,
      es: { tagline: "Bajo el agua", welcome: null },
    };

    expect(summarizeSignInTexts(spanish, texts)).toBe(
      "Inglés: texto de la app · Español: propio",
    );
  });

  it("sin textos propios dice que los dos son los de la app", () => {
    expect(summarizeSignInTexts(english, NO_SIGN_IN_TEXTS)).toBe(
      "English: app text · Español: app text",
    );
  });

  it("cuenta como propio un idioma con sólo el párrafo", () => {
    const texts = {
      ...NO_SIGN_IN_TEXTS,
      en: { tagline: null, welcome: "Welcome" },
    };

    expect(summarizeSignInTexts(english, texts)).toBe(
      "English: custom · Español: app text",
    );
  });
});

describe("el resumen de Posiciones", () => {
  it("cuenta las activas y las archivadas", () => {
    expect(summarizePositions(spanish, SIX_ACTIVE_ONE_ARCHIVED)).toBe(
      "6 posiciones · 1 archivada",
    );
  });

  it("sale en inglés", () => {
    expect(summarizePositions(english, SIX_ACTIVE_ONE_ARCHIVED)).toBe(
      "6 positions · 1 archived",
    );
  });

  it("sin archivadas no las nombra", () => {
    expect(
      summarizePositions(
        spanish,
        SIX_ACTIVE_ONE_ARCHIVED.filter((item) => !item.isArchived),
      ),
    ).toBe("6 posiciones");
  });

  it("usa el singular con una sola", () => {
    expect(summarizePositions(spanish, [position("gk", false)])).toBe(
      "1 posición",
    );
  });

  it("cuenta en plural varias archivadas", () => {
    expect(
      summarizePositions(spanish, [
        position("gk", false),
        position("a", true),
        position("b", true),
      ]),
    ).toBe("1 posición · 2 archivadas");
  });
});

describe("el resumen de los packs", () => {
  it("cuenta los packs y lista sus sesiones en orden", () => {
    expect(summarizeSessionPacks(spanish, [5, 10, 20, 8])).toBe(
      "4 packs · 5, 10, 20, 8 sesiones",
    );
  });

  it("sale en inglés", () => {
    expect(summarizeSessionPacks(english, [5, 10, 20, 8])).toBe(
      "4 packs · 5, 10, 20, 8 sessions",
    );
  });

  it("usa el singular con un solo pack de una sesión", () => {
    expect(summarizeSessionPacks(english, [1])).toBe("1 pack · 1 session");
  });

  it("sin packs lo dice", () => {
    expect(summarizeSessionPacks(spanish, [])).toBe("Sin packs");
  });
});
