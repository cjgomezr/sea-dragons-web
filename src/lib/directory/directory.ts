import {
  type MemberAttendance,
  type MemberAttendanceGateway,
  attendanceOf,
} from "@/lib/attendance/attendance-stats";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import {
  type Capability,
  ROLES,
  type Role,
  hasCapability,
} from "@/lib/auth/roles";
import {
  type ClubPositions,
  type ClubPositionsGateway,
  type NamedPosition,
  findClubPosition,
  positionRank,
} from "@/lib/club/club-positions";
import {
  MEMBERSHIP_STATUSES,
  type MembershipStatus,
} from "@/lib/membership/membership";
import type { EmergencyContact } from "@/lib/members/profile-contact";
import type { ExperienceLevel } from "@/lib/members/profile-fields";
import { isAufExpired } from "@/lib/members/member-record";
import { addClubDays, clubCalendarDate } from "@/lib/time/club-calendar";
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
 * Player o un Committee ni se le manda (FR-055). Y el contacto de cada socio
 * (#499, D5 del PRD de E19): el correo y el teléfono son de Admin y
 * Committee; el contacto de emergencia, además, del Coach, que es quien está
 * en la piscina.
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

/** Los filtros de #497 y los de contacto de #499 (RF-4 del PRD de E19). La
 * búsqueda y el rol son de todos y no cuentan aquí: esta es la lista de lo
 * que depende del rol. */
export const DIRECTORY_FILTERS = [
  "position",
  "group",
  "auf",
  "membership",
  "withoutPhone",
  "withoutEmergencyContact",
] as const;

export type DirectoryFilter = (typeof DIRECTORY_FILTERS)[number];

/** Una posición del catálogo del club (#299), o quien no tiene ninguna. */
export type DirectoryPositionFilter =
  | { readonly kind: "position"; readonly positionId: string }
  | { readonly kind: "unassigned" };

/** Sin número; vencido; vigente pero vence en los próximos 30 días del club;
 * con número y sin la confirmación de un Admin (#274). */
export const AUF_FILTERS = [
  "missing",
  "expired",
  "expiring",
  "unverified",
] as const;

export type AufFilter = (typeof AUF_FILTERS)[number];

/** Los estados de la membresía (#453), más quien no tiene ninguna. */
export const MEMBERSHIP_FILTERS = [...MEMBERSHIP_STATUSES, "none"] as const;

export type MembershipFilter = (typeof MEMBERSHIP_FILTERS)[number];

/** Qué se pide. Un filtro en null es "sin filtrar"; la pantalla y la
 * aplicación de Release 2 construyen esto desde sus controles. */
export type DirectoryQuery = {
  readonly search: string | null;
  readonly role: Role | null;
  readonly sort: DirectorySort;
  readonly direction: DirectoryDirection;
  readonly includeInactive: boolean;
  readonly position: DirectoryPositionFilter | null;
  readonly groupId: string | null;
  readonly auf: AufFilter | null;
  readonly membership: MembershipFilter | null;
  /** Sólo quien no tiene teléfono propio (#499). */
  readonly withoutPhone: boolean;
  /** Sólo quien no tiene contacto de emergencia (#499). */
  readonly withoutEmergencyContact: boolean;
};

/** Lo que pide quien no pide nada: todo el club activo, por nombre. */
export const DEFAULT_DIRECTORY_QUERY: DirectoryQuery = {
  search: null,
  role: null,
  sort: "name",
  direction: "asc",
  includeInactive: false,
  position: null,
  groupId: null,
  auf: null,
  membership: null,
  withoutPhone: false,
  withoutEmergencyContact: false,
};

/** "Vence en los próximos 30 días" (#497): de hoy en Melbourne al día 30
 * después, los dos incluidos. */
const AUF_EXPIRING_WINDOW_DAYS = 30;

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
  /** `members.created_at`: de él sale el día de la invitación (#549). */
  readonly registeredAt: string;
  readonly aufNumber: string | null;
  readonly aufExpiry: string | null;
  /** Si un Admin lo confirmó (#274). Sin número, siempre false. */
  readonly isAufVerified: boolean;
  /** Dónde está la foto en el almacenamiento (#245). No sale nunca tal cual:
   * se sirve una dirección firmada de vida corta. */
  readonly photoPath: string | null;
  /** Si tiene evaluación (#324). Sólo si existe: ninguna nota sale de aquí. */
  readonly isEvaluated: boolean;
  /** El estado de su membresía tal como cuenta hoy (#453), o `null` si no
   * tiene. Sólo lo ve un Admin. */
  readonly membershipStatus: MembershipStatus | null;
  /** Los grupos a los que pertenece (#497). Sólo filtran: no salen nunca. */
  readonly groupIds: readonly string[];
  /** El correo de su cuenta, su teléfono y su contacto de emergencia (#499).
   * Cada uno sale sólo a quien puede verlo. */
  readonly email: string;
  readonly phone: string | null;
  readonly emergencyContact: EmergencyContact | null;
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
  /** El día del club en que se le invitó, mientras su cuenta siga
   * `incomplete` (#549); null en cuanto entra. Es el día de su fila, el
   * mismo que la ficha da por invitación pendiente (#243). */
  readonly invitedOn: string | null;
  /** Null sin foto: la fila enseña entonces las iniciales. */
  readonly photoUrl: string | null;
  /** Su porcentaje de asistencia, o sin datos (#394, FR-015). Es de todo el
   * club, no sólo del personal de entrenamiento. */
  readonly attendance: MemberAttendance;
};

/** El contacto de emergencia (#499): a quién llamar si le pasa algo en la
 * piscina. Null si el socio todavía no lo dio. */
export type EmergencyContactView = {
  readonly emergencyContact: EmergencyContact | null;
};

/** Todo el contacto (#499): el de emergencia, el correo de su cuenta y su
 * teléfono, que es opcional (D1). */
export type MemberContactView = EmergencyContactView & {
  readonly email: string;
  readonly phone: string | null;
};

/** Lo que ve un Committee: la vista de socio con el contacto (D5), sin el
 * AUF ni la membresía, que siguen siendo del Admin. */
export type CommitteeDirectoryMember = DirectoryMember & MemberContactView;

/** Lo mismo, más si tiene evaluación, que sólo ve quien puede verlas
 * (FR-055): así sabe a quién le falta antes de armar equipos (#324). Y el
 * contacto de emergencia, que el Coach necesita en la piscina (#499). */
export type CoachDirectoryMember = DirectoryMember &
  EmergencyContactView & {
    readonly isEvaluated: boolean;
  };

/** Lo del Coach, más todo el contacto (#499), el registro federativo
 * (BR-008) y el estado de la membresía (#453), que sólo ve un Admin. */
export type AdminDirectoryMember = CoachDirectoryMember &
  MemberContactView & {
    readonly aufNumber: string | null;
    readonly aufExpiry: string | null;
    readonly isAufVerified: boolean;
    readonly isAufExpired: boolean;
    /** Vigente, pero vence en los próximos 30 días del club: el mismo
     * criterio que el filtro "expiring" (#497, #549). */
    readonly isAufExpiring: boolean;
    readonly membershipStatus: MembershipStatus | null;
  };

/** La lista, marcada con quién la está viendo. Quien la consume no tiene que
 * adivinar por la presencia de un campo si le toca dibujar la columna del
 * AUF, la marca de sin evaluar o la columna del contacto (#499).
 * `availableFilters` le dice qué filtros puede ofrecer (#497): un Coach
 * recibe su vista y filtra por grupo pero no por contacto, así que no se
 * deduce de `kind`. */
export type DirectoryListing = {
  readonly availableFilters: readonly DirectoryFilter[];
  /** Cuántos socios tiene el club para quien mira, sin la búsqueda, el rol
   * ni los filtros (#548): el "{shown} de {total}" de la cabecera. Cuenta a
   * los dados de baja sólo cuando se pidieron. */
  readonly total: number;
} & (
  | { readonly kind: "member"; readonly members: readonly DirectoryMember[] }
  | {
      readonly kind: "committee";
      readonly members: readonly CommitteeDirectoryMember[];
    }
  | {
      readonly kind: "coach";
      readonly members: readonly CoachDirectoryMember[];
    }
  | {
      readonly kind: "admin";
      readonly members: readonly AdminDirectoryMember[];
    }
);

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

/** El motivo del 403 de un filtro que el rol de quien pide no tiene (#497).
 * Distingue este 403 de los otros del endpoint, que no llevan motivo. */
export const DIRECTORY_FILTER_FORBIDDEN_REASON = "directory_filter_forbidden";

export class DirectoryFilterForbiddenError extends Error {
  readonly filter: DirectoryFilter;

  constructor(filter: DirectoryFilter) {
    super(`Tu rol no puede filtrar el directorio por ${filter}.`);
    this.name = "DirectoryFilterForbiddenError";
    this.filter = filter;
  }
}

/** Cuánto del contacto de los socios ve cada rol (D5 del PRD de E19). No es
 * una fila de la matriz de la sección 4 del SRD, sino de FR-089, y por eso
 * vive aquí y no en `roles.ts`. */
export type ContactAccess = "none" | "emergency" | "full";

const CONTACT_ACCESS: Readonly<Record<Role, ContactAccess>> = {
  Admin: "full",
  Committee: "full",
  Coach: "emergency",
  Player: "none",
};

export function contactAccessOf(role: Role): ContactAccess {
  return CONTACT_ACCESS[role];
}

/** Quien ve el teléfono y el contacto de emergencia de todos, y por eso
 * puede pedir a quién le faltan. El Coach ve el de emergencia, pero listar a
 * quién le falta es trabajo de administración (RF-4). */
function canFilterByContact(role: Role): boolean {
  return contactAccessOf(role) === "full";
}

function grantedBy(capability: Capability): (role: Role) => boolean {
  return (role) => hasCapability(role, capability);
}

/** Quién puede pedir cada filtro. La posición es de todos; el grupo, de
 * quien gestiona grupos; el AUF y la membresía, sólo del Admin (la pregunta
 * de si el Committee también sigue abierta en el PRD); los de contacto, de
 * quien ve todo el contacto. */
const FILTER_ACCESS: Readonly<
  Record<DirectoryFilter, (role: Role) => boolean>
> = {
  position: grantedBy("useMemberFeatures"),
  group: grantedBy("manageGroups"),
  auf: grantedBy("manageUsersAndRoles"),
  membership: grantedBy("manageUsersAndRoles"),
  withoutPhone: canFilterByContact,
  withoutEmergencyContact: canFilterByContact,
};

export function availableDirectoryFilters(
  role: Role,
): readonly DirectoryFilter[] {
  return DIRECTORY_FILTERS.filter((filter) => FILTER_ACCESS[filter](role));
}

/** Los filtros que trae la consulta, con el nombre que les da la lista. */
function requestedFilters(query: DirectoryQuery): readonly DirectoryFilter[] {
  const isRequested: Readonly<Record<DirectoryFilter, boolean>> = {
    position: query.position !== null,
    group: query.groupId !== null,
    auf: query.auf !== null,
    membership: query.membership !== null,
    withoutPhone: query.withoutPhone,
    withoutEmergencyContact: query.withoutEmergencyContact,
  };
  return DIRECTORY_FILTERS.filter((filter) => isRequested[filter]);
}

/** Antes de leer nada: a quien no puede pedir un filtro no se le contesta
 * con una lista que ya dice algo de lo que filtra. */
function assertFiltersAllowed(query: DirectoryQuery, role: Role): void {
  const available = availableDirectoryFilters(role);
  const forbidden = requestedFilters(query).find(
    (filter) => !available.includes(filter),
  );
  if (forbidden !== undefined) {
    throw new DirectoryFilterForbiddenError(forbidden);
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

function matchesPosition(
  record: DirectoryMemberRecord,
  position: DirectoryPositionFilter | null,
): boolean {
  if (position === null) {
    return true;
  }
  return position.kind === "unassigned"
    ? record.positionId === null
    : record.positionId === position.positionId;
}

function matchesGroup(
  record: DirectoryMemberRecord,
  groupId: string | null,
): boolean {
  return groupId === null || record.groupIds.includes(groupId);
}

/** Vence hoy cuenta como vigente, igual que en `isAufExpired`. */
function isAufExpiring(aufExpiry: string | null, todayInClub: string): boolean {
  return (
    aufExpiry !== null &&
    aufExpiry >= todayInClub &&
    aufExpiry <= addClubDays(todayInClub, AUF_EXPIRING_WINDOW_DAYS)
  );
}

function matchesAuf(
  record: DirectoryMemberRecord,
  auf: AufFilter | null,
  todayInClub: string,
): boolean {
  switch (auf) {
    case null:
      return true;
    case "missing":
      return record.aufNumber === null;
    case "expired":
      return isAufExpired(record.aufExpiry, todayInClub);
    case "expiring":
      return isAufExpiring(record.aufExpiry, todayInClub);
    case "unverified":
      return record.aufNumber !== null && !record.isAufVerified;
  }
}

function matchesMembership(
  record: DirectoryMemberRecord,
  membership: MembershipFilter | null,
): boolean {
  if (membership === null) {
    return true;
  }
  return membership === "none"
    ? record.membershipStatus === null
    : record.membershipStatus === membership;
}

function matchesContact(
  record: DirectoryMemberRecord,
  query: Pick<DirectoryQuery, "withoutPhone" | "withoutEmergencyContact">,
): boolean {
  return (
    (!query.withoutPhone || record.phone === null) &&
    (!query.withoutEmergencyContact || record.emergencyContact === null)
  );
}

/** Lo que la consulta pide a cada socio, todo a la vez (#497, #499). */
function matchesFilters(
  record: DirectoryMemberRecord,
  query: DirectoryQuery,
  todayInClub: string,
): boolean {
  return (
    matchesPosition(record, query.position) &&
    matchesGroup(record, query.groupId) &&
    matchesAuf(record, query.auf, todayInClub) &&
    matchesMembership(record, query.membership) &&
    matchesContact(record, query)
  );
}

/** Dado de baja no aparece (FR-085), salvo que un Admin los pida. Una cuenta
 * `incomplete` sí aparece: es un socio del club que todavía no terminó su
 * registro, y ninguna regla pide esconderlo. */
/** Los dados de baja sólo salen cuando un Admin los pide (AC-040). */
function isListedStatus(
  record: DirectoryMemberRecord,
  query: DirectoryQuery,
): boolean {
  return record.status !== "inactive" || query.includeInactive;
}

function isVisible(
  record: DirectoryMemberRecord,
  query: DirectoryQuery,
): boolean {
  if (!isListedStatus(record, query)) {
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
    invitedOn:
      record.status === "incomplete"
        ? clubCalendarDate(new Date(record.registeredAt))
        : null,
    photoUrl: photoUrlOf(record, signedPhotos),
    attendance: attendanceOf(attendance, record.userId),
  };
}

function memberContactOf(record: DirectoryMemberRecord): MemberContactView {
  return {
    email: record.email,
    phone: record.phone,
    emergencyContact: record.emergencyContact,
  };
}

function toCommitteeDirectoryMember(
  record: DirectoryMemberRecord,
  context: ListingContext,
): CommitteeDirectoryMember {
  return {
    ...toDirectoryMember(record, context),
    ...memberContactOf(record),
  };
}

function toCoachDirectoryMember(
  record: DirectoryMemberRecord,
  context: ListingContext,
): CoachDirectoryMember {
  return {
    ...toDirectoryMember(record, context),
    isEvaluated: record.isEvaluated,
    emergencyContact: record.emergencyContact,
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
    ...memberContactOf(record),
    aufNumber: record.aufNumber,
    aufExpiry: record.aufExpiry,
    isAufVerified: record.isAufVerified,
    isAufExpired: isAufExpired(record.aufExpiry, todayInClub),
    isAufExpiring: isAufExpiring(record.aufExpiry, todayInClub),
    membershipStatus: record.membershipStatus,
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
  assertFiltersAllowed(request.query, caller.role);

  const records = await gateways.directory.findDirectoryMembers(caller.clubId);
  const positions = await gateways.positions.findClubPositions(
    caller.clubId,
    referencedPositionIds(records),
  );
  const visible = records.filter(
    (record) =>
      isVisible(record, request.query) &&
      matchesFilters(record, request.query, request.todayInClub),
  );
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

  return listingFor(caller.role, listed, {
    ...context,
    todayInClub: request.todayInClub,
    total: countClubMembers(records, request.query),
  });
}

function countClubMembers(
  records: readonly DirectoryMemberRecord[],
  query: DirectoryQuery,
): number {
  return records.filter((record) => isListedStatus(record, query)).length;
}

/** La vista que toca a cada rol: el servidor decide qué campos salen, nunca
 * la pantalla (NFR-004). */
function listingFor(
  role: Role,
  listed: readonly DirectoryMemberRecord[],
  context: ListingContext & {
    readonly todayInClub: string;
    readonly total: number;
  },
): DirectoryListing {
  const { total } = context;
  const availableFilters = availableDirectoryFilters(role);
  if (hasCapability(role, "manageUsersAndRoles")) {
    return {
      kind: "admin",
      members: listed.map((record) =>
        toAdminDirectoryMember(record, context.todayInClub, context),
      ),
      availableFilters,
      total,
    };
  }
  if (hasCapability(role, "viewEvaluations")) {
    return {
      kind: "coach",
      members: listed.map((record) => toCoachDirectoryMember(record, context)),
      availableFilters,
      total,
    };
  }
  if (contactAccessOf(role) === "full") {
    return {
      kind: "committee",
      members: listed.map((record) =>
        toCommitteeDirectoryMember(record, context),
      ),
      availableFilters,
      total,
    };
  }
  return {
    kind: "member",
    members: listed.map((record) => toDirectoryMember(record, context)),
    availableFilters,
    total,
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
      return { ...listing, members: listing.members.map(update) };
    case "coach":
      return { ...listing, members: listing.members.map(update) };
    case "committee":
      return { ...listing, members: listing.members.map(update) };
    case "member":
      return { ...listing, members: listing.members.map(update) };
  }
}
