import type { MemberGroup } from "@/lib/groups/member-groups";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

/** La sección Mis grupos de Mi cuenta (#229). Sólo los nombres de los grupos
 * del socio, en el orden en que llegan: ni los demás grupos del club ni
 * quiénes más están en ellos. El tono es el de las tarjetas de
 * docs/mockups/mobile-profile-light.png. */
export function MyGroups({
  locale,
  groups,
}: {
  locale: Locale;
  groups: readonly MemberGroup[];
}): React.JSX.Element {
  const translate = createTranslator(locale);
  return (
    <section className="account-groups" aria-labelledby="mis-grupos">
      <h2 id="mis-grupos">{translate("account.groups.title")}</h2>
      {groups.length === 0 ? (
        <p>{translate("account.groups.empty")}</p>
      ) : (
        <ul>
          {groups.map((group) => (
            <li key={group.id}>{group.name}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
