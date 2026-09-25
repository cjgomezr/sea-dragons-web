/**
 * El color de acento del club (#294, RF-3 del PRD de E18a). El club elige un
 * solo color (decisión D1); el texto que va encima se calcula, y el acento
 * se rechaza sólo si ningún texto encima llega a AA.
 *
 * Un mismo color no puede servir de enlace sobre el panel blanco y sobre el
 * panel oscuro: el que se lee en uno se pierde en el otro. Por eso el tema
 * oscuro lleva el color del club aclarado, igual que hoy lleva un azul más
 * claro que el del tema claro. Y un acento claro, como un amarillo, rellena
 * los botones tal cual pero pinta los enlaces del tema claro con una variante
 * oscurecida (#341).
 *
 * Los colores de la paleta que se nombran aquí son copia de `globals.css`, y
 * `tests/unit/club/accent-color.test.ts` exige que sigan siéndolo.
 */

/** WCAG 2.1, criterio 1.4.3: texto normal. */
export const AA_NORMAL_TEXT_CONTRAST = 4.5;

/** El `--color-accent` del tema claro, y lo que `0022_club_brand.sql` siembra. */
export const DEFAULT_ACCENT_COLOR = "#1c6ea4";

/** El panel y el fondo del tema claro: donde un enlace de acento se lee. */
export const LIGHT_ACCENT_SURFACES = ["#ffffff", "#eff3f7"] as const;

/** El panel y el fondo del tema oscuro. */
export const DARK_ACCENT_SURFACES = ["#13283a", "#0c1a26"] as const;

/** Los dos `--color-on-accent` de hoy. No se inventa un color de texto: se
 * elige el que mejor se lee de los que la paleta ya tiene. */
export const ON_ACCENT_CANDIDATES = ["#ffffff", "#0c1a26"] as const;

export type AccentPair = {
  /** El relleno de botones y estados activos. */
  readonly accent: string;
  /** El texto sobre ese relleno. */
  readonly onAccent: string;
  /** El acento usado como texto (enlaces, foco) sobre los fondos del tema. */
  readonly accentText: string;
};

export type AccentPalette = {
  readonly light: AccentPair;
  readonly dark: AccentPair;
};

export type AccentRejection = "not_hex" | "no_readable_text";

export type AccentEvaluation =
  | { readonly kind: "accepted"; readonly palette: AccentPalette }
  | { readonly kind: "rejected"; readonly reason: AccentRejection };

type Rgb = readonly [red: number, green: number, blue: number];

/** Tono en grados; saturación y claridad entre 0 y 1. */
type Hsl = readonly [hue: number, saturation: number, lightness: number];

/** El mismo formato que exige `clubs_accent_color_hex` en la base. */
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const MAX_CHANNEL = 255;

/** En cuántos pasos se acerca al blanco el acento del tema oscuro: de 5 en 5
 * por ciento, un cambio que a la vista apenas se nota. */
const DARK_LIGHTENING_STEPS = 20;

/** Lo mismo al revés para el enlace del tema claro: de 5 en 5 por ciento de
 * la claridad del club hacia el negro. */
const LIGHT_DARKENING_STEPS = 20;

const DEGREES_PER_HUE_SECTOR = 60;
const HUE_SECTORS = 6;

export function isHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

function toRgb(hex: string): Rgb {
  if (!isHexColor(hex)) {
    throw new Error(`No es un color hexadecimal de seis cifras: ${hex}`);
  }
  const channelAt = (start: number): number =>
    parseInt(hex.slice(start, start + 2), 16);
  return [channelAt(1), channelAt(3), channelAt(5)];
}

function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** https://www.w3.org/TR/WCAG21/#dfn-relative-luminance */
function linearChannel(channel8Bit: number): number {
  const channel = channel8Bit / MAX_CHANNEL;
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([red, green, blue]: Rgb): number {
  return (
    0.2126 * linearChannel(red) +
    0.7152 * linearChannel(green) +
    0.0722 * linearChannel(blue)
  );
}

/** https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio */
export function contrastRatio(hexA: string, hexB: string): number {
  const luminanceA = relativeLuminance(toRgb(hexA));
  const luminanceB = relativeLuminance(toRgb(hexB));
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

function readsOnAll(color: string, surfaces: readonly string[]): boolean {
  return surfaces.every(
    (surface) => contrastRatio(color, surface) >= AA_NORMAL_TEXT_CONTRAST,
  );
}

function bestOnAccent(accent: string): string {
  const [first, ...rest] = ON_ACCENT_CANDIDATES;
  return rest.reduce<string>(
    (best, candidate) =>
      contrastRatio(accent, candidate) > contrastRatio(accent, best)
        ? candidate
        : best,
    first,
  );
}

function mixWithWhite([red, green, blue]: Rgb, whiteShare: number): Rgb {
  const mix = (channel: number): number =>
    channel + (MAX_CHANNEL - channel) * whiteShare;
  return [mix(red), mix(green), mix(blue)];
}

/** El color del club, cada vez más cerca del blanco, hasta que se lee sobre
 * los fondos oscuros. El blanco se lee siempre, así que termina. */
function lightenForDarkTheme(accent: string): string {
  const rgb = toRgb(accent);
  for (let step = 0; step <= DARK_LIGHTENING_STEPS; step += 1) {
    const candidate = toHex(mixWithWhite(rgb, step / DARK_LIGHTENING_STEPS));
    if (readsOnAll(candidate, DARK_ACCENT_SURFACES)) {
      return candidate;
    }
  }
  throw new Error(`Ni el blanco se lee sobre los fondos oscuros: ${accent}`);
}

/** https://www.w3.org/TR/css-color-4/#rgb-to-hsl */
function toHsl(rgb: Rgb): Hsl {
  const [red, green, blue] = rgb.map((channel) => channel / MAX_CHANNEL) as [
    number,
    number,
    number,
  ];
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
      ? ((green - blue) / chroma + HUE_SECTORS) % HUE_SECTORS
      : max === green
        ? (blue - red) / chroma + 2
        : (red - green) / chroma + 4;
  return [sector * DEGREES_PER_HUE_SECTOR, saturation, lightness];
}

/** https://www.w3.org/TR/css-color-4/#hsl-to-rgb */
function fromHsl([hue, saturation, lightness]: Hsl): Rgb {
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number): number => {
    const position = (offset + hue / 30) % 12;
    const ramp = Math.max(-1, Math.min(position - 3, 9 - position, 1));
    return (lightness - amplitude * ramp) * MAX_CHANNEL;
  };
  return [channel(0), channel(8), channel(4)];
}

/**
 * El color del club, cada vez más oscuro, hasta que se lee como enlace sobre
 * los fondos claros. Baja la claridad en HSL y deja quietos el tono y la
 * saturación: restar lo mismo a cada canal RGB desplazaría el tono. El negro
 * se lee siempre, así que termina.
 */
function darkenForLightTheme(accent: string): string {
  if (readsOnAll(accent, LIGHT_ACCENT_SURFACES)) {
    return accent;
  }
  const [hue, saturation, lightness] = toHsl(toRgb(accent));
  for (let step = 1; step <= LIGHT_DARKENING_STEPS; step += 1) {
    const darkerLightness = lightness * (1 - step / LIGHT_DARKENING_STEPS);
    const candidate = toHex(fromHsl([hue, saturation, darkerLightness]));
    if (readsOnAll(candidate, LIGHT_ACCENT_SURFACES)) {
      return candidate;
    }
  }
  throw new Error(`Ni el negro se lee sobre los fondos claros: ${accent}`);
}

function pairFor(accent: string, accentText: string): AccentPair {
  return { accent, onAccent: bestOnAccent(accent), accentText };
}

export function evaluateAccentColor(value: string): AccentEvaluation {
  if (!isHexColor(value)) {
    return { kind: "rejected", reason: "not_hex" };
  }
  const accent = value.toLowerCase();
  const light = pairFor(accent, darkenForLightTheme(accent));
  if (contrastRatio(light.accent, light.onAccent) < AA_NORMAL_TEXT_CONTRAST) {
    return { kind: "rejected", reason: "no_readable_text" };
  }
  const darkAccent = lightenForDarkTheme(accent);
  return {
    kind: "accepted",
    palette: { light, dark: pairFor(darkAccent, darkAccent) },
  };
}
