import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type {
  RoleRequestGateways,
  RoleRequestMember,
} from "@/lib/auth/role-request";
import { hasCapability } from "@/lib/auth/roles";
import {
  type ProfilePhotoSigner,
  signPhotosOrNone,
  signedPhotoUrl,
} from "@/lib/members/profile-photo-urls";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import {
  type GroupAudienceUses,
  type GroupMembershipRecord,
  type GroupPreviewMember,
  type GroupUsage,
  countGroupUsage,
  pickPreviewMembers,
} from "./group-overview";

/**
 * Crear, listar, renombrar y borrar los grupos del club (#226, RF-2 a RF-5 y
 * RF-9 del PRD de E4), contado sin Supabase delante.
 *
 * Todo sale del club de quien llama, que se averigua de su fila de socio y
 * nunca de un parámetro: un club no puede tocar los grupos de otro pidiéndolo
 * bien (NFR-009). La lista es la misma que E7 y E11 ofrecerán como audiencia,
 * así que su forma no depende de ninguna pantalla.
 */

/** El mismo tope que el `check` de `groups.name` en `0015_groups.sql`. La
 * pantalla lo usará para su formulario. */
export const GROUP_NAME_MAX_LENGTH = 60;

const CONTROL_CHARACTER = /\p{Cc}/u;

/** Un grupo con cuántos socios activos cuenta. Los dados de baja (`inactive`,
 * RF-3) y los pendientes de activar (`incomplete`, #243) siguen asignados,
 * pero no cuentan. */
export type Group = {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
};

/** Un grupo como lo lista la pantalla de E32 (D4): dónde se usa y a quién
 * enseña su vista previa, en la misma respuesta que la lista. */
export type GroupOverview = Group & {
  readonly usage: GroupUsage;
  readonly previewMembers: readonly GroupPreviewMember[];
};

export type GroupInsert = { readonly clubId: string; readonly name: string };
export type GroupRename = GroupInsert & { readonly groupId: string };
export type GroupDeletion = {
  readonly clubId: string;
  readonly groupId: string;
};

/** El choque del nombre lo decide el índice único de la base, no una lectura
 * previa: dos creaciones simultáneas no pueden pasar las dos una comprobación
 * que la base no hace. */
export type GroupInsertResult =
  | { readonly kind: "created"; readonly group: Group }
  | { readonly kind: "name_taken" };

export type GroupRenameResult =
  | { readonly kind: "renamed"; readonly group: Group }
  | { readonly kind: "name_taken" }
  | { readonly kind: "not_found" };

export type GroupDeletionResult =
  { readonly kind: "deleted" } | { readonly kind: "not_found" };

export type GroupsGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly groups: {
    findClubGroups(clubId: string): Promise<readonly Group[]>;
    insertGroup(input: GroupInsert): Promise<GroupInsertResult>;
    renameGroup(input: GroupRename): Promise<GroupRenameResult>;
    deleteGroup(input: GroupDeletion): Promise<GroupDeletionResult>;
  };
  readonly overview: {
    /** Todas las pertenencias del club, de baja y sin activar incluidas. */
    findMemberships(clubId: string): Promise<readonly GroupMembershipRecord[]>;
    /** Lo que tiene a algún grupo del club en su audiencia. Puede dejar fuera
     * lo que ya terminó antes de `today` (`YYYY-MM-DD` de Melbourne), para no
     * traer el histórico entero; lo que cuenta lo decide `countGroupUsage`. */
    findAudienceUses(query: {
      readonly clubId: string;
      readonly today: string;
    }): Promise<GroupAudienceUses>;
  };
  readonly photos: ProfilePhotoSigner;
};

export class GroupsForbiddenError extends Error {
  constructor() {
    super("Tu rol no te permite gestionar los grupos del club.");
    this.name = "GroupsForbiddenError";
  }
}

export class InvalidGroupNameError extends Error {
  constructor() {
    super(
      `El nombre del grupo tiene que tener entre 1 y ${GROUP_NAME_MAX_LENGTH} caracteres, sin caracteres de control.`,
    );
    this.name = "InvalidGroupNameError";
  }
}

export class GroupNameTakenError extends Error {
  constructor(name: string) {
    super(`Ya hay un grupo llamado "${name}" en el club.`);
    this.name = "GroupNameTakenError";
  }
}

export class GroupNotFoundError extends Error {
  constructor() {
    super("No existe ese grupo en tu club.");
    this.name = "GroupNotFoundError";
  }
}

/** El nombre tal como se guarda: recortado de todo espacio en blanco, no sólo
 * de los espacios que quita el `btrim` de la base, para que un tabulador o un
 * salto de línea alrededor no cree un grupo que parece repetido. El largo se
 * cuenta en caracteres, como `char_length`, y no en unidades de UTF-16.
 *
 * Dentro del nombre no cabe ningún carácter de control: Postgres rechaza el
 * nulo en un `text`, y un tabulador en medio es un nombre que nadie escribió
 * a propósito. */
export function normalizeGroupName(rawName: string): string {
  const name = rawName.trim();
  const length = [...name].length;
  if (
    length === 0 ||
    length > GROUP_NAME_MAX_LENGTH ||
    CONTROL_CHARACTER.test(name)
  ) {
    throw new InvalidGroupNameError();
  }
  return name;
}

/** Quien llama, con su club. La frontera ya niega estas rutas a quien no
 * gestiona grupos; esto es el cerrojo del dominio, para que no dependa de que
 * nadie olvide la línea de `RESTRICTED_ROUTES`. */
export async function findGroupManager(
  gateways: Pick<GroupsGateways, "members">,
  callerId: string,
): Promise<RoleRequestMember> {
  const caller = await gateways.members.findRoleRequestMember(callerId);
  if (caller === null) {
    throw new MemberNotFoundError(callerId);
  }
  if (!hasCapability(caller.role, "manageGroups")) {
    throw new GroupsForbiddenError();
  }
  return caller;
}

const NO_USAGE: GroupUsage = { events: 0, posts: 0 };

/** Los grupos del club de quien llama, en orden alfabético, con su conteo, su
 * uso y su vista previa. Todo sale de tres lecturas del club, no de una por
 * grupo (D4), y las fotos de las vistas previas se firman en una llamada. */
export async function listGroups(
  gateways: GroupsGateways,
  request: { readonly callerId: string; readonly now: Date },
): Promise<readonly GroupOverview[]> {
  const caller = await findGroupManager(gateways, request.callerId);
  const today = clubCalendarDate(request.now);
  const [groups, memberships, uses] = await Promise.all([
    gateways.groups.findClubGroups(caller.clubId),
    gateways.overview.findMemberships(caller.clubId),
    gateways.overview.findAudienceUses({ clubId: caller.clubId, today }),
  ]);
  const usage = countGroupUsage(uses, today);
  const previewed = groups.map((group) => ({
    group,
    preview: pickPreviewMembers(memberships, group.id),
  }));
  const photoUrls = await signPhotosOrNone(
    gateways.photos,
    previewed.flatMap(({ preview }) =>
      preview.map(({ photoPath }) => photoPath),
    ),
    "groups",
  );
  return previewed.map(({ group, preview }) => ({
    ...group,
    usage: usage.get(group.id) ?? NO_USAGE,
    previewMembers: preview.map(({ id, fullName, photoPath }) => ({
      id,
      fullName,
      photoUrl: signedPhotoUrl(photoUrls, photoPath),
    })),
  }));
}

export async function createGroup(
  gateways: GroupsGateways,
  request: { readonly callerId: string; readonly name: string },
): Promise<Group> {
  const caller = await findGroupManager(gateways, request.callerId);
  const name = normalizeGroupName(request.name);
  const result = await gateways.groups.insertGroup({
    clubId: caller.clubId,
    name,
  });
  if (result.kind === "name_taken") {
    throw new GroupNameTakenError(name);
  }
  return result.group;
}

export async function renameGroup(
  gateways: GroupsGateways,
  request: {
    readonly callerId: string;
    readonly groupId: string;
    readonly name: string;
  },
): Promise<Group> {
  const caller = await findGroupManager(gateways, request.callerId);
  const name = normalizeGroupName(request.name);
  const result = await gateways.groups.renameGroup({
    clubId: caller.clubId,
    groupId: request.groupId,
    name,
  });
  switch (result.kind) {
    case "renamed":
      return result.group;
    case "name_taken":
      throw new GroupNameTakenError(name);
    case "not_found":
      throw new GroupNotFoundError();
  }
}

/** Borrar un grupo se lleva sus pertenencias (la cascada de `0015_groups.sql`)
 * y no toca a los socios. */
export async function deleteGroup(
  gateways: GroupsGateways,
  request: { readonly callerId: string; readonly groupId: string },
): Promise<void> {
  const caller = await findGroupManager(gateways, request.callerId);
  const result = await gateways.groups.deleteGroup({
    clubId: caller.clubId,
    groupId: request.groupId,
  });
  if (result.kind === "not_found") {
    throw new GroupNotFoundError();
  }
}
