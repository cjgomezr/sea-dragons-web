import type { Role } from "@/lib/auth/roles";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import { ProfilePhoto } from "./ProfilePhoto";

/** La cabecera de Mi cuenta: la foto o las iniciales, el nombre y una línea
 * con el rol, como la de docs/mockups/mobile-profile-light.png. Las métricas
 * de ese mockup son de E5, E8 y E9 y no entran aquí. La foto y sus controles
 * (#245) son lo único de cliente. */
export function AccountHeader({
  locale,
  userId,
  fullName,
  role,
  photoUrl,
}: {
  locale: Locale;
  userId: string;
  fullName: string;
  role: Role;
  photoUrl: string | null;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  return (
    <header className="account-header">
      <ProfilePhoto
        locale={locale}
        userId={userId}
        fullName={fullName}
        initialPhotoUrl={photoUrl}
      >
        <h1>{fullName}</h1>
        <p className="account-role">
          {translate("account.roleLine", { role: translate(`role.${role}`) })}
        </p>
      </ProfilePhoto>
    </header>
  );
}
