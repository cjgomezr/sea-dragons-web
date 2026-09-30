import type { ClubIconMetadata } from "@/lib/club/club-icon";
import {
  ANDROID_ICON_SIZE_PX,
  describeServedClubIcons,
  serveClubIcon,
} from "@/lib/club/serve-club-icon";

/**
 * El icono de la pestaña y los marcadores (32 px) y el de Android (512 px,
 * el que usa el manifest), sacados de la marca del club (#421).
 */

// Sin esto Next lo genera una vez en el build, con la marca de ese momento.
export const dynamic = "force-dynamic";

const TAB_ICON_SIZE_PX = 32;

export function generateImageMetadata(): Promise<ClubIconMetadata[]> {
  return describeServedClubIcons([TAB_ICON_SIZE_PX, ANDROID_ICON_SIZE_PX]);
}

export default function Icon({
  id,
}: {
  id: Promise<string>;
}): Promise<Response> {
  return serveClubIcon(id);
}
