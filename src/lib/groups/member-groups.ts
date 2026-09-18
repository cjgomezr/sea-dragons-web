/**
 * Mis grupos (#229, RF-8 del PRD de E4): los grupos a los que pertenece un
 * socio, para que lo vea en Mi cuenta. Sólo el id y el nombre: quiénes más
 * están en cada grupo no entra (el dueño lo decidió así).
 *
 * Qué grupos son del socio lo garantiza la base (la RLS de `0015_groups.sql`);
 * aquí sólo se decide por quién se pregunta y en qué orden salen.
 */

export type MemberGroup = {
  readonly id: string;
  readonly name: string;
};

export type MemberGroupsGateway = {
  readonly listGroupsOf: (userId: string) => Promise<readonly MemberGroup[]>;
};

/** Alfabético sin distinguir mayúsculas, igual que la base compara los nombres
 * para decidir si dos grupos se llaman igual. El idioma es fijo para que el
 * orden no cambie con el del servidor. */
const GROUP_NAME_COLLATOR = new Intl.Collator("en", { sensitivity: "base" });

export async function listMemberGroups(
  gateway: MemberGroupsGateway,
  userId: string,
): Promise<readonly MemberGroup[]> {
  const groups = await gateway.listGroupsOf(userId);
  return [...groups].sort((first, second) =>
    GROUP_NAME_COLLATOR.compare(first.name, second.name),
  );
}
