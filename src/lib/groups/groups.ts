import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type {
  RoleRequestGateways,
  RoleRequestMember,
} from "@/lib/auth/role-request";
import { hasCapability } from "@/lib/auth/roles";

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

/** Un grupo con cuántos socios cuenta. Los dados de baja (`inactive`) siguen
 * asignados, pero no cuentan (RF-3). */
export type Group = {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
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
      `El nombre del grupo no puede quedar vacío ni pasar de ${GROUP_NAME_MAX_LENGTH} caracteres.`,
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
async function findGroupManager(
  gateways: GroupsGateways,
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

/** Los grupos del club de quien llama, en orden alfabético y con su conteo. */
export async function listGroups(
  gateways: GroupsGateways,
  callerId: string,
): Promise<readonly Group[]> {
  const caller = await findGroupManager(gateways, callerId);
  return gateways.groups.findClubGroups(caller.clubId);
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
