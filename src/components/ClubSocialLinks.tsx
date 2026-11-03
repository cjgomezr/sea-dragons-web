import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import { FacebookLogo } from "@phosphor-icons/react/dist/ssr/FacebookLogo";
import { Globe } from "@phosphor-icons/react/dist/ssr/Globe";
import { InstagramLogo } from "@phosphor-icons/react/dist/ssr/InstagramLogo";
import { TiktokLogo } from "@phosphor-icons/react/dist/ssr/TiktokLogo";
import { WhatsappLogo } from "@phosphor-icons/react/dist/ssr/WhatsappLogo";
import { YoutubeLogo } from "@phosphor-icons/react/dist/ssr/YoutubeLogo";
import { Icon } from "@/components/Icon";
import {
  SOCIAL_NETWORKS,
  type SocialLinks,
  type SocialNetwork,
} from "@/lib/club/social-links";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

const NETWORK_ICONS: Readonly<Record<SocialNetwork, PhosphorGlyph>> = {
  instagram: InstagramLogo,
  tiktok: TiktokLogo,
  youtube: YoutubeLogo,
  facebook: FacebookLogo,
  whatsapp: WhatsappLogo,
  website: Globe,
};

type SavedLink = { readonly network: SocialNetwork; readonly url: string };

function savedLinksOf(links: SocialLinks): readonly SavedLink[] {
  return SOCIAL_NETWORKS.flatMap((network): SavedLink[] => {
    const url = links[network];
    return url === null ? [] : [{ network, url }];
  });
}

/**
 * Las redes del club (#964, RF-2 y RF-3 del PRD de E37): un icono por red
 * guardada, en el orden fijo de `SOCIAL_NETWORKS`. Sin ninguna no pinta nada,
 * ni la lista: quien la coloca no tiene que preguntar antes.
 *
 * El nombre del enlace dice la red y el club; el icono es decorativo. Abre en
 * otra pestaña sin dar a la página de fuera acceso a esta.
 */
export function ClubSocialLinks({
  links,
  clubName,
  locale,
  className,
}: {
  links: SocialLinks;
  clubName: string;
  locale: Locale;
  /** Para colocar la lista donde la pinta quien la usa, sin un envoltorio
   * que quedaría vacío cuando no hay redes. */
  className?: string;
}): React.JSX.Element | null {
  const saved = savedLinksOf(links);
  if (saved.length === 0) {
    return null;
  }
  const translate = createTranslator(locale);
  return (
    <ul
      className={
        className === undefined
          ? "club-social-links"
          : `club-social-links ${className}`
      }
      aria-label={translate("club.socialLinks.label")}
    >
      {saved.map(({ network, url }) => {
        return (
          <li key={network}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={translate("club.socialLinks.link", {
                network: translate(
                  `clubSettings.socialLinks.network.${network}`,
                ),
                club: clubName,
              })}
            >
              <Icon glyph={NETWORK_ICONS[network]} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
