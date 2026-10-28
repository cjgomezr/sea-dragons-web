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
 */

const CYCLE_ENTITY_TYPE = "training_cycle";
const COPY_SUFFIX = " (copy)";
const FIRST_WEEK = 1;

export type CycleStatus = "draft" | "active" | "archived";

export type CycleEvent = { readonly name: string; readonly date: string };

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

export type ClubCyclesGateway = {
  listCycles(clubId: string): Promise<readonly ClubCycleRecord[]>;
  findCycle(target: CycleTarget): Promise<ClubCycleRecord | null>;
  /** Sólo las semanas con fila y los días con rutina. */
  readCyclePlan(target: CycleTarget): Promise<{
    readonly weeks: readonly CycleWeekRecord[];
    readonly days: readonly CycleDayRecord[];
  }>;
  /** En borrador. Devuelve el id. */
  insertCycle(
    fields: CycleFields & {
      readonly clubId: string;
      readonly createdBy: string;
    },
  ): Promise<string>;
  /** Se lleva los días y las semanas que pasen de `fields.weeks`, en la
   * misma transacción. */
  updateCycle(target: CycleTarget, fields: CycleFields): Promise<void>;
  activateCycle(
    target: CycleTarget,
  ): Promise<{ readonly archivedCycleId: string | null }>;
  archiveCycle(target: CycleTarget): Promise<void>;
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
};

/** Lo que no viene se queda como está. */
export type CycleChanges = Partial<CycleInput>;

type CycleRequest = { readonly callerId: string; readonly cycleId: string };

export class CycleNotFoundError extends Error {
  constructor() {
    super("No existe ese ciclo en tu club.");
    this.name = "CycleNotFoundError";
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

/** Nace en borrador (D5). Sin metadata: ni el nombre ni el evento. */
export async function createManagedCycle(
  gateways: ClubCyclesGateways,
  request: { readonly callerId: string; readonly input: CycleInput },
): Promise<ManagedCycleDetail> {
  const fields = fieldsFor(request.input);
  const actor = await findTrainingPlanner(gateways.members, request.callerId);
  const cycleId = await gateways.cycles.insertCycle({
    ...fields,
    clubId: actor.clubId,
    createdBy: actor.id,
  });
  await recordCycleEvent(gateways, {
    actor,
    action: "training_cycle.created",
    cycleId,
  });
  return readDetail(gateways, { clubId: actor.clubId, cycleId });
}

/** Con evento, el inicio se recalcula siempre: cambiar las semanas o la
 * fecha mueve el ciclo para que el evento siga en la última (D5). Bajar las
 * semanas con días con rutina en las que sobran pide `confirmRemoval`. */
export async function updateManagedCycle(
  gateways: ClubCyclesGateways,
  request: CycleRequest & {
    readonly changes: CycleChanges;
    readonly confirmRemoval: boolean;
  },
): Promise<ManagedCycleDetail> {
  const { actor, target, cycle } = await openCycle(gateways, request);
  const fields = fieldsFor({
    name: request.changes.name ?? cycle.name,
    weeks: request.changes.weeks ?? cycle.weeks,
    schedule: request.changes.schedule ?? scheduleOf(cycle),
  });
  const plan = await gateways.cycles.readCyclePlan(target);
  const daysRemoved = countDaysAfter(plan.days, fields.weeks);
  if (daysRemoved > 0 && !request.confirmRemoval) {
    throw new CycleDaysWouldBeRemovedError(daysRemoved);
  }
  await gateways.cycles.updateCycle(target, fields);
  await recordCycleEvent(gateways, {
    actor,
    action: "training_cycle.updated",
    cycleId: target.cycleId,
    metadata: { daysRemoved },
  });
  return readDetail(gateways, target);
}

/** El activo anterior pasa a archivado en la misma transacción (D5). */
export async function activateManagedCycle(
  gateways: ClubCyclesGateways,
  request: CycleRequest,
): Promise<ManagedCycles> {
  const { actor, target } = await openCycle(gateways, request);
  const { archivedCycleId } = await gateways.cycles.activateCycle(target);
  await recordCycleEvent(gateways, {
    actor,
    action: "training_cycle.activated",
    cycleId: target.cycleId,
    metadata: { archivedCycleId },
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

/** "{nombre} (copy)", recortado para que quepa en el límite del nombre. */
function copyName(name: string): string {
  const room = CYCLE_NAME_MAX_LENGTH - COPY_SUFFIX.length;
  return `${[...name].slice(0, room).join("").trimEnd()}${COPY_SUFFIX}`;
}

/** Un borrador con copias de las rutinas propias (RF-7). La bitácora es del
 * ciclo nuevo y dice de cuál sale. */
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
