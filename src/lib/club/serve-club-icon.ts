import {
  CLUB_ICON_CONTENT_TYPE,
  type ClubIconMetadata,
  type LogoBytesReader,
  clubIconSizeFromId,
  describeClubIcons,
  renderClubIcon,
} from "./club-icon";
import { readClubBrand } from "./supabase-club-brand";

/**
 * Lo que comparten `src/app/icon.tsx` y `src/app/apple-icon.tsx` (#421): leer
 * la marca, traer el logo y responder el PNG.
 */

/** El icono de Android: lo declaran `icon.tsx` y el manifest. */
export const ANDROID_ICON_SIZE_PX = 512;

/** Un día. La dirección lleva la huella de la marca, así que un logo nuevo no
 * espera a que caduque: es otra dirección. */
const CLUB_ICON_CACHE_CONTROL = "public, max-age=86400";

/** El icono sale con las iniciales antes de los dos segundos que pide el
 * ticket aunque el almacenamiento no conteste. */
const LOGO_READ_TIMEOUT_MS = 1_500;

/** El logo está en el cajón público `club-logos`: se trae por su dirección,
 * sin llave. */
const fetchLogoBytes: LogoBytesReader = async (logoUrl, signal) => {
  const response = await fetch(logoUrl, { signal });
  if (!response.ok) {
    throw new Error(`el logo respondió ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
};

export async function describeServedClubIcons(
  sizesPx: readonly number[],
): Promise<ClubIconMetadata[]> {
  return describeClubIcons(await readClubBrand(), sizesPx);
}

export async function serveClubIcon(id: Promise<string>): Promise<Response> {
  const [brand, iconId] = await Promise.all([readClubBrand(), id]);
  const png = await renderClubIcon({
    brand,
    sizePx: clubIconSizeFromId(iconId),
    readLogoBytes: fetchLogoBytes,
    readTimeoutMs: LOGO_READ_TIMEOUT_MS,
  });
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": CLUB_ICON_CONTENT_TYPE,
      "Cache-Control": CLUB_ICON_CACHE_CONTROL,
    },
  });
}
