import { describe, expect, it } from "vitest";
import {
  AA_NORMAL_TEXT_CONTRAST,
  type AccentPalette,
  DARK_ACCENT_SURFACES,
  DEFAULT_ACCENT_COLOR,
  LIGHT_ACCENT_SURFACES,
  ON_ACCENT_CANDIDATES,
  contrastRatio,
  evaluateAccentColor,
} from "@/lib/club/accent-color";
import {
  cssBlock,
  cssCustomProperties,
  readGlobalsCss,
} from "../helpers/css-tokens";

/**
 * El color de acento del club (#294, RF-3 del PRD de E18a). El club elige
 * uno; el texto encima se calcula y el par tiene que llegar a AA.
 */

/** Morado: lejos del azul de hoy, y legible sobre los fondos claros. */
const CLUB_ACCENT = "#7b3fa0";

function acceptedPalette(value: string): AccentPalette {
  const evaluation = evaluateAccentColor(value);
  if (evaluation.kind !== "accepted") {
    throw new Error(`${value} fue rechazado: ${evaluation.reason}`);
  }
  return evaluation.palette;
}

describe("color de acento", () => {
  describe("formato", () => {
    it("acepta un hexadecimal de seis cifras", () => {
      expect(evaluateAccentColor(CLUB_ACCENT).kind).toBe("accepted");
    });

    it("guarda el color en minúsculas, como lo compara la base", () => {
      expect(acceptedPalette("#7B3FA0").light.accent).toBe(CLUB_ACCENT);
    });

    it.each([
      "7b3fa0",
      "#7b3",
      "#7b3fa0ff",
      "#7g3fa0",
      "purple",
      "",
      " #7b3fa0",
    ])("rechaza %j por no ser un hexadecimal válido", (value) => {
      expect(evaluateAccentColor(value)).toEqual({
        kind: "rejected",
        reason: "not_hex",
      });
    });
  });

  describe("texto encima", () => {
    it("pone texto blanco sobre un acento oscuro", () => {
      expect(acceptedPalette(CLUB_ACCENT).light.onAccent).toBe("#ffffff");
    });

    it("el par del tema claro llega a AA", () => {
      const { light } = acceptedPalette(CLUB_ACCENT);

      expect(
        contrastRatio(light.accent, light.onAccent),
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_CONTRAST);
    });

    it("rechaza un acento con el que ningún texto llega a AA", () => {
      // Gris medio: 4.29:1 con blanco y 4.11:1 con el texto oscuro.
      expect(evaluateAccentColor("#7a7a7a")).toEqual({
        kind: "rejected",
        reason: "no_readable_text",
      });
    });

    it("sólo elige entre los textos de la paleta", () => {
      expect(ON_ACCENT_CANDIDATES).toEqual(["#ffffff", "#0c1a26"]);
    });
  });

  describe("el acento como texto", () => {
    it("rechaza un acento que no se lee sobre el fondo claro, aunque lleve texto legible", () => {
      // Amarillo: el texto oscuro encima se lee, pero un enlace amarillo
      // sobre el panel blanco no.
      expect(evaluateAccentColor("#ffd700")).toEqual({
        kind: "rejected",
        reason: "unreadable_on_background",
      });
    });

    it("rechaza un acento igual al fondo", () => {
      expect(evaluateAccentColor("#eff3f7").kind).toBe("rejected");
    });

    it.each(LIGHT_ACCENT_SURFACES)(
      "el acento aceptado se lee sobre %s en el tema claro",
      (surface) => {
        expect(
          contrastRatio(acceptedPalette(CLUB_ACCENT).light.accent, surface),
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_CONTRAST);
      },
    );
  });

  describe("tema oscuro", () => {
    it.each(["#7b3fa0", "#1c6ea4", "#2e7d32", "#b3261e", "#000000"])(
      "aclara %s hasta que se lee sobre los fondos oscuros",
      (value) => {
        const { dark } = acceptedPalette(value);

        for (const surface of DARK_ACCENT_SURFACES) {
          expect(contrastRatio(dark.accent, surface)).toBeGreaterThanOrEqual(
            AA_NORMAL_TEXT_CONTRAST,
          );
        }
        expect(
          contrastRatio(dark.accent, dark.onAccent),
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_CONTRAST);
      },
    );

    it("conserva el tono del club al aclararlo", () => {
      const { dark } = acceptedPalette(CLUB_ACCENT);

      // Morado sigue siendo morado: el azul y el rojo por encima del verde.
      const [red, green, blue] = [1, 3, 5].map((start) =>
        parseInt(dark.accent.slice(start, start + 2), 16),
      );
      expect(blue).toBeGreaterThan(green ?? 0);
      expect(red).toBeGreaterThan(green ?? 0);
    });
  });

  describe("cálculo de contraste", () => {
    it("da 21:1 entre negro y blanco", () => {
      expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    });

    it("da 1:1 entre un color y él mismo", () => {
      expect(contrastRatio(CLUB_ACCENT, CLUB_ACCENT)).toBe(1);
    });

    it("no depende del orden", () => {
      expect(contrastRatio("#ffffff", CLUB_ACCENT)).toBe(
        contrastRatio(CLUB_ACCENT, "#ffffff"),
      );
    });

    it("deja #767676 sobre blanco justo por encima del umbral", () => {
      expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT_CONTRAST,
      );
    });

    it("deja #777777 sobre blanco justo por debajo del umbral", () => {
      expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(
        AA_NORMAL_TEXT_CONTRAST,
      );
    });
  });

  describe("la paleta de globals.css", () => {
    const css = readGlobalsCss();
    const light = cssCustomProperties(cssBlock(css, ":root"));
    const dark = cssCustomProperties(cssBlock(css, ':root[data-theme="dark"]'));

    it("el acento por defecto es el del tema claro", () => {
      expect(DEFAULT_ACCENT_COLOR).toBe(light["color-accent"]);
    });

    it("los fondos claros son el panel y el fondo del tema claro", () => {
      expect(LIGHT_ACCENT_SURFACES).toEqual([
        light["color-panel"],
        light["color-background"],
      ]);
    });

    it("los fondos oscuros son el panel y el fondo del tema oscuro", () => {
      expect(DARK_ACCENT_SURFACES).toEqual([
        dark["color-panel"],
        dark["color-background"],
      ]);
    });

    it("los textos candidatos son los dos textos sobre acento de hoy", () => {
      expect(ON_ACCENT_CANDIDATES).toEqual([
        light["color-on-accent"],
        dark["color-on-accent"],
      ]);
    });
  });
});
