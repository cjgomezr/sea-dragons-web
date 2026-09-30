import { createHash } from "node:crypto";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { DEFAULT_ACCENT_COLOR, isHexColor } from "./accent-color";
import type { ClubBrand } from "./club-brand";
import { LOGO_MAX_INPUT_PIXELS } from "./decode-club-logo";

/**
 * El icono de la pestaña, los marcadores y la pantalla de inicio (#421, E18a).
 * Sigue a la marca de la cabecera (`ClubBrandMark`): el logo entero, o las
 * iniciales sobre el acento si no hay logo o no se puede leer.
 *
 * Qué va detrás del logo lo decide quien pide el icono (`IconSurface`). En la
 * pestaña y los marcadores, nada: el logo se ve como en la cabecera, sobre lo
 * que haya. En la pantalla de inicio, el acento del club con un margen, porque
 * iOS rellena de negro la transparencia y Android recorta el icono con una
 * máscara.
 *
 * El logo lo compone sharp, que decodifica PNG y WebP. Las iniciales las
 * pinta `next/og` y no un SVG pasado por sharp: librsvg busca las fuentes en
 * el sistema, y la función de Vercel no trae ninguna, así que el texto salía
 * vacío. `next/og` lleva su propia fuente.
 */

export type ClubIconBrand = Pick<
  ClubBrand,
  "initials" | "accentColor" | "logoUrl"
>;

/** Trae los bytes del logo. Tiene que dejar de esperar cuando `signal` se
 * aborta. */
export type LogoBytesReader = (
  logoUrl: string,
  signal: AbortSignal,
) => Promise<Uint8Array>;

/** Lo que va detrás del logo. `paddingShare` es el margen a cada lado como
 * fracción del lado del icono. */
export type IconSurface =
  | { readonly kind: "transparent" }
  | {
      readonly kind: "solid";
      readonly color: string;
      readonly paddingShare: number;
    };

export type RenderClubIconOptions = {
  readonly brand: ClubIconBrand;
  readonly sizePx: number;
  readonly surface: IconSurface;
  readonly readLogoBytes: LogoBytesReader;
  /** Pasado este plazo se pinta con las iniciales. */
  readonly readTimeoutMs: number;
};

const TRANSPARENT_BACKGROUND = { r: 0, g: 0, b: 0, alpha: 0 };

/** El texto del recuadro de iniciales de la cabecera. */
const INITIALS_COLOR = "#ffffff";

/** Las iniciales ocupan algo menos de la mitad del lado, como en la cabecera;
 * tres letras siguen cabiendo. */
const INITIALS_FONT_SHARE = 0.42;

/** Doce cifras hexadecimales bastan para que dos logos no choquen. */
const FINGERPRINT_LENGTH = 12;

/** Cambia cuando cambia lo que el icono enseña, para que la dirección nueva
 * no la tape la caché del navegador. La dirección del logo sirve de huella:
 * cada subida lleva un nombre de fichero nuevo (`club-logo.ts`). El acento va
 * siempre: sin logo es el fondo de las iniciales, y con logo es el fondo de la
 * pantalla de inicio. */
export function clubIconFingerprint(brand: ClubIconBrand): string {
  const source =
    brand.logoUrl === null
      ? `initials:${brand.initials}:${brand.accentColor}`
      : `logo:${brand.logoUrl}:${brand.accentColor}`;
  return createHash("sha256")
    .update(source)
    .digest("hex")
    .slice(0, FINGERPRINT_LENGTH);
}

/** Lo que guarda la base se pinta tal cual sólo si es un color. */
export function paintableAccentColor(accentColor: string): string {
  return isHexColor(accentColor) ? accentColor : DEFAULT_ACCENT_COLOR;
}

async function renderInitialsIcon(
  brand: ClubIconBrand,
  sizePx: number,
): Promise<Uint8Array> {
  const response = new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: paintableAccentColor(brand.accentColor),
        color: INITIALS_COLOR,
        fontSize: Math.round(sizePx * INITIALS_FONT_SHARE),
      }}
    >
      {brand.initials}
    </div>,
    { width: sizePx, height: sizePx },
  );
  return new Uint8Array(await response.arrayBuffer());
}

/** El logo entero y centrado en un cuadrado, nunca recortado ni deformado. */
async function renderLogoIcon(
  logoBytes: Uint8Array,
  sizePx: number,
  surface: IconSurface,
): Promise<Uint8Array> {
  // `failOn: "truncated"`: un fichero cortado falla en vez de pintarse a
  // medias, como en `decode-club-logo.ts`.
  const logo = sharp(logoBytes, {
    failOn: "truncated",
    limitInputPixels: LOGO_MAX_INPUT_PIXELS,
  });
  if (surface.kind === "transparent") {
    return logo
      .resize(sizePx, sizePx, {
        fit: "contain",
        background: TRANSPARENT_BACKGROUND,
      })
      .png()
      .toBuffer();
  }
  const background = paintableAccentColor(surface.color);
  const padding = Math.round(sizePx * surface.paddingShare);
  const innerPx = sizePx - 2 * padding;
  return logo
    .resize(innerPx, innerPx, { fit: "contain", background })
    .flatten({ background })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background,
    })
    .png()
    .toBuffer();
}

async function readLogoWithinTimeout(
  logoUrl: string,
  { readLogoBytes, readTimeoutMs }: RenderClubIconOptions,
): Promise<Uint8Array> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`el logo no llegó en ${readTimeoutMs}ms`));
    }, readTimeoutMs);
  });
  try {
    return await Promise.race([
      readLogoBytes(logoUrl, controller.signal),
      expiry,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** El PNG y qué enseña. `logo_fallback` son las iniciales puestas porque el
 * logo no se pudo leer: quien lo sirve no debe cachearlo como si fuera la
 * marca, o un fallo pasajero se queda pegado en el navegador. */
export type ClubIcon = {
  readonly kind: "brand" | "logo_fallback";
  readonly png: Uint8Array;
};

/** El icono cuadrado de `sizePx` en PNG. Nunca lanza por el logo: si no se
 * puede leer o no es una imagen, deja el fallo en el log y pinta las
 * iniciales. */
export async function renderClubIcon(
  options: RenderClubIconOptions,
): Promise<ClubIcon> {
  const { brand, sizePx, surface } = options;
  if (brand.logoUrl === null) {
    return { kind: "brand", png: await renderInitialsIcon(brand, sizePx) };
  }
  try {
    const logoBytes = await readLogoWithinTimeout(brand.logoUrl, options);
    return {
      kind: "brand",
      png: await renderLogoIcon(logoBytes, sizePx, surface),
    };
  } catch (error) {
    console.error(
      `[club-icon] no se pudo pintar el logo ${brand.logoUrl}; se pintan las iniciales:`,
      error,
    );
    return {
      kind: "logo_fallback",
      png: await renderInitialsIcon(brand, sizePx),
    };
  }
}

export const CLUB_ICON_CONTENT_TYPE = "image/png";

/** Lo que `generateImageMetadata` declara de cada icono. */
export type ClubIconMetadata = {
  readonly id: string;
  readonly size: { readonly width: number; readonly height: number };
  readonly contentType: typeof CLUB_ICON_CONTENT_TYPE;
};

/** El `id` es el último segmento de la dirección del icono: el tamaño y la
 * huella, así que un logo nuevo tiene dirección nueva. */
export function describeClubIcons(
  brand: ClubIconBrand,
  sizesPx: readonly number[],
): ClubIconMetadata[] {
  const fingerprint = clubIconFingerprint(brand);
  return sizesPx.map((sizePx) => ({
    id: `${sizePx}-${fingerprint}`,
    size: { width: sizePx, height: sizePx },
    contentType: CLUB_ICON_CONTENT_TYPE,
  }));
}

/** El tamaño de un `id` de `describeClubIcons`. */
export function clubIconSizeFromId(id: string): number {
  const sizePx = Number(id.split("-")[0]);
  if (!Number.isInteger(sizePx) || sizePx <= 0) {
    throw new Error(`No es el id de un icono del club: ${id}`);
  }
  return sizePx;
}
