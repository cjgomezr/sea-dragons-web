import type { ClubIconMetadata } from "@/lib/club/club-icon";
import {
  describeServedClubIcons,
  serveClubIcon,
} from "@/lib/club/serve-club-icon";

/** El icono del acceso directo de iOS, sacado de la marca del club (#421). */

// Sin esto Next lo genera una vez en el build, con la marca de ese momento.
export const dynamic = "force-dynamic";

const APPLE_TOUCH_ICON_SIZE_PX = 180;

export function generateImageMetadata(): Promise<ClubIconMetadata[]> {
  return describeServedClubIcons([APPLE_TOUCH_ICON_SIZE_PX]);
}

export default function AppleIcon({
  id,
}: {
  id: Promise<string>;
}): Promise<Response> {
  return serveClubIcon(id);
}
