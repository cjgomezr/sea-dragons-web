import { memberInitials } from "@/lib/auth/member-initials";
import type { Role } from "@/lib/auth/roles";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

/** La cabecera de Mi cuenta: iniciales, nombre y una línea con el rol, como
 * la de docs/mockups/mobile-profile-light.png. Las métricas de ese mockup son
 * de E5, E8 y E9 y no entran aquí. */
export function AccountHeader({
  locale,
  fullName,
  role,
}: {
  locale: Locale;
  fullName: string;
  role: Role;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  return (
    <header className="account-header">
      <span className="account-avatar" aria-hidden="true">
        {memberInitials(fullName)}
      </span>
      <div className="account-identity">
        <h1>{fullName}</h1>
        <p className="account-role">
          {translate("account.roleLine", { role: translate(`role.${role}`) })}
        </p>
      </div>
    </header>
  );
}
