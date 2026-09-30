import type { ClubIconMetadata } from "@/lib/club/club-icon";
import {
  ANDROID_ICON_SIZE_PX,
  TAB_ICON_SIZE_PX,
  describeServedClubIcons,
  serveClubIcon,
} from "@/lib/club/serve-club-icon";

/**
 * El icono de la pestaña y los marcadores (32 px) y el de Android (512 px,
 * el que usa el manifest), sacados de la marca del club (#421).
 */

// Sin esto Next lo genera una vez en el build, con la marca de ese momento.
export const dynamic = "force-dynamic";

// El de la pestaña va el último a propósito: Chrome y Safari eligen el icono
// por tamaño, pero Firefox se queda con el último `link` declarado, y el de
// 512 px lleva el cuadro del acento que en la pestaña no queremos.
export function generateImageMetadata(): Promise<ClubIconMetadata[]> {
  return describeServedClubIcons([ANDROID_ICON_SIZE_PX, TAB_ICON_SIZE_PX]);
}

export default function Icon({
  id,
}: {
  id: Promise<string>;
}): Promise<Response> {
  return serveClubIcon(id);
}
