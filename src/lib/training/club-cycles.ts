import {
  type AuditAction,
  type AuditActor,
  type AuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import {
  CYCLE_NAME_MAX_LENGTH,
  CycleValidationError,
  validCycleName,
  validCycleSchedule,
  validCycleWeeks,
  validWeekDose,
  validWeekNo,
  validWeekNote,
  validWeekday,
} from "./club-cycle-input";
import {
  type CycleSchedule,
  WeekOneCopyTooShortError,
  cycleStartDate,
  weekOneCopyTargets,
} from "./cycle-schedule";
import type { WeekDose } from "./training-load";
import { findTrainingPlanner } from "./training-planner";

/**
 * Los ciclos en Planificar (#904, RF-7, RF-8 y D5 a D8 del PRD de E35): el
 * Admin o el Coach los crea, los cambia, los activa, los archiva y los
 * duplica, y llena cada semana (nota y dosis) y la cuadrícula de días. Lo
 * que tiene que ser una transacción lo hace la base (`0085`); aquí se decide
 * qué vale y se deja la bitácora.
 *
 * Un ciclo de otro club no existe: responde igual que uno que no hay.
 *
 * Desde E38 cada ciclo es de todo el club o de grupos (#978, D1 a D3 y D8 del
 * PRD de E38), y puede haber varios activos mientras no se solapen. Activar,
 * o cambiar los grupos de un activo, devuelve los que chocan; con la
 * confirmación, la base los archiva en la misma transacción.
 */

const CYCLE_ENTITY_TYPE = "training_cycle";
const COPY_SUFFIX = " (copy)";
const FIRST_WEEK = 1;

export type CycleStatus = "draft" | "active" | "archived";

export type CycleEvent = { readonly name: string; readonly date: string };

export type CycleGroup = { readonly id: string; readonly name: string };

/** Para quién es el ciclo (D1). Uno de grupos puede quedarse sin ninguno si
 * se borran (D9): sigue siendo de grupos. */
export type CycleAudience =
  | { readonly kind: "club" }
  | { readonly kind: "groups"; readonly groups: readonly CycleGroup[] };

/** La audiencia que se pide: los grupos, por id. */
export type CycleAudienceInput =
  | { readonly kind: "club" }
  | { readonly kind: "groups"; readonly groupIds: readonly string[] };

/** Un activo con el que chocaría el ciclo (D2). */
export type ConflictingCycle = { readonly id: string; readonly name: string };

/** Qué hizo la base al activar o al cambiar la audiencia: nada si choca y no
 * se confirmó; si no, lo guardó y archivó los que chocaban. */
export type CycleConflictOutcome =
  | { readonly kind: "missing" }
  | {
      readonly kind: "conflicts";
      readonly conflicts: readonly ConflictingCycle[];
    }
  | { readonly kind: "saved"; readonly archived: readonly ConflictingCycle[] };

/** Un ciclo tal como lo ve quien planifica. */
export type ClubCycleRecord = {
  readonly id: string;
  readonly name: string;
  readonly status: CycleStatus;
  readonly weeks: number;
  /** YYYY-MM-DD, el lunes de la semana 1. */
  readonly startDate: string;
  readonly event: CycleEvent | null;
  /** Las rutinas del ciclo, sin las compartidas. */
  readonly ownRoutines: number;
  readonly audience: CycleAudience;
};

/** La nota y la dosis de una semana (D6); las dos, opcionales. */
export type CycleWeekRecord = {
  readonly weekNo: number;
  readonly note: string | null;
  readonly dose: WeekDose | null;
};

export type CycleDaySlot = 1 | 2;

/** Una rutina en una ranura de un día (D7). 0 es el lunes. */
export type CycleDayRecord = {
  readonly weekNo: number;
  readonly weekday: number;
  readonly slot: CycleDaySlot;
  readonly routineId: string;
};

/** Lo que se pide al poner o quitar una rutina: nula vacía la ranura. */
export type CycleDayChange = Omit<CycleDayRecord, "routineId"> & {
  readonly routineId: string | null;
};

export type CycleFields = {
  readonly name: string;
  readonly weeks: number;
  readonly startDate: string;
  readonly event: CycleEvent | null;
};

/** De qué ciclo es una rutina del club, o si es compartida (D8). */
export type RoutineScope =
  | { readonly kind: "missing" }
  | { readonly kind: "shared" }
  | { readonly kind: "cycle"; readonly cycleId: string };

export type CycleTarget = { readonly clubId: string; readonly cycleId: string };

/** Qué pasó al intentar borrar un ciclo. El activo no se borra nunca. */
export type CycleDeletion =
  | { readonly kind: "missing" }
  | { readonly kind: "active" }
  | {
      readonly kind: "deleted";
      readonly status: Exclude<CycleStatus, "active">;
      readonly routinesDeleted: number;
    };

export type ClubCyclesGateway = {
  listCycles(clubId: string): Promise<readonly ClubCycleRecord[]>;
  findCycle(target: CycleTarget): Promise<ClubCycleRecord | null>;
  /** Sólo las semanas con fila y los días con rutina. */
  readCyclePlan(target: CycleTarget): Promise<{
    readonly weeks: readonly CycleWeekRecord[];
    readonly days: readonly CycleDayRecord[];
  }>;
  /** En borrador, con sus grupos, en una transacción. Devuelve el id. */
  insertCycle(
    fields: CycleFields & {
      readonly clubId: string;
      readonly createdBy: string;
      readonly audience: CycleAudienceInput;
    },
  ): Promise<string>;
  /** De `groupIds`, los que son grupos del club. */
  findClubGroupIds(
    clubId: string,
    groupIds: readonly string[],
  ): Promise<readonly string[]>;
  /** Se lleva los días y las semanas que pasen de `fields.weeks`, en la
   * misma transacción. */
  updateCycle(target: CycleTarget, fields: CycleFields): Promise<void>;
  activateCycle(
    target: CycleTarget,
    options: { readonly confirm: boolean },
  ): Promise<CycleConflictOutcome>;
  /** Sólo un activo puede chocar. */
  saveAudience(
    target: CycleTarget,
    audience: CycleAudienceInput,
    options: { readonly confirm: boolean },
  ): Promise<CycleConflictOutcome>;
  archiveCycle(target: CycleTarget): Promise<void>;
  /** Mira el estado y borra en la misma transacción, para que una
   * activación a la vez no se cuele entre los dos. Se lleva las semanas, los
   * días y las rutinas propias con sus filas. */
  deleteCycle(target: CycleTarget): Promise<CycleDeletion>;
  duplicateCycle(
    target: CycleTarget,
    copy: { readonly name: string; readonly createdBy: string },
  ): Promise<{ readonly cycleId: string; readonly routinesCopied: number }>;
  findRoutineScope(clubId: string, routineId: string): Promise<RoutineScope>;
  setDay(target: CycleTarget, day: CycleDayChange): Promise<void>;
  saveWeek(target: CycleTarget, week: CycleWeekRecord): Promise<void>;
  copyWeekOne(
    target: CycleTarget,
    targetWeeks: readonly number[],
  ): Promise<void>;
  /** Borra los días y la fila de nota y dosis de esa semana, en la misma
   * transacción. */
  clearWeek(target: CycleTarget, weekNo: number): Promise<void>;
};

export type ClubCyclesGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly cycles: ClubCyclesGateway;
  readonly audit: AuditLogWriter;
};

export type ManagedCycle = ClubCycleRecord;

export type ManagedCycles = { readonly cycles: readonly ManagedCycle[] };

/** Un ciclo con todas sus semanas, también las vacías, y su cuadrícula. */
export type ManagedCycleDetail = {
  readonly cycle: ManagedCycle;
  readonly weeks: readonly CycleWeekRecord[];
  readonly days: readonly CycleDayRecord[];
};

export type DuplicatedCycle = ManagedCycles & {
  readonly duplicatedCycleId: string;
  readonly routinesCopied: number;
};

export type CycleInput = {
  readonly name: string;
  readonly weeks: number;
  readonly schedule: CycleSchedule;
  /** Sin ella, de todo el club. */
  readonly audience?: CycleAudienceInput;
};

/** Lo que no viene se queda como está. */
export type CycleChanges = Partial<CycleInput>;

type CycleRequest = { readonly callerId: string; readonly cycleId: string };

const CLUB_AUDIENCE: CycleAudienceInput = { kind: "club" };

export type CycleAudienceIssueCode = "groups_required" | "group_not_in_club";

/** Una audiencia que no se puede guardar: sin grupos, o con uno que no es
 * del club (RF-1). */
export class CycleAudienceError extends Error {
  readonly code: CycleAudienceIssueCode;

  constructor(code: CycleAudienceIssueCode) {
    super(`La audiencia del ciclo no vale: ${code}.`);
    this.name = "CycleAudienceError";
    this.code = code;
  }
}

/** Guardar dejaría dos activos solapados: se confirma antes de archivar los
 * que chocan (D3). */
export class CycleConflictError extends Error {
  readonly conflicts: readonly ConflictingCycle[];

  constructor(conflicts: readonly ConflictingCycle[]) {
    super(
      `Choca con ciclos activos (${conflicts.map(({ name }) => name).join(", ")}): confirma para archivarlos.`,
    );
    this.name = "CycleConflictError";
    this.conflicts = conflicts;
  }
}

export class CycleNotFoundError extends Error {
  constructor() {
    super("No existe ese ciclo en tu club.");
    this.name = "CycleNotFoundError";
  }
}

/** El activo es el que siguen los socios: primero se archiva. */
export class CycleIsActiveError extends Error {
  constructor() {
    super("El ciclo está activo: archívalo antes de borrarlo.");
    this.name = "CycleIsActiveError";
  }
}

/** Bajar las semanas quitaría días con rutina: se confirma antes. */
export class CycleDaysWouldBeRemovedError extends Error {
  readonly daysRemoved: number;

  constructor(daysRemoved: number) {
    super(
      `Bajar las semanas quitaría ${daysRemoved} días con rutina: confirma para quitarlos.`,
    );
    this.name = "CycleDaysWouldBeRemovedError";
    this.daysRemoved = daysRemoved;
  }
}

function recordCycleEvent(
  gateways: ClubCyclesGateways,
  event: {
    readonly actor: AuditActor;
    readonly action: AuditAction;
    readonly cycleId: string;
    readonly metadata?: Record<string, unknown>;
  },
): Promise<void> {
  return recordAuditEvent(gateways.audit, {
    actor: event.actor,
    clubId: event.actor.clubId,
    action: event.action,
    entityType: CYCLE_ENTITY_TYPE,
    entityId: event.cycleId,
    result: "success",
    metadata: event.metadata,
  });
}

/** Quien planifica y el ciclo de su club que nombra. */
async function openCycle(
  gateways: ClubCyclesGateways,
  request: CycleRequest,
): Promise<{
  readonly actor: AuditActor;
  readonly target: CycleTarget;
  readonly cycle: ClubCycleRecord;
}> {
  const actor = await findTrainingPlanner(gateways.members, request.callerId);
  const target = { clubId: actor.clubId, cycleId: request.cycleId };
  const cycle = await gateways.cycles.findCycle(target);
  if (cycle === null) {
    throw new CycleNotFoundError();
  }
  return { actor, target, cycle };
}

async function readDetail(
  gateways: ClubCyclesGateways,
  target: CycleTarget,
): Promise<ManagedCycleDetail> {
  const cycle = await gateways.cycles.findCycle(target);
  if (cycle === null) {
    throw new CycleNotFoundError();
  }
  const plan = await gateways.cycles.readCyclePlan(target);
  const saved = new Map(plan.weeks.map((week) => [week.weekNo, week]));
  const weeks = Array.from({ length: cycle.weeks }, (_, index) => {
    const weekNo = FIRST_WEEK + index;
    return saved.get(weekNo) ?? { weekNo, note: null, dose: null };
  });
  return {
    cycle,
    weeks,
    days: plan.days.filter((day) => day.weekNo <= cycle.weeks),
  };
}

async function readCycles(
  gateways: ClubCyclesGateways,
  clubId: string,
): Promise<ManagedCycles> {
  return { cycles: await gateways.cycles.listCycles(clubId) };
}

function scheduleOf(cycle: ClubCycleRecord): CycleSchedule {
  return cycle.event === null
    ? { kind: "start", startDate: cycle.startDate }
    : {
        kind: "event",
        eventName: cycle.event.name,
        eventDate: cycle.event.date,
      };
}

function fieldsFor(input: CycleInput): CycleFields {
  const schedule = validCycleSchedule(input.schedule);
  const weeks = validCycleWeeks(input.weeks);
  return {
    name: validCycleName(input.name),
    weeks,
    startDate: cycleStartDate(schedule, weeks),
    event:
      schedule.kind === "event"
        ? { name: schedule.eventName, date: schedule.eventDate }
        : null,
  };
}

/** Omitida es de todo el club. Los grupos, sin repetir, todos del club. */
async function validAudience(
  gateways: ClubCyclesGateways,
  clubId: string,
  audience: CycleAudienceInput | undefined,
): Promise<CycleAudienceInput> {
  if (audience === undefined || audience.kind === "club") {
    return CLUB_AUDIENCE;
  }
  const groupIds = [...new Set(audience.groupIds)];
  if (groupIds.length === 0) {
    throw new CycleAudienceError("groups_required");
  }
  const clubGroupIds = await gateways.cycles.findClubGroupIds(clubId, groupIds);
  if (clubGroupIds.length !== groupIds.length) {
    throw new CycleAudienceError("group_not_in_club");
  }
  return { kind: "groups", groupIds };
}

/** Lo que archivó la base al guardar, o el porqué de no guardar. */
function archivedOrThrow(
  outcome: CycleConflictOutcome,
): readonly ConflictingCycle[] {
  if (outcome.kind === "missing") {
    throw new CycleNotFoundError();
  }
  if (outcome.kind === "conflicts") {
    throw new CycleConflictError(outcome.conflicts);
  }
  return outcome.archived;
}

/** Un `archived` por cada ciclo que la base archivó al chocar con
 * `replacedBy`: en la bitácora queda quién lo sacó. */
async function recordConflictArchives(
  gateways: ClubCyclesGateways,
  event: {
    readonly actor: AuditActor;
    readonly archived: readonly ConflictingCycle[];
    readonly replacedBy: string;
  },
): Promise<void> {
  for (const archived of event.archived) {
    await recordCycleEvent(gateways, {
      actor: event.actor,
      action: "training_cycle.archived",
      cycleId: archived.id,
      metadata: { reason: "conflict", replacedBy: event.replacedBy },
    });
  }
}

function audienceMetadata(
  audience: CycleAudienceInput,
): Record<string, unknown> {
  return audience.kind === "groups"
    ? { audience: audience.kind, groupIds: audience.groupIds }
    : { audience: audience.kind };
}

/** La audiencia nueva, si viene: en un activo que choca, sin `confirm` no
 * guarda nada (D3). Devuelve lo que se anota y los que archivó. */
async function saveAudienceChange(
  gateways: ClubCyclesGateways,
  request: {
    readonly target: CycleTarget;
    readonly audience: CycleAudienceInput | undefined;
    readonly confirm: boolean;
  },
): Promise<{
  readonly metadata: Record<string, unknown>;
  readonly archived: readonly ConflictingCycle[];
}> {
  if (request.audience === undefined) {
    return { metadata: {}, archived: [] };
  }
  const archived = archivedOrThrow(
    await gateways.cycles.saveAudience(request.target, request.audience, {
      confirm: request.confirm,
    }),
  );
  return {
    metadata: {
      ...audienceMetadata(request.audience),
      archivedCycleIds: archived.map(({ id }) => id),
    },
    archived,
  };
}

/** Cuántos días con rutina quedan después de la última semana. Un día con
 * dos rutinas cuenta una vez. */
function countDaysAfter(
  days: readonly CycleDayRecord[],
  lastWeek: number,
): number {
  const removed = days
    .filter((day) => day.weekNo > lastWeek)
    .map((day) => `${day.weekNo}:${day.weekday}`);
  return new Set(removed).size;
}

export async function listManagedCycles(
  gateways: ClubCyclesGateways,
  callerId: string,
): Promise<ManagedCycles> {
  const actor = await findTrainingPlanner(gateways.members, callerId);
  return readCycles(gateways, actor.clubId);
}

export async function readManagedCycle(
  gateways: ClubCyclesGateways,
  request: CycleRequest,
): Promise<ManagedCycleDetail> {
  const { target } = await openCycle(gateways, request);
  return readDetail(gateways, target);
}

/** Nace en borrador (D5), de todo el club si no se dice otra cosa (D1). Sin
 * metadata de contenido: ni el nombre ni el evento, sólo la audiencia. */
export async function createManagedCycle(
  gateways: ClubCyclesGateways,
  request: { readonly callerId: string; readonly input: CycleInput },
): Promise<ManagedCycleDetail> {
  const fields = fieldsFor(request.input);
  const actor = await findTrainingPlanner(gateways.members, request.callerId);
  const audience = await validAudience(
    gateways,
    actor.clubId,
    request.input.audience,
  );
  const cycleId = await gateways.cycles.insertCycle({
    ...fields,
    clubId: actor.clubId,
    createdBy: actor.id,
    audience,
  });
  await recordCycleEvent(gateways, {
    actor,
    action: "training_cycle.created",
    cycleId,
    metadata: audienceMetadata(audience),
  });
  return readDetail(gateways, { clubId: actor.clubId, cycleId });
}

/** Con evento, el inicio se recalcula siempre: cambiar las semanas o la
 * fecha mueve el ciclo para que el evento siga en la última (D5). Bajar las
 * semanas con días con rutina en las que sobran pide `confirmRemoval`, y
 * cambiar los grupos de un activo que choca pide `confirm` (D3). Todo se
 * comprueba antes de guardar nada. */
export async function updateManagedCycle(
  gateways: ClubCyclesGateways,
  request: CycleRequest & {
    readonly changes: CycleChanges;
    readonly confirmRemoval: boolean;
    readonly confirm: boolean;
  },
): Promise<ManagedCycleDetail> {
  const { actor, target, cycle } = await openCycle(gateways, request);
  const fields = fieldsFor({
    name: request.changes.name ?? cycle.name,
    weeks: request.changes.weeks ?? cycle.weeks,
    schedule: request.changes.schedule ?? scheduleOf(cycle),
  });
  const audience =
    request.changes.audience === undefined
      ? undefined
      : await validAudience(gateways, actor.clubId, request.changes.audience);
  const plan = await gateways.cycles.readCyclePlan(target);
  const daysRemoved = countDaysAfter(plan.days, fields.weeks);
  if (daysRemoved > 0 && !request.confirmRemoval) {
    throw new CycleDaysWouldBeRemovedError(daysRemoved);
  }
  const audienceChange = await saveAudienceChange(gateways, {
    target,
    audience,
    confirm: request.confirm,
  });
  // Los archivados ya están guardados: se anotan antes del cambio de campos,
  // que es otra transacción y podría fallar.
  await recordConflictArchives(gateways, {
    actor,
    archived: audienceChange.archived,
    replacedBy: target.cycleId,
  });
  await gateways.cycles.updateCycle(target, fields);
  await recordCycleEvent(gateways, {
    actor,
    action: "training_cycle.updated",
    cycleId: target.cycleId,
    metadata: { daysRemoved, ...audienceChange.metadata },
  });
  return readDetail(gateways, target);
}

/** Sin choque, activa (D2). Con choque, sin `confirm` responde los que chocan
 * y no cambia nada; con él, la base los archiva en la misma transacción (D3).
 * La bitácora lleva cada archivado y la activación. */
export async function activateManagedCycle(
  gateways: ClubCyclesGateways,
  request: CycleRequest & { readonly confirm: boolean },
): Promise<ManagedCycles> {
  const { actor, target } = await openCycle(gateways, request);
  const archived = archivedOrThrow(
    await gateways.cycles.activateCycle(target, { confirm: request.confirm }),
  );
  await recordConflictArchives(gateways, {
    actor,
    archived,
    replacedBy: target.cycleId,
  });
  await recordCycleEvent(gateways, {
    actor,
    action: "training_cycle.activated",
    cycleId: target.cycleId,
    metadata: { archivedCycleIds: archived.map(({ id }) => id) },
  });
  return readCycles(gateways, actor.clubId);
}

export async function archiveManagedCycle(
  gateways: ClubCyclesGateways,
  request: CycleRequest,
): Promise<ManagedCycles> {
  const { actor, target } = await openCycle(gateways, request);
  await gateways.cycles.archiveCycle(target);
  await recordCycleEvent(gateways, {
    actor,
    action: "training_cycle.archived",
    cycleId: target.cycleId,
  });
  return readCycles(gateways, actor.clubId);
}

/** Un borrador o un archivado (#935). La bitácora lleva el nombre: después
 * no queda ciclo que lo diga. */
export async function deleteManagedCycle(
  gateways: ClubCyclesGateways,
  request: CycleRequest,
): Promise<ManagedCycles> {
  const { actor, target, cycle } = await openCycle(gateways, request);
  const deletion = await gateways.cycles.deleteCycle(target);
  if (deletion.kind === "missing") {
    throw new CycleNotFoundError();
  }
  if (deletion.kind === "active") {
    throw new CycleIsActiveError();
  }
  await recordCycleEvent(gateways, {
    actor,
    action: "training_cycle.deleted",
    cycleId: target.cycleId,
    metadata: {
      name: cycle.name,
      status: deletion.status,
      routinesDeleted: deletion.routinesDeleted,
    },
  });
  return readCycles(gateways, actor.clubId);
}

/** "{nombre} (copy)", recortado para que quepa en el límite del nombre. */
function copyName(name: string): string {
  const room = CYCLE_NAME_MAX_LENGTH - COPY_SUFFIX.length;
  return `${[...name].slice(0, room).join("").trimEnd()}${COPY_SUFFIX}`;
}

/** Un borrador con copias de las rutinas propias (RF-7), la misma audiencia
 * y los mismos grupos (D8 de E38). La bitácora es del ciclo nuevo y dice de
 * cuál sale. */
export async function duplicateManagedCycle(
  gateways: ClubCyclesGateways,
  request: CycleRequest,
): Promise<DuplicatedCycle> {
  const { actor, target, cycle } = await openCycle(gateways, request);
  const copy = await gateways.cycles.duplicateCycle(target, {
    name: copyName(cycle.name),
    createdBy: actor.id,
  });
  await recordCycleEvent(gateways, {
    actor,
    action: "training_cycle.duplicated",
    cycleId: copy.cycleId,
    metadata: {
      sourceCycleId: target.cycleId,
      routinesCopied: copy.routinesCopied,
    },
  });
  return {
    ...(await readCycles(gateways, actor.clubId)),
    duplicatedCycleId: copy.cycleId,
    routinesCopied: copy.routinesCopied,
  };
}

/** Sólo una rutina del ciclo o una compartida (RF-8). */
async function assertRoutineAllowed(
  gateways: ClubCyclesGateways,
  target: CycleTarget,
  routineId: string,
): Promise<void> {
  const scope = await gateways.cycles.findRoutineScope(
    target.clubId,
    routineId,
  );
  const isAllowed =
    scope.kind === "shared" ||
    (scope.kind === "cycle" && scope.cycleId === target.cycleId);
  if (!isAllowed) {
    throw new CycleValidationError("routine_not_allowed");
  }
}

export async function setManagedCycleDay(
  gateways: ClubCyclesGateways,
  request: CycleRequest & { readonly day: CycleDayChange },
): Promise<ManagedCycleDetail> {
  const { actor, target, cycle } = await openCycle(gateways, request);
  const { day } = request;
  validWeekNo(day.weekNo, cycle.weeks);
  validWeekday(day.weekday);
  if (day.routineId !== null) {
    await assertRoutineAllowed(gateways, target, day.routineId);
  }
  await gateways.cycles.setDay(target, day);
  await recordCycleEvent(gateways, {
    actor,
    action: "training_cycle.day_updated",
    cycleId: target.cycleId,
    metadata: { weekNo: day.weekNo, weekday: day.weekday, slot: day.slot },
  });
  return readDetail(gateways, target);
}

/** Sin metadata de contenido: ni la nota ni la dosis, sólo qué semana. */
export async function saveManagedCycleWeek(
  gateways: ClubCyclesGateways,
  request: CycleRequest & { readonly week: CycleWeekRecord },
): Promise<ManagedCycleDetail> {
  const { actor, target, cycle } = await openCycle(gateways, request);
  const week = {
    weekNo: validWeekNo(request.week.weekNo, cycle.weeks),
    note: validWeekNote(request.week.note),
    dose: validWeekDose(request.week.dose),
  };
  await gateways.cycles.saveWeek(target, week);
  await recordCycleEvent(gateways, {
    actor,
    action: "training_cycle.week_updated",
    cycleId: target.cycleId,
    metadata: { weekNo: week.weekNo },
  });
  return readDetail(gateways, target);
}

function copyTargetsOf(cycle: ClubCycleRecord): readonly number[] {
  try {
    return weekOneCopyTargets(cycle.weeks);
  } catch (error) {
    if (error instanceof WeekOneCopyTooShortError) {
      throw new CycleValidationError("too_few_weeks_to_copy");
    }
    throw error;
  }
}

/** Los días de la semana 1 pasan a la 2 hasta la N − 2 (RF-8). */
export async function copyManagedCycleWeekOne(
  gateways: ClubCyclesGateways,
  request: CycleRequest,
): Promise<ManagedCycleDetail> {
  const { actor, target, cycle } = await openCycle(gateways, request);
  await gateways.cycles.copyWeekOne(target, copyTargetsOf(cycle));
  await recordCycleEvent(gateways, {
    actor,
    action: "training_cycle.week_one_copied",
    cycleId: target.cycleId,
  });
  return readDetail(gateways, target);
}

/** Los siete días a descanso y sin nota ni dosis (#943); las demás semanas,
 * sus fechas y las rutinas no cambian. */
export async function clearManagedCycleWeek(
  gateways: ClubCyclesGateways,
  request: CycleRequest & { readonly weekNo: number },
): Promise<ManagedCycleDetail> {
  const { actor, target, cycle } = await openCycle(gateways, request);
  const weekNo = validWeekNo(request.weekNo, cycle.weeks);
  await gateways.cycles.clearWeek(target, weekNo);
  await recordCycleEvent(gateways, {
    actor,
    action: "training_cycle.week_cleared",
    cycleId: target.cycleId,
    metadata: { weekNo },
  });
  return readDetail(gateways, target);
}
