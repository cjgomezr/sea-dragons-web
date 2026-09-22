import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { ROLES, type Role, hasCapability } from "@/lib/auth/roles";
import {
  POSITIONS,
  type ExperienceLevel,
  type Position,
} from "@/lib/members/profile-fields";
import { isAufExpired } from "@/lib/members/member-record";
import { compareNames } from "@/lib/text/name-order";

/**
 * El directorio del club (#238, RF-2 del PRD de E5): FR-015 la lista, FR-017
 * la búsqueda por nombre, FR-018 el filtro por rol y FR-019 el orden, contado
 * sin Supabase delante.
 *
 * Lo alcanza cualquier cuenta activa, sea cual sea su rol. Lo que sí es del
 * Admin lo decide este módulo: el número de AUF con su vencimiento (BR-008) y
 * ver a los socios dados de baja (AC-040).
 *
 * El club sale de la fila de quien pregunta y nunca de un parámetro, como en
 * el resto de las lecturas de club (NFR-009). Buscar, filtrar y ordenar se
 * hacen aquí y no en la consulta: el club tiene decenas de socios, el orden no
 * puede depender del collation de la base (el mismo motivo de
 * `name-order.ts`), y la búsqueda sin acentos no necesita entonces ninguna
 * extensión de Postgres.
 */

export const DIRECTORY_SORTS = ["name", "role", "position"] as const;

export type DirectorySort = (typeof DIRECTORY_SORTS)[number];

export const DIRECTORY_DIRECTIONS = ["asc", "desc"] as const;

export type DirectoryDirection = (typeof DIRECTORY_DIRECTIONS)[number];

/** Qué se pide. `search` y `role` en null es "sin filtrar"; la pantalla y la
 * aplicación de Release 2 construyen esto desde sus controles. */
export type DirectoryQuery = {
  readonly search: string | null;
  readonly role: Role | null;
  readonly sort: DirectorySort;
  readonly direction: DirectoryDirection;
  readonly includeInactive: boolean;
};

/** Lo que pide quien no pide nada: todo el club activo, por nombre. */
export const DEFAULT_DIRECTORY_QUERY: DirectoryQuery = {
  search: null,
  role: null,
  sort: "name",
  direction: "asc",
  includeInactive: false,
};

/** Un socio tal como lo guarda la base, con lo reservado al Admin incluido.
 * No sale de aquí: es la materia prima con la que se arma la respuesta. */
export type DirectoryMemberRecord = {
  readonly userId: string;
  readonly fullName: string;
  readonly country: string | null;
  readonly experienceLevel: ExperienceLevel | null;
  readonly role: Role;
  readonly position: Position | null;
  readonly status: AccountStatus;
  readonly aufNumber: string | null;
  readonly aufExpiry: string | null;
  /** Dónde está la foto en el almacenamiento (#245). No sale nunca tal cual:
   * se sirve una dirección firmada de vida corta. */
  readonly photoPath: string | null;
};

/** Lo que el directorio enseña de un socio a cualquiera del club (FR-015). Ni
 * fecha de nacimiento, ni datos del tutor, ni tipo de membresía, ni correo: el
 * directorio muestra los datos del club, no los personales (NFR-010). */
export type DirectoryMember = {
  readonly userId: string;
  readonly fullName: string;
  readonly country: string | null;
  readonly experienceLevel: ExperienceLevel | null;
  readonly role: Role;
  readonly position: Position | null;
  readonly status: AccountStatus;
  /** Null sin foto: la fila enseña entonces las iniciales. */
  readonly photoUrl: string | null;
};

/** Lo mismo, más el registro federativo, que sólo ve un Admin (BR-008). */
export type AdminDirectoryMember = DirectoryMember & {
  readonly aufNumber: string | null;
  readonly aufExpiry: string | null;
  readonly isAufExpired: boolean;
};

/** La lista, marcada con quién la está viendo. Quien la consume no tiene que
 * adivinar por la presencia de un campo si le toca dibujar la columna del
 * AUF. */
export type DirectoryListing =
  | { readonly kind: "member"; readonly members: readonly DirectoryMember[] }
  | {
      readonly kind: "admin";
      readonly members: readonly AdminDirectoryMember[];
    };

export type DirectoryGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly directory: {
    findDirectoryMembers(
      clubId: string,
    ): Promise<readonly DirectoryMemberRecord[]>;
  };
  readonly photos: {
    /** Las direcciones firmadas, por ruta. Una ruta que no se pudo firmar
     * falta en el mapa. */
    signPhotoUrls(
      photoPaths: readonly string[],
    ): Promise<ReadonlyMap<string, string>>;
  };
};

export class DirectoryForbiddenError extends Error {
  constructor() {
    super("Sólo un Admin puede ver a los socios dados de baja del club.");
    this.name = "DirectoryForbiddenError";
  }
}

/** Sin mayúsculas ni acentos, para que "maria" encuentre a "María" (FR-017).
 * `NFD` separa cada letra de su tilde y el reemplazo se queda con la letra. */
function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function matchesSearch(
  record: DirectoryMemberRecord,
  search: string | null,
): boolean {
  if (search === null) {
    return true;
  }
  return normalizeForSearch(record.fullName).includes(
    normalizeForSearch(search),
  );
}

/** Dado de baja no aparece (FR-085), salvo que un Admin los pida. Una cuenta
 * `incomplete` sí aparece: es un socio del club que todavía no terminó su
 * registro, y ninguna regla pide esconderlo. */
function isVisible(
  record: DirectoryMemberRecord,
  query: DirectoryQuery,
): boolean {
  if (record.status === "inactive" && !query.includeInactive) {
    return false;
  }
  if (query.role !== null && record.role !== query.role) {
    return false;
  }
  return matchesSearch(record, query.search);
}

function withDirection(
  comparison: number,
  direction: DirectoryDirection,
): number {
  return direction === "asc" ? comparison : -comparison;
}

/** El orden del catálogo de posiciones es el del SRD (Goalkeeper, Defender,
 * Forward), no el alfabético. Quien no tiene posición va al final en los dos
 * sentidos: es un dato que falta, no uno que vaya antes ni después. */
function comparePositions(
  first: Position | null,
  second: Position | null,
  direction: DirectoryDirection,
): number {
  if (first === null || second === null) {
    return first === second ? 0 : first === null ? 1 : -1;
  }
  return withDirection(
    POSITIONS.indexOf(first) - POSITIONS.indexOf(second),
    direction,
  );
}

/** El criterio pedido primero y el nombre después, para que dos socios que
 * empatan salgan siempre en el mismo orden. */
function comparePrimary(
  first: DirectoryMemberRecord,
  second: DirectoryMemberRecord,
  query: DirectoryQuery,
): number {
  switch (query.sort) {
    case "name":
      return withDirection(
        compareNames(first.fullName, second.fullName),
        query.direction,
      );
    case "role":
      return withDirection(
        ROLES.indexOf(first.role) - ROLES.indexOf(second.role),
        query.direction,
      );
    case "position":
      return comparePositions(first.position, second.position, query.direction);
  }
}

function compareForQuery(
  first: DirectoryMemberRecord,
  second: DirectoryMemberRecord,
  query: DirectoryQuery,
): number {
  const primary = comparePrimary(first, second, query);
  return primary === 0
    ? compareNames(first.fullName, second.fullName)
    : primary;
}

type SignedPhotos = ReadonlyMap<string, string>;

function photoUrlOf(
  record: DirectoryMemberRecord,
  signedPhotos: SignedPhotos,
): string | null {
  if (record.photoPath === null) {
    return null;
  }
  // Sin firma, las iniciales: una foto rota no tumba la lista del club, y el
  // adaptador ya registró por qué no se firmó.
  return signedPhotos.get(record.photoPath) ?? null;
}

/** Sólo se firman las fotos de quien sale en la lista: una baja que un
 * Player no ve tampoco le deja una dirección de su foto. */
function signListedPhotos(
  gateways: DirectoryGateways,
  listed: readonly DirectoryMemberRecord[],
): Promise<SignedPhotos> {
  return gateways.photos.signPhotoUrls(
    listed.flatMap((record) =>
      record.photoPath === null ? [] : [record.photoPath],
    ),
  );
}

function toDirectoryMember(
  record: DirectoryMemberRecord,
  signedPhotos: SignedPhotos,
): DirectoryMember {
  return {
    userId: record.userId,
    fullName: record.fullName,
    country: record.country,
    experienceLevel: record.experienceLevel,
    role: record.role,
    position: record.position,
    status: record.status,
    photoUrl: photoUrlOf(record, signedPhotos),
  };
}

/** Cuándo está vencido lo decide la misma regla que la ficha del Admin. */
function toAdminDirectoryMember(
  record: DirectoryMemberRecord,
  todayInClub: string,
  signedPhotos: SignedPhotos,
): AdminDirectoryMember {
  return {
    ...toDirectoryMember(record, signedPhotos),
    aufNumber: record.aufNumber,
    aufExpiry: record.aufExpiry,
    isAufExpired: isAufExpired(record.aufExpiry, todayInClub),
  };
}

export type DirectoryRequest = {
  readonly callerId: string;
  readonly query: DirectoryQuery;
  /** El día de calendario del club (NFR-003), contra el que se mide si un
   * registro federativo está vencido. Lo pone quien llama para que este
   * módulo no dependa del reloj. */
  readonly todayInClub: string;
};

export async function listDirectory(
  gateways: DirectoryGateways,
  request: DirectoryRequest,
): Promise<DirectoryListing> {
  const caller = await gateways.members.findRoleRequestMember(request.callerId);
  if (caller === null) {
    throw new MemberNotFoundError(request.callerId);
  }
  const isAdmin = hasCapability(caller.role, "manageUsersAndRoles");
  // Antes de leer nada: a quien no puede pedirlos no se le puede colar ninguno.
  if (request.query.includeInactive && !isAdmin) {
    throw new DirectoryForbiddenError();
  }

  const records = await gateways.directory.findDirectoryMembers(caller.clubId);
  const listed = records
    .filter((record) => isVisible(record, request.query))
    .sort((first, second) => compareForQuery(first, second, request.query));
  const signedPhotos = await signListedPhotos(gateways, listed);

  return isAdmin
    ? {
        kind: "admin",
        members: listed.map((record) =>
          toAdminDirectoryMember(record, request.todayInClub, signedPhotos),
        ),
      }
    : {
        kind: "member",
        members: listed.map((record) =>
          toDirectoryMember(record, signedPhotos),
        ),
      };
}

/** La misma lista con el rol nuevo de un miembro, sin tocar a nadie más. Es
 * lo que la pantalla aplica cuando el servidor confirma un cambio de rol o la
 * aprobación de una solicitud (#240), para no volver a leer el club entero. */
export function withMemberRole(
  listing: DirectoryListing,
  userId: string,
  role: Role,
): DirectoryListing {
  function update<Member extends DirectoryMember>(member: Member): Member {
    return member.userId === userId ? { ...member, role } : member;
  }
  return listing.kind === "admin"
    ? { kind: "admin", members: listing.members.map(update) }
    : { kind: "member", members: listing.members.map(update) };
}
