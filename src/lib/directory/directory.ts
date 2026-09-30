import {
  type MemberAttendance,
  type MemberAttendanceGateway,
  attendanceOf,
} from "@/lib/attendance/attendance-stats";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { ROLES, type Role, hasCapability } from "@/lib/auth/roles";
import {
  type ClubPositions,
  type ClubPositionsGateway,
  type NamedPosition,
  findClubPosition,
  positionRank,
} from "@/lib/club/club-positions";
import type { ExperienceLevel } from "@/lib/members/profile-fields";
import { isAufExpired } from "@/lib/members/member-record";
import { matchesNameSearch } from "@/lib/text/name-search";
import { compareNames } from "@/lib/text/name-order";

/**
 * El directorio del club (#238, RF-2 del PRD de E5): FR-015 la lista, FR-017
 * la búsqueda por nombre, FR-018 el filtro por rol y FR-019 el orden, contado
 * sin Supabase delante.
 *
 * Lo alcanza cualquier cuenta activa, sea cual sea su rol. Lo que sí es del
 * Admin lo decide este módulo: el número de AUF con su vencimiento (BR-008) y
 * ver a los socios dados de baja (AC-040). También lo que es del personal de
 * entrenamiento: quién está sin evaluar (#324, RF-7 del PRD de E9), que a un
 * Player o un Committee ni se le manda (FR-055).
 *
 * El club sale de la fila de quien pregunta y nunca de un parámetro, como en
 * el resto de las lecturas de club (NFR-009). Buscar, filtrar y ordenar se
 * hacen aquí y no en la consulta: el club tiene decenas de socios, el orden no
 * puede depender del collation de la base (el mismo motivo de
 * `name-order.ts`), y la búsqueda sin acentos no necesita entonces ninguna
 * extensión de Postgres.
 */

export const DIRECTORY_SORTS = [
  "name",
  "role",
  "position",
  "attendance",
] as const;

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
  /** Una posición del catálogo del club (#299), o null sin posición. */
  readonly positionId: string | null;
  readonly status: AccountStatus;
  readonly aufNumber: string | null;
  readonly aufExpiry: string | null;
  /** Si un Admin lo confirmó (#274). Sin número, siempre false. */
  readonly isAufVerified: boolean;
  /** Dónde está la foto en el almacenamiento (#245). No sale nunca tal cual:
   * se sirve una dirección firmada de vida corta. */
  readonly photoPath: string | null;
  /** Si tiene evaluación (#324). Sólo si existe: ninguna nota sale de aquí. */
  readonly isEvaluated: boolean;
};

/** La posición tal como la pinta el directorio: sus nombres, y la pantalla
 * elige el del idioma en que se lee (#299). */
export type DirectoryPosition = NamedPosition;

/** Lo que el directorio enseña de un socio a cualquiera del club (FR-015). Ni
 * fecha de nacimiento, ni datos del tutor, ni tipo de membresía, ni correo: el
 * directorio muestra los datos del club, no los personales (NFR-010). */
export type DirectoryMember = {
  readonly userId: string;
  readonly fullName: string;
  readonly country: string | null;
  readonly experienceLevel: ExperienceLevel | null;
  readonly role: Role;
  readonly position: DirectoryPosition | null;
  readonly status: AccountStatus;
  /** Null sin foto: la fila enseña entonces las iniciales. */
  readonly photoUrl: string | null;
  /** Su porcentaje de asistencia, o sin datos (#394, FR-015). Es de todo el
   * club, no sólo del personal de entrenamiento. */
  readonly attendance: MemberAttendance;
};

/** Lo mismo, más si tiene evaluación, que sólo ve quien puede verlas
 * (FR-055): así sabe a quién le falta antes de armar equipos (#324). */
export type CoachDirectoryMember = DirectoryMember & {
  readonly isEvaluated: boolean;
};

/** Lo del Coach, más el registro federativo, que sólo ve un Admin (BR-008). */
export type AdminDirectoryMember = CoachDirectoryMember & {
  readonly aufNumber: string | null;
  readonly aufExpiry: string | null;
  readonly isAufVerified: boolean;
  readonly isAufExpired: boolean;
};

/** La lista, marcada con quién la está viendo. Quien la consume no tiene que
 * adivinar por la presencia de un campo si le toca dibujar la columna del
 * AUF o la marca de sin evaluar. */
export type DirectoryListing =
  | { readonly kind: "member"; readonly members: readonly DirectoryMember[] }
  | {
      readonly kind: "coach";
      readonly members: readonly CoachDirectoryMember[];
    }
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
  readonly positions: ClubPositionsGateway;
  readonly photos: {
    /** Las direcciones firmadas, por ruta. Una ruta que no se pudo firmar
     * falta en el mapa. */
    signPhotoUrls(
      photoPaths: readonly string[],
    ): Promise<ReadonlyMap<string, string>>;
  };
  readonly attendance: MemberAttendanceGateway;
};

export class DirectoryForbiddenError extends Error {
  constructor() {
    super("Sólo un Admin puede ver a los socios dados de baja del club.");
    this.name = "DirectoryForbiddenError";
  }
}

function matchesSearch(
  record: DirectoryMemberRecord,
  search: string | null,
): boolean {
  if (search === null) {
    return true;
  }
  return matchesNameSearch(record.fullName, search);
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

/** Si quien pregunta ve a este socio en el directorio cuando pide todo lo que
 * su rol le deja pedir. La foto grande de un socio (#353) sigue esta regla. */
export function canSeeInDirectory(
  record: DirectoryMemberRecord,
  callerRole: Role,
): boolean {
  return isVisible(record, {
    ...DEFAULT_DIRECTORY_QUERY,
    includeInactive: hasCapability(callerRole, "manageUsersAndRoles"),
  });
}

function withDirection(
  comparison: number,
  direction: DirectoryDirection,
): number {
  return direction === "asc" ? comparison : -comparison;
}

/** El orden de las posiciones es el que decidió el club (#299), no el
 * alfabético. Quien no tiene posición va al final en los dos sentidos: es un
 * dato que falta, no uno que vaya antes ni después. */
function comparePositions(
  positions: ClubPositions,
  pair: readonly [string | null, string | null],
  direction: DirectoryDirection,
): number {
  const [first, second] = pair;
  if (first === null || second === null) {
    return first === second ? 0 : first === null ? 1 : -1;
  }
  return withDirection(
    positionRank(positions, first) - positionRank(positions, second),
    direction,
  );
}

/** Sin datos va al final en los dos sentidos, como quien no tiene posición
 * (AC-010): no es ni más ni menos asistencia que nadie. */
function compareAttendance(
  [first, second]: readonly [MemberAttendance, MemberAttendance],
  direction: DirectoryDirection,
): number {
  if (first.kind === "no_data" || second.kind === "no_data") {
    return first.kind === second.kind ? 0 : first.kind === "no_data" ? 1 : -1;
  }
  return withDirection(first.percent - second.percent, direction);
}

/** Lo que se lee aparte para ordenar, además de las filas. */
type SortContext = {
  readonly positions: ClubPositions;
  readonly attendance: ReadonlyMap<string, MemberAttendance>;
};

/** El criterio pedido primero y el nombre después, para que dos socios que
 * empatan salgan siempre en el mismo orden. */
function comparePrimary(
  [first, second]: readonly [DirectoryMemberRecord, DirectoryMemberRecord],
  query: DirectoryQuery,
  { positions, attendance }: SortContext,
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
      return comparePositions(
        positions,
        [first.positionId, second.positionId],
        query.direction,
      );
    case "attendance":
      return compareAttendance(
        [
          attendanceOf(attendance, first.userId),
          attendanceOf(attendance, second.userId),
        ],
        query.direction,
      );
  }
}

function compareForQuery(
  pair: readonly [DirectoryMemberRecord, DirectoryMemberRecord],
  query: DirectoryQuery,
  context: SortContext,
): number {
  const primary = comparePrimary(pair, query, context);
  const [first, second] = pair;
  return primary === 0
    ? compareNames(first.fullName, second.fullName)
    : primary;
}

type SignedPhotos = ReadonlyMap<string, string>;

export function photoUrlOf(
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
export function signListedPhotos(
  gateways: Pick<DirectoryGateways, "photos">,
  listed: readonly DirectoryMemberRecord[],
): Promise<SignedPhotos> {
  return gateways.photos.signPhotoUrls(
    listed.flatMap((record) =>
      record.photoPath === null ? [] : [record.photoPath],
    ),
  );
}

export function directoryPositionOf(
  positions: ClubPositions,
  positionId: string | null,
): DirectoryPosition | null {
  if (positionId === null) {
    return null;
  }
  const { id, names } = findClubPosition(positions, positionId);
  return { id, names };
}

/** Las posiciones que tienen los socios, sin repetir y en un orden fijo. */
export function referencedPositionIds(
  records: readonly DirectoryMemberRecord[],
): readonly string[] {
  const ids = records.flatMap((record) =>
    record.positionId === null ? [] : [record.positionId],
  );
  return [...new Set(ids)].sort();
}

/** Lo que se lee para armar cada fila, aparte de la fila misma. */
type ListingContext = SortContext & {
  readonly signedPhotos: SignedPhotos;
};

function toDirectoryMember(
  record: DirectoryMemberRecord,
  { positions, signedPhotos, attendance }: ListingContext,
): DirectoryMember {
  return {
    userId: record.userId,
    fullName: record.fullName,
    country: record.country,
    experienceLevel: record.experienceLevel,
    role: record.role,
    position: directoryPositionOf(positions, record.positionId),
    status: record.status,
    photoUrl: photoUrlOf(record, signedPhotos),
    attendance: attendanceOf(attendance, record.userId),
  };
}

function toCoachDirectoryMember(
  record: DirectoryMemberRecord,
  context: ListingContext,
): CoachDirectoryMember {
  return {
    ...toDirectoryMember(record, context),
    isEvaluated: record.isEvaluated,
  };
}

/** Cuándo está vencido lo decide la misma regla que la ficha del Admin. */
function toAdminDirectoryMember(
  record: DirectoryMemberRecord,
  todayInClub: string,
  context: ListingContext,
): AdminDirectoryMember {
  return {
    ...toCoachDirectoryMember(record, context),
    aufNumber: record.aufNumber,
    aufExpiry: record.aufExpiry,
    isAufVerified: record.isAufVerified,
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
  const positions = await gateways.positions.findClubPositions(
    caller.clubId,
    referencedPositionIds(records),
  );
  const visible = records.filter((record) => isVisible(record, request.query));
  // Una sola consulta para toda la lista (NFR-008), antes de ordenar: el
  // orden por asistencia la necesita.
  const sortContext = {
    positions,
    attendance: await gateways.attendance.findMemberAttendance(
      caller.clubId,
      visible.map((record) => record.userId),
    ),
  };
  const listed = [...visible].sort((first, second) =>
    compareForQuery([first, second], request.query, sortContext),
  );
  const context = {
    ...sortContext,
    signedPhotos: await signListedPhotos(gateways, listed),
  };

  if (isAdmin) {
    return {
      kind: "admin",
      members: listed.map((record) =>
        toAdminDirectoryMember(record, request.todayInClub, context),
      ),
    };
  }
  return hasCapability(caller.role, "viewEvaluations")
    ? {
        kind: "coach",
        members: listed.map((record) =>
          toCoachDirectoryMember(record, context),
        ),
      }
    : {
        kind: "member",
        members: listed.map((record) => toDirectoryMember(record, context)),
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
  switch (listing.kind) {
    case "admin":
      return { kind: "admin", members: listing.members.map(update) };
    case "coach":
      return { kind: "coach", members: listing.members.map(update) };
    case "member":
      return { kind: "member", members: listing.members.map(update) };
  }
}
