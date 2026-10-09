// WCAG 2.x relative luminance / contrast ratio, per
// https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
function toLinearChannel(channel8Bit: number): number {
  const channel = channel8Bit / 255;
  return channel <= 0.03928
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function hexChannels(hex: string): readonly [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  const digits = match?.[1];
  if (digits === undefined) {
    throw new Error(`Not a 6-digit hex color: ${hex}`);
  }
  return [
    parseInt(digits.slice(0, 2), 16),
    parseInt(digits.slice(2, 4), 16),
    parseInt(digits.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexChannels(hex);
  return (
    0.2126 * toLinearChannel(r) +
    0.7152 * toLinearChannel(g) +
    0.0722 * toLinearChannel(b)
  );
}

export function contrastRatio(hexA: string, hexB: string): number {
  const luminanceA = relativeLuminance(hexA);
  const luminanceB = relativeLuminance(hexB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** The colour `color-mix(in srgb, <tint> N%, transparent)` paints over an
 * opaque surface, with `weight` as N / 100. */
export function tintOver(
  tint: string,
  surface: string,
  weight: number,
): string {
  const [tintR, tintG, tintB] = hexChannels(tint);
  const [surfaceR, surfaceG, surfaceB] = hexChannels(surface);
  const mixChannel = (tintChannel: number, surfaceChannel: number): string =>
    Math.round(tintChannel * weight + surfaceChannel * (1 - weight))
      .toString(16)
      .padStart(2, "0");
  return `#${mixChannel(tintR, surfaceR)}${mixChannel(tintG, surfaceG)}${mixChannel(tintB, surfaceB)}`;
}
