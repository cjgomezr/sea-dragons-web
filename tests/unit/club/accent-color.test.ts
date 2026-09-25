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
  isHexColor,
  normalizeAccentInput,
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

/** El morado aclarado para el tema oscuro, tal como lo calcula el #294. */
const DARK_CLUB_ACCENT = "#a982c1";

/** El amarillo de `docs/mockups/news-light.png`: 1.53:1 sobre blanco. */
const PROTOTYPE_YELLOW = "#ffc94a";

/** Cada paso quita un 5 % de la claridad original, como el #294 al aclarar. */
const DARKENING_STEP_SHARE = 0.05;

/** Redondear cada canal a 8 bits mueve el tono y la saturación un poco. */
const HUE_ROUNDING_TOLERANCE_DEGREES = 1.5;
const SATURATION_ROUNDING_TOLERANCE = 0.02;

type Hsl = readonly [hue: number, saturation: number, lightness: number];

/** https://www.w3.org/TR/css-color-4/#rgb-to-hsl, con claridad y saturación
 * entre 0 y 1. Va aquí y no importado para que el test no se fíe del código
 * que comprueba. */
function hslOf(hex: string): Hsl {
  const [red, green, blue] = [1, 3, 5].map(
    (start) => parseInt(hex.slice(start, start + 2), 16) / 255,
  ) as [number, number, number];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const chroma = max - min;
  if (chroma === 0) {
    return [0, 0, lightness];
  }
  const saturation = chroma / (1 - Math.abs(2 * lightness - 1));
  const sector =
    max === red
      ? ((green - blue) / chroma + 6) % 6
      : max === green
        ? (blue - red) / chroma + 2
        : (red - green) / chroma + 4;
  return [sector * 60, saturation, lightness];
}

/** https://www.w3.org/TR/css-color-4/#hsl-to-rgb */
function hexFromHsl([hue, saturation, lightness]: Hsl): string {
  const channel = (offset: number): number => {
    const k = (offset + hue / 30) % 12;
    const a = saturation * Math.min(lightness, 1 - lightness);
    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${[0, 8, 4]
    .map((offset) =>
      Math.round(channel(offset) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function cssCustomPropertyReferences(block: string): string[] {
  return [...block.matchAll(/var\(--([\w-]+)\)/g)].map(
    (match) => match[1] ?? "",
  );
}

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

  describe("variante de enlace", () => {
    it("acepta un acento claro como el amarillo del prototipo", () => {
      expect(evaluateAccentColor(PROTOTYPE_YELLOW).kind).toBe("accepted");
    });

    it("el botón lleva el color del club tal cual, con el texto que mejor contrasta", () => {
      const { light } = acceptedPalette(PROTOTYPE_YELLOW);

      expect(light.accent).toBe(PROTOTYPE_YELLOW);
      expect(light.onAccent).toBe("#0c1a26");
      expect(
        contrastRatio(light.accent, light.onAccent),
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_CONTRAST);
    });

    it.each(LIGHT_ACCENT_SURFACES)(
      "oscurece un acento claro hasta que el enlace se lee sobre %s",
      (surface) => {
        const { light } = acceptedPalette(PROTOTYPE_YELLOW);

        expect(light.accentText).not.toBe(PROTOTYPE_YELLOW);
        expect(contrastRatio(light.accentText, surface)).toBeGreaterThanOrEqual(
          AA_NORMAL_TEXT_CONTRAST,
        );
      },
    );

    it("oscurece lo justo: el paso anterior todavía no se leía", () => {
      const { light } = acceptedPalette(PROTOTYPE_YELLOW);
      const [hue, saturation, lightness] = hslOf(light.accentText);
      const previousStep = hexFromHsl([
        hue,
        saturation,
        lightness + hslOf(PROTOTYPE_YELLOW)[2] * DARKENING_STEP_SHARE,
      ]);

      expect(
        LIGHT_ACCENT_SURFACES.some(
          (surface) =>
            contrastRatio(previousStep, surface) < AA_NORMAL_TEXT_CONTRAST,
        ),
      ).toBe(true);
    });

    it("no toca un acento que ya se lee como enlace", () => {
      const { light } = acceptedPalette(CLUB_ACCENT);

      expect(light.accentText).toBe(CLUB_ACCENT);
    });

    it("deja tal cual un acento justo por encima del umbral", () => {
      // 5.03:1 sobre el panel y 4.51:1 sobre el fondo.
      expect(acceptedPalette("#6f6f6f").light.accentText).toBe("#6f6f6f");
    });

    it("oscurece un acento justo por debajo del umbral", () => {
      // 4.95:1 sobre el panel pero 4.44:1 sobre el fondo.
      const { light } = acceptedPalette("#707070");

      expect(light.accent).toBe("#707070");
      expect(light.accentText).not.toBe("#707070");
      for (const surface of LIGHT_ACCENT_SURFACES) {
        expect(contrastRatio(light.accentText, surface)).toBeGreaterThanOrEqual(
          AA_NORMAL_TEXT_CONTRAST,
        );
      }
    });

    it.each([PROTOTYPE_YELLOW, "#e8b33a", "#ff8c00", "#a4de02", "#4ad6ff"])(
      "la variante de %s conserva el tono y la saturación: sólo cambia la claridad",
      (value) => {
        const [hue, saturation, lightness] = hslOf(value);

        const variant = hslOf(acceptedPalette(value).light.accentText);

        expect(Math.abs(variant[0] - hue)).toBeLessThanOrEqual(
          HUE_ROUNDING_TOLERANCE_DEGREES,
        );
        expect(Math.abs(variant[1] - saturation)).toBeLessThanOrEqual(
          SATURATION_ROUNDING_TOLERANCE,
        );
        expect(variant[2]).toBeLessThan(lightness);
      },
    );

    it("acepta hasta un acento igual al fondo, con el enlace oscurecido", () => {
      const { light } = acceptedPalette("#eff3f7");

      expect(contrastRatio(light.accentText, "#eff3f7")).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT_CONTRAST,
      );
    });
  });

  describe("qué se sigue rechazando", () => {
    it("un color que no es hexadecimal", () => {
      expect(evaluateAccentColor("amarillo")).toEqual({
        kind: "rejected",
        reason: "not_hex",
      });
    });

    it("un acento sin texto legible encima, aunque su enlace se pudiera oscurecer", () => {
      expect(evaluateAccentColor("#808080")).toEqual({
        kind: "rejected",
        reason: "no_readable_text",
      });
    });
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

    it("el enlace del tema oscuro es el acento aclarado de siempre", () => {
      const { dark } = acceptedPalette(PROTOTYPE_YELLOW);

      expect(dark.accentText).toBe(dark.accent);
    });

    it("aclara como lo dejó el #294: el morado sale #a982c1", () => {
      const { dark } = acceptedPalette(CLUB_ACCENT);

      expect(dark.accent).toBe(DARK_CLUB_ACCENT);
      expect(dark.accentText).toBe(DARK_CLUB_ACCENT);
    });

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

    it("sin acento propio, el acento como texto es el mismo acento en cada tema", () => {
      expect(light["color-accent-text"]).toBe(light["color-accent"]);
      expect(dark["color-accent-text"]).toBe(dark["color-accent"]);
    });

    // #341: con un acento claro el relleno no se lee como texto; el texto y
    // el contorno de foco van con su variante.
    it("ningún texto ni contorno de foco usa el acento de relleno", () => {
      const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "");

      expect(
        declarations.match(/^\s*(color|outline):[^;]*var\(--color-accent\)/gm),
      ).toBeNull();
    });

    // El punto de no leído es la única señal en escritorio: WCAG 1.4.11 le
    // pide 3:1 sobre el panel, y el relleno de un acento claro no lo da.
    it("el punto de no leído usa el acento como texto, no el de relleno", () => {
      expect(
        cssCustomPropertyReferences(cssBlock(css, ".notification-unread-dot")),
      ).toContain("color-accent-text");
      expect(cssBlock(css, ".notification-unread-dot")).not.toMatch(
        /var\(--color-accent\)/,
      );
    });

    it("los textos candidatos son los dos textos sobre acento de hoy", () => {
      expect(ON_ACCENT_CANDIDATES).toEqual([
        light["color-on-accent"],
        dark["color-on-accent"],
      ]);
    });
  });
});

describe("normalizar el código que escribe el Admin (#346)", () => {
  it.each([
    ["sin almohadilla", "7B3FA0", "#7b3fa0"],
    ["en mayúsculas", "#7B3FA0", "#7b3fa0"],
    ["con espacios alrededor", "  #7b3fa0 ", "#7b3fa0"],
  ])(
    "acepta un código %s y lo deja como lo guarda la base",
    (_case, typed, stored) => {
      expect(normalizeAccentInput(typed)).toBe(stored);
    },
  );

  it("deja tal cual lo que no es un hexadecimal, para que la validación lo rechace", () => {
    expect(normalizeAccentInput("purple")).toBe("#purple");
    expect(isHexColor(normalizeAccentInput("#12345"))).toBe(false);
  });
});
