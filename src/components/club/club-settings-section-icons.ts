import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import { IdentificationCard } from "@phosphor-icons/react/dist/ssr/IdentificationCard";
import { SignIn } from "@phosphor-icons/react/dist/ssr/SignIn";
import { SoccerBall } from "@phosphor-icons/react/dist/ssr/SoccerBall";
import { Ticket } from "@phosphor-icons/react/dist/ssr/Ticket";
import type { ClubSettingsSection } from "@/lib/club/club-settings-sections";

/** El icono de cada sección, el mismo en la pestaña de escritorio y en la
 * fila de la lista del móvil (#718). El balón es el del handoff: Phosphor no
 * tiene uno de rugby subacuático. */
export const CLUB_SETTINGS_SECTION_ICONS: Readonly<
  Record<ClubSettingsSection, PhosphorGlyph>
> = {
  general: IdentificationCard,
  "sign-in": SignIn,
  positions: SoccerBall,
  packs: Ticket,
};
