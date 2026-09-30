import type { MetadataRoute } from "next";
import { CLUB_ICON_PATH } from "@/lib/auth/routes";
import { paintableAccentColor } from "@/lib/club/club-icon";
import {
  ANDROID_ICON_SIZE_PX,
  describeServedClubIcons,
} from "@/lib/club/serve-club-icon";
import { readClubBrand } from "@/lib/club/supabase-club-brand";

/**
 * Lo mínimo para añadir la aplicación a la pantalla de inicio del móvil
 * (#421): el nombre, el icono de 512 px y el acento del club. Sin modo sin
 * conexión ni service worker, a propósito.
 */

// Sin esto Next lo genera una vez en el build, con la marca de ese momento.
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const [brand, icons] = await Promise.all([
    readClubBrand(),
    describeServedClubIcons([ANDROID_ICON_SIZE_PX]),
  ]);
  return {
    name: brand.name,
    short_name: brand.name,
    start_url: "/",
    display: "browser",
    theme_color: paintableAccentColor(brand.accentColor),
    icons: icons.map((icon) => ({
      src: `${CLUB_ICON_PATH}/${icon.id}`,
      sizes: `${icon.size.width}x${icon.size.height}`,
      type: icon.contentType,
    })),
  };
}
