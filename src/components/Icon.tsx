import type {
  Icon as PhosphorGlyph,
  IconWeight,
} from "@phosphor-icons/react/dist/lib/types";

/** Los dos pesos que usa el handoff del directorio (#547). */
type GlyphWeight = Extract<IconWeight, "regular" | "fill">;

/** Un icono de Phosphor, siempre decorativo: el nombre accesible lo lleva el
 * control que lo contiene. Mide `1em` y pinta con `currentColor`, así que el
 * tamaño y el color salen del texto de alrededor y no se repiten en cada uso.
 * El glifo se importa por archivo desde `dist/ssr` (lo exige ESLint). */
export function Icon({
  glyph: Glyph,
  weight = "regular",
}: {
  readonly glyph: PhosphorGlyph;
  readonly weight?: GlyphWeight;
}): React.JSX.Element {
  return (
    <Glyph
      aria-hidden="true"
      focusable="false"
      size="1em"
      color="currentColor"
      weight={weight}
    />
  );
}
