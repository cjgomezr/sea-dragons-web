import {
  type AuditActor,
  type AuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { hasCapability } from "@/lib/auth/roles";
import {
  type ClubPositions,
  type ClubPositionsGateway,
  type NamedPosition,
  findClubPosition,
} from "@/lib/club/club-positions";
import type { EventAudience, EventType } from "@/lib/events/event-creation";
import { EventNotFoundError, type RsvpResponse } from "@/lib/events/event-rsvp";
import type { AudienceMembersGateway } from "@/lib/notifications/audience-members";
import { compareNames } from "@/lib/text/name-order";
import {
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
  type AttendanceTotals,
  countAttendance,
} from "./attendance-status";

export {
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
  type AttendanceTotals,
  countAttendance,
};

/**
 * La hoja de asistencia de un entrenamiento (#393, RF-2 y RF-3 del PRD de
 * E8, FR-038 a FR-041), contada sin Supabase delante.
 *
 * Sólo la abren y la guardan Admin y Coach (`buildTeamsAndTrackAttendance`).
 * La frontera ya lo decide por el camino; aquí se vuelve a comprobar, como en
 * las evaluaciones. A diferencia del RSVP, quien pasa lista no tiene que estar
 * en la audiencia: ve todos los entrenamientos del club.
 *
 * Quién sale en la hoja (D1): la audiencia del entrenamiento que no está de
 * baja, más cualquiera que ya tenga fila guardada, aunque haya salido de la
 * audiencia o esté de baja. Quien no tiene fila empieza en `present`.
 */

/** El estado con el que empieza quien todavía no tiene fila (FR-039). */
const DEFAULT_STATUS: AttendanceStatus = "present";

const INACTIVE_STATUS: AccountStatus = "inactive";

/** Sólo los entrenamientos llevan hoja (D2). */
const TRAINING_TYPE: EventType = "training";

/** En la bitácora la entidad es la sesión: "qué hoja". */
const AUDITED_ENTITY_TYPE = "event";

/** El orden de la hoja nueva: los Sí, luego los Quizás, luego el resto (D1). */
const RSVP_RANK: Readonly<Record<RsvpResponse, number>> = {
  yes: 0,
  maybe: 1,
  no: 2,
};
const NO_RSVP_RANK = 2;

/** Lo que hace falta de un evento para decidir si se le puede pasar lista. */
export type AttendanceEvent = {
  readonly id: string;
  readonly clubId: string;
  readonly eventType: EventType;
  readonly title: string;
  readonly status: "scheduled" | "cancelled";
  readonly startsAt: Date;
  readonly audience: EventAudience;
};

export type AttendanceRecord = {
  readonly userId: string;
  readonly status: AttendanceStatus;
};

export type SheetMemberRecord = {
  readonly userId: string;
  readonly fullName: string;
  readonly status: AccountStatus;
  /** Una posición del catálogo del club, o null sin posición. */
  readonly positionId: string | null;
  /** Dónde está la foto; sale firmada, nunca tal cual. */
  readonly photoPath: string | null;
};

export type MemberRsvp = {
  readonly userId: string;
  readonly response: RsvpResponse;
};

/** Lo que se manda a guardar: la hoja entera de una sesión. */
export type NewAttendanceSheet = {
  readonly clubId: string;
  readonly eventId: string;
  readonly recordedBy: string;
  readonly records: readonly AttendanceRecord[];
};

/** Lo que responde `save_attendance_sheet`, que vuelve a mirar el evento con
 * la fila bloqueada: pudo cambiar entre que el dominio lo leyó y lo escribe. */
export type AttendanceSaveOutcome =
  "saved" | "not_found" | "not_started" | "cancelled";

export type AttendanceGateways = {
  readonly members: Pick<
    RoleRequestGateways["members"],
    "findRoleRequestMember"
  >;
  readonly audience: AudienceMembersGateway;
  readonly sheets: {
    /** El evento, sea del tipo que sea, si es de ese club. */
    findEvent(query: {
      readonly clubId: string;
      readonly eventId: string;
    }): Promise<AttendanceEvent | null>;
    /** Los miembros del club con esos ids, estén como estén. */
    findMembers(query: {
      readonly clubId: string;
      readonly userIds: readonly string[];
    }): Promise<readonly SheetMemberRecord[]>;
    findRsvps(eventId: string): Promise<readonly MemberRsvp[]>;
    findRecords(eventId: string): Promise<readonly AttendanceRecord[]>;
    /** Sustituye la hoja entera, todo o nada. */
    saveSheet(sheet: NewAttendanceSheet): Promise<AttendanceSaveOutcome>;
  };
  readonly positions: ClubPositionsGateway;
  readonly photos: {
    /** Las direcciones firmadas, por ruta. Una ruta que no se pudo firmar
     * falta en el mapa. */
    signPhotoUrls(
      photoPaths: readonly string[],
    ): Promise<ReadonlyMap<string, string>>;
  };
  readonly audit: AuditLogWriter;
};

export type AttendanceSheetEntry = {
  readonly userId: string;
  readonly fullName: string;
  /** Null sin foto o sin firma: la fila enseña entonces las iniciales. */
  readonly photoUrl: string | null;
  readonly position: NamedPosition | null;
  readonly status: AttendanceStatus;
  /** La respuesta al RSVP, como pista; `null` si no respondió. */
  readonly rsvpResponse: RsvpResponse | null;
  /** Está de baja: sólo sale si ya tenía fila guardada. */
  readonly isInactive: boolean;
};

export type AttendanceSheet = {
  readonly eventId: string;
  readonly title: string;
  readonly startsAt: string;
  /** Alguien ya guardó esta hoja alguna vez. */
  readonly isSaved: boolean;
  readonly members: readonly AttendanceSheetEntry[];
};

export type SavedAttendanceSheet = {
  readonly eventId: string;
  readonly totals: AttendanceTotals;
};

export class AttendanceForbiddenError extends Error {
  constructor() {
    super("Sólo Admin y Coach pasan lista.");
    this.name = "AttendanceForbiddenError";
  }
}

/** Van en `reason` del 422, para que la pantalla (#395) los traduzca (D4). */
export type AttendanceClosedCode =
  "attendance_session_not_started" | "attendance_session_cancelled";

const CLOSED_MESSAGES: Readonly<Record<AttendanceClosedCode, string>> = {
  attendance_session_not_started:
    "El entrenamiento todavía no empezó: la asistencia se pasa desde la hora de inicio.",
  attendance_session_cancelled:
    "El entrenamiento está cancelado: no lleva asistencia.",
};

export class AttendanceClosedError extends Error {
  readonly code: AttendanceClosedCode;

  constructor(code: AttendanceClosedCode) {
    super(CLOSED_MESSAGES[code]);
    this.name = "AttendanceClosedError";
    this.code = code;
  }
}

export const ATTENDANCE_MEMBER_OUTSIDE_SHEET_REASON =
  "attendance_member_outside_sheet";

export class AttendanceMemberOutsideSheetError extends Error {
  constructor() {
    super(
      "La lista trae a alguien que no es de la audiencia del entrenamiento ni tiene asistencia guardada en él.",
    );
    this.name = "AttendanceMemberOutsideSheetError";
  }
}

/** La lista no tiene la forma debida: vacía o con un miembro repetido. */
export class AttendanceListInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceListInvalidError";
  }
}

export async function findAttendanceTaker(
  gateways: Pick<AttendanceGateways, "members">,
  callerId: string,
): Promise<AuditActor> {
  const caller = await gateways.members.findRoleRequestMember(callerId);
  if (caller === null) {
    throw new MemberNotFoundError(callerId);
  }
  if (!hasCapability(caller.role, "buildTeamsAndTrackAttendance")) {
    throw new AttendanceForbiddenError();
  }
  return { id: callerId, clubId: caller.clubId };
}

/** El entrenamiento al que se le puede pasar lista ahora, o por qué no. */
async function findOpenTraining(
  gateways: AttendanceGateways,
  request: {
    readonly clubId: string;
    readonly eventId: string;
    readonly now: Date;
  },
): Promise<AttendanceEvent> {
  const event = await gateways.sheets.findEvent(request);
  if (event === null || event.eventType !== TRAINING_TYPE) {
    throw new EventNotFoundError();
  }
  if (event.status === "cancelled") {
    throw new AttendanceClosedError("attendance_session_cancelled");
  }
  if (event.startsAt.getTime() > request.now.getTime()) {
    throw new AttendanceClosedError("attendance_session_not_started");
  }
  return event;
}

type SheetRoster = {
  readonly members: readonly SheetMemberRecord[];
  readonly recorded: ReadonlyMap<string, AttendanceStatus>;
};

/** Quién sale en la hoja y el estado guardado de cada uno, si lo tiene. */
async function readSheetRoster(
  gateways: AttendanceGateways,
  event: AttendanceEvent,
): Promise<SheetRoster> {
  const [audienceIds, records] = await Promise.all([
    gateways.audience.findAudienceMemberIds({
      clubId: event.clubId,
      audience: event.audience,
    }),
    gateways.sheets.findRecords(event.id),
  ]);
  const recorded = new Map(
    records.map((record) => [record.userId, record.status]),
  );
  const members = await gateways.sheets.findMembers({
    clubId: event.clubId,
    userIds: [...new Set([...audienceIds, ...recorded.keys()])],
  });
  return {
    members: members.filter(
      (member) =>
        recorded.has(member.userId) || member.status !== INACTIVE_STATUS,
    ),
    recorded,
  };
}

function rsvpRank(response: RsvpResponse | null): number {
  return response === null ? NO_RSVP_RANK : RSVP_RANK[response];
}

function compareEntries(
  first: AttendanceSheetEntry,
  second: AttendanceSheetEntry,
): number {
  return (
    rsvpRank(first.rsvpResponse) - rsvpRank(second.rsvpResponse) ||
    compareNames(first.fullName, second.fullName)
  );
}

type MemberLooks = Pick<AttendanceSheetEntry, "photoUrl" | "position">;

function distinctPresent(
  values: readonly (string | null)[],
): readonly string[] {
  return [...new Set(values.filter((value) => value !== null))].sort();
}

function positionOf(
  positions: ClubPositions,
  positionId: string | null,
): NamedPosition | null {
  if (positionId === null) {
    return null;
  }
  const { id, names } = findClubPosition(positions, positionId);
  return { id, names };
}

/** Con qué se pinta cada fila (#395): la foto firmada y la posición, como en
 * el directorio. Una foto sin firma deja las iniciales: una foto rota no
 * tumba la hoja, y el adaptador ya registró por qué no se firmó. */
async function readMemberLooks(
  gateways: AttendanceGateways,
  clubId: string,
  members: readonly SheetMemberRecord[],
): Promise<(member: SheetMemberRecord) => MemberLooks> {
  const [positions, signedPhotos] = await Promise.all([
    gateways.positions.findClubPositions(
      clubId,
      distinctPresent(members.map((member) => member.positionId)),
    ),
    gateways.photos.signPhotoUrls(
      distinctPresent(members.map((member) => member.photoPath)),
    ),
  ]);
  return (member) => ({
    photoUrl:
      member.photoPath === null
        ? null
        : (signedPhotos.get(member.photoPath) ?? null),
    position: positionOf(positions, member.positionId),
  });
}

/** La hoja de un entrenamiento ya empezado, para marcarla (RF-2). El club
 * sale de la fila de quien llama, nunca de la petición (NFR-009). */
export async function openAttendanceSheet(
  gateways: AttendanceGateways,
  request: {
    readonly callerId: string;
    readonly eventId: string;
    readonly now: Date;
  },
): Promise<AttendanceSheet> {
  const actor = await findAttendanceTaker(gateways, request.callerId);
  const event = await findOpenTraining(gateways, {
    ...request,
    clubId: actor.clubId,
  });
  const [roster, rsvps] = await Promise.all([
    readSheetRoster(gateways, event),
    gateways.sheets.findRsvps(event.id),
  ]);
  const responses = new Map(rsvps.map((rsvp) => [rsvp.userId, rsvp.response]));
  const looks = await readMemberLooks(gateways, event.clubId, roster.members);
  const entries = roster.members.map((member): AttendanceSheetEntry => ({
    userId: member.userId,
    fullName: member.fullName,
    ...looks(member),
    status: roster.recorded.get(member.userId) ?? DEFAULT_STATUS,
    rsvpResponse: responses.get(member.userId) ?? null,
    isInactive: member.status === INACTIVE_STATUS,
  }));
  return {
    eventId: event.id,
    title: event.title,
    startsAt: event.startsAt.toISOString(),
    isSaved: roster.recorded.size > 0,
    members: entries.sort(compareEntries),
  };
}

function assertWellFormedList(records: readonly AttendanceRecord[]): void {
  if (records.length === 0) {
    throw new AttendanceListInvalidError("La hoja no trae a nadie.");
  }
  const userIds = new Set(records.map((record) => record.userId));
  if (userIds.size !== records.length) {
    throw new AttendanceListInvalidError(
      "La hoja trae a un miembro más de una vez.",
    );
  }
}

/** Se comprueba antes de bloquear el evento: si alguien sale de la audiencia
 * justo entretanto, su fila se guarda igual. Sigue siendo del club, y la clave
 * compuesta de `0043` impide cualquier otro. */
function assertMembersOnSheet(
  roster: SheetRoster,
  records: readonly AttendanceRecord[],
): void {
  const sheetIds = new Set(roster.members.map((member) => member.userId));
  if (records.some((record) => !sheetIds.has(record.userId))) {
    throw new AttendanceMemberOutsideSheetError();
  }
}

function assertSaved(outcome: AttendanceSaveOutcome): void {
  switch (outcome) {
    case "saved":
      return;
    case "not_found":
      throw new EventNotFoundError();
    case "not_started":
      throw new AttendanceClosedError("attendance_session_not_started");
    case "cancelled":
      throw new AttendanceClosedError("attendance_session_cancelled");
  }
}

/** Guarda la hoja entera (RF-3), sin límite de tiempo (D5), y lo deja en la
 * bitácora después de guardar, sin los estados (NFR-010). */
export async function saveAttendanceSheet(
  gateways: AttendanceGateways,
  request: {
    readonly callerId: string;
    readonly eventId: string;
    readonly records: readonly AttendanceRecord[];
    readonly now: Date;
  },
): Promise<SavedAttendanceSheet> {
  assertWellFormedList(request.records);
  const actor = await findAttendanceTaker(gateways, request.callerId);
  const event = await findOpenTraining(gateways, {
    ...request,
    clubId: actor.clubId,
  });
  assertMembersOnSheet(await readSheetRoster(gateways, event), request.records);
  assertSaved(
    await gateways.sheets.saveSheet({
      clubId: actor.clubId,
      eventId: event.id,
      recordedBy: actor.id,
      records: request.records,
    }),
  );
  await recordAuditEvent(gateways.audit, {
    actor,
    clubId: actor.clubId,
    action: "attendance.saved",
    entityType: AUDITED_ENTITY_TYPE,
    entityId: event.id,
    result: "success",
  });
  return {
    eventId: event.id,
    totals: countAttendance(request.records.map((record) => record.status)),
  };
}
