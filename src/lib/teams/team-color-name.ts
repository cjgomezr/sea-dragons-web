/**
 * El color de un equipo dicho con palabras (#403, RF-8 del PRD de E10): el
 * reparto guarda un `#RRGGBB` cualquiera (D5) y la tarjeta del jugador dice
 * "de color azul", para el lector de pantalla y para quien no distingue el
 * color. Basta con la familia del color, que es lo que se dice de un peto.
 */

export type TeamColorName =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "black"
  | "white"
  | "grey";

/** Por debajo de esta saturación el color no tiene tono: es un gris. */
const MINIMUM_SATURATION = 0.15;
const BLACK_BELOW_LIGHTNESS = 0.2;
const WHITE_ABOVE_LIGHTNESS = 0.85;

/** Dónde acaba cada familia en la rueda de tonos, en grados. El rojo cierra
 * la rueda: lo que pasa del rosa vuelve a ser rojo. */
const HUE_FAMILIES: readonly {
  readonly upTo: number;
  readonly name: TeamColorName;
}[] = [
  { upTo: 15, name: "red" },
  { upTo: 38, name: "orange" },
  { upTo: 70, name: "yellow" },
  { upTo: 165, name: "green" },
  { upTo: 260, name: "blue" },
  { upTo: 300, name: "purple" },
  { upTo: 345, name: "pink" },
  { upTo: 360, name: "red" },
];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const HEXADECIMAL = 16;
const CHANNEL_MAX = 255;
const DEGREES_PER_SEXTANT = 60;
const FULL_TURN = 360;

type Hsl = {
  readonly hue: number;
  readonly saturation: number;
  readonly lightness: number;
};

function readChannels(hex: string): readonly [number, number, number] {
  if (!HEX_COLOR.test(hex)) {
    throw new Error(`"${hex}" no es un color #RRGGBB.`);
  }
  const channelAt = (start: number): number =>
    Number.parseInt(hex.slice(start, start + 2), HEXADECIMAL) / CHANNEL_MAX;
  return [channelAt(1), channelAt(3), channelAt(5)];
}

function hueOf(
  [red, green, blue]: readonly [number, number, number],
  max: number,
  chroma: number,
): number {
  if (chroma === 0) {
    return 0;
  }
  const sextant =
    max === red
      ? (green - blue) / chroma
      : max === green
        ? (blue - red) / chroma + 2
        : (red - green) / chroma + 4;
  return (sextant * DEGREES_PER_SEXTANT + FULL_TURN) % FULL_TURN;
}

function toHsl(hex: string): Hsl {
  const channels = readChannels(hex);
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  const chroma = max - min;
  const lightness = (max + min) / 2;
  const saturation =
    chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1));
  return { hue: hueOf(channels, max, chroma), saturation, lightness };
}

function nameGrey(lightness: number): TeamColorName {
  if (lightness < BLACK_BELOW_LIGHTNESS) {
    return "black";
  }
  return lightness > WHITE_ABOVE_LIGHTNESS ? "white" : "grey";
}

export function nameTeamColor(hex: string): TeamColorName {
  const { hue, saturation, lightness } = toHsl(hex);
  if (
    saturation < MINIMUM_SATURATION ||
    lightness < BLACK_BELOW_LIGHTNESS ||
    lightness > WHITE_ABOVE_LIGHTNESS
  ) {
    return nameGrey(lightness);
  }
  const family = HUE_FAMILIES.find((candidate) => hue < candidate.upTo);
  if (family === undefined) {
    throw new Error(`El tono ${hue} se sale de la rueda.`);
  }
  return family.name;
}
