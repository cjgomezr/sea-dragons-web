import type { MemberGroup } from "@/lib/groups/member-groups";
import type { Translator } from "@/lib/i18n/translator";
import { SideCard } from "./SideCard";

/** Los grupos de un socio como fichas, en el orden en que llegan, o que no
 * tiene ninguno. La comparten el perfil y la ficha del Admin (#774). */
export function GroupChips({
  translate,
  groups,
}: {
  translate: Translator;
  groups: readonly MemberGroup[];
}): React.JSX.Element {
  if (groups.length === 0) {
    return (
      <p className="profile-side-card-empty">
        {translate("profileAside.groups.empty")}
      </p>
    );
  }
  return (
    <ul className="profile-group-chips">
      {groups.map((group) => (
        <li key={group.id}>{group.name}</li>
      ))}
    </ul>
  );
}

/** Grupos en el perfil propio (#229, #774). Sólo los nombres de los grupos
 * del socio: ni los demás grupos del club ni quiénes más están en ellos. Los
 * cambia un Admin, desde la ficha. */
export function MyGroups({
  translate,
  groups,
}: {
  translate: Translator;
  groups: readonly MemberGroup[];
}): React.JSX.Element {
  return (
    <SideCard
      headingId="mis-grupos"
      title={translate("profileAside.groups.title")}
    >
      <GroupChips translate={translate} groups={groups} />
    </SideCard>
  );
}
