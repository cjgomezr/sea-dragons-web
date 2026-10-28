import {
  type AuditAction,
  type AuditActor,
  type AuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { CycleNotFoundError } from "./club-cycles";
import { ExerciseNotFoundError } from "./club-exercises";
import {
  type RoutineItemDraft,
  type RoutineLoadDraft,
  countCharacters,
  readRoutineItems,
  referencedIds,
} from "./routine-items";
import { findTrainingPlanner } from "./training-planner";

/**
 * Las rutinas en Planificar (#905, RF-9, D8, D9 y D10 del PRD de E35): el
 * Admin o el Coach las crea en un ciclo o compartidas, las renombra, las
 * borra y guarda sus filas enteras. Al añadir un ejercicio, la pantalla pide
 * la última dosis que el club usó con él.
 *
 * Lo que tiene que ser una sola transacción (sustituir las filas, borrar una
 * rutina usada) lo hace la base (`0086_training_routines_manage.sql`).
 */

/** El límite de `training_routines_name_length` en `0083`. */
export const ROUTINE_NAME_MAX_LENGTH = 60;

/** Los colores de las rutinas (D15): se guarda el índice y cada tema pinta
 * el suyo. */
export const ROUTINE_PALETTE_SIZE = 6;

const ROUTINE_ENTITY_TYPE = "training_routine";

/** Una rutina con sus cuentas: las filas y los días de la cuadrícula que la
 * usan, en todos los ciclos. `cycleId` nulo es una compartida (D8). */
export type ManagedRoutine = {
  readonly id: string;
  readonly name: string;
  readonly cycleId: string | null;
  readonly colorIndex: number;
  readonly itemCount: number;
  readonly daysUsed: number;
};

export type ManagedRoutines = { readonly routines: readonly ManagedRoutine[] };

export type ManagedRoutineResult = { readonly routine: ManagedRoutine };

export type DeletedRoutine = {
  readonly routineId: string;
  /** Los días que la usaban y quedaron en descanso. */
  readonly daysCleared: number;
};

export type SavedRoutineItems = {
  readonly routine: ManagedRoutine;
  readonly items: readonly RoutineItemDraft[];
};

/** Lo que se copia en una fila nueva del mismo ejercicio (RF-9). */
export type LastDose = {
  readonly sets: number | null;
  readonly reps: string | null;
  readonly rest: string | null;
  readonly load: RoutineLoadDraft;
};

export type ExerciseLastDose = { readonly dose: LastDose | null };

export type RoutineListScope =
  | { readonly kind: "cycle"; readonly cycleId: string }
  | { readonly kind: "shared" };

export type RoutineTarget = {
  readonly clubId: string;
  readonly routineId: string;
};

export type RoutineInsertResult =
  | { readonly kind: "created"; readonly routineId: string }
  | { readonly kind: "cycle_not_found" };

export type RoutineDeleteResult =
  | { readonly kind: "deleted"; readonly daysCleared: number }
  | { readonly kind: "in_use"; readonly daysUsed: number }
  | { readonly kind: "not_found" };

/** `stale_reference`: un ejercicio o una marca que se borró entretanto. */
export type RoutineItemsReplaceResult =
  | { readonly kind: "replaced" }
  | { readonly kind: "stale_reference" }
  | { readonly kind: "not_found" };

type ReferencedIds = ReturnType<typeof referencedIds>;

export type ClubRoutinesGateway = {
  cycleExists(target: {
    readonly clubId: string;
    readonly cycleId: string;
  }): Promise<boolean>;
  /** Las de un ciclo, o las compartidas con `cycleId` nulo, en el orden en
   * que se crearon. */
  listRoutines(
    clubId: string,
    cycleId: string | null,
  ): Promise<readonly ManagedRoutine[]>;
  findRoutine(target: RoutineTarget): Promise<ManagedRoutine | null>;
  insertRoutine(row: {
    readonly clubId: string;
    readonly cycleId: string | null;
    readonly name: string;
    readonly colorIndex: number;
  }): Promise<RoutineInsertResult>;
  /** Falso si no es del club. */
  renameRoutine(target: RoutineTarget, name: string): Promise<boolean>;
  /** Una usada sólo se borra con `confirm`; sus días quedan en descanso. */
  deleteRoutine(
    target: RoutineTarget,
    confirm: boolean,
  ): Promise<RoutineDeleteResult>;
  /** Los ids que no son del club (ni de la biblioteca, si es un
   * ejercicio). */
  findUnknownReferences(
    clubId: string,
    ids: ReferencedIds,
  ): Promise<ReferencedIds>;
  replaceItems(
    target: RoutineTarget,
    items: readonly RoutineItemDraft[],
  ): Promise<RoutineItemsReplaceResult>;
  /** Si es de la biblioteca o del club. */
  exerciseVisible(clubId: string, exerciseId: string): Promise<boolean>;
  findLastDose(clubId: string, exerciseId: string): Promise<LastDose | null>;
};

export type ClubRoutinesGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly routines: ClubRoutinesGateway;
  readonly audit: AuditLogWriter;
};

export type RoutineIssueCode = "name_required" | "name_too_long";

export class RoutineValidationError extends Error {
  readonly code: RoutineIssueCode;

  constructor(code: RoutineIssueCode) {
    super(`El nombre de la rutina no vale: ${code}.`);
    this.name = "RoutineValidationError";
    this.code = code;
  }
}

export class RoutineNotFoundError extends Error {
  constructor() {
    super("No existe esa rutina en tu club.");
    this.name = "RoutineNotFoundError";
  }
}

/** Usada en la cuadrícula: borrarla deja esos días en descanso, y eso se
 * confirma. */
export class RoutineInUseError extends Error {
  readonly daysUsed: number;

  constructor(daysUsed: number) {
    super(
      `La rutina se usa en ${daysUsed} días: confirma para borrarla y dejarlos en descanso.`,
    );
    this.name = "RoutineInUseError";
    this.daysUsed = daysUsed;
  }
}

/** Una fila nombra un ejercicio o una marca que no es del club. */
export class RoutineItemReferenceError extends Error {
  constructor() {
    super("Una fila nombra un ejercicio o una marca que no es de tu club.");
    this.name = "RoutineItemReferenceError";
  }
}

/** El color de una rutina nueva: el siguiente de la paleta según cuántas
 * hay ya en su ámbito, el ciclo o las compartidas. */
export function nextRoutineColorIndex(routinesInScope: number): number {
  return routinesInScope % ROUTINE_PALETTE_SIZE;
}

function validRoutineName(raw: string): string {
  const name = raw.trim();
  if (name === "") {
    throw new RoutineValidationError("name_required");
  }
  if (countCharacters(name) > ROUTINE_NAME_MAX_LENGTH) {
    throw new RoutineValidationError("name_too_long");
  }
  return name;
}

function recordRoutineEvent(
  gateways: ClubRoutinesGateways,
  event: {
    readonly actor: AuditActor;
    readonly action: AuditAction;
    readonly routineId: string;
    readonly metadata?: Record<string, unknown>;
  },
): Promise<void> {
  return recordAuditEvent(gateways.audit, {
    actor: event.actor,
    clubId: event.actor.clubId,
    action: event.action,
    entityType: ROUTINE_ENTITY_TYPE,
    entityId: event.routineId,
    result: "success",
    metadata: event.metadata,
  });
}

async function assertCycleInClub(
  gateways: ClubRoutinesGateways,
  target: { readonly clubId: string; readonly cycleId: string },
): Promise<void> {
  if (!(await gateways.routines.cycleExists(target))) {
    throw new CycleNotFoundError();
  }
}

async function findRoutineInClub(
  gateways: ClubRoutinesGateways,
  target: RoutineTarget,
): Promise<ManagedRoutine> {
  const routine = await gateways.routines.findRoutine(target);
  if (routine === null) {
    throw new RoutineNotFoundError();
  }
  return routine;
}

/** Las de un ciclo y después las compartidas, o sólo las compartidas: no
 * hay "todas" (RF-9). */
export async function listClubRoutines(
  gateways: ClubRoutinesGateways,
  request: { readonly callerId: string; readonly scope: RoutineListScope },
): Promise<ManagedRoutines> {
  const actor = await findTrainingPlanner(gateways.members, request.callerId);
  if (request.scope.kind === "shared") {
    return {
      routines: await gateways.routines.listRoutines(actor.clubId, null),
    };
  }
  const target = { clubId: actor.clubId, cycleId: request.scope.cycleId };
  await assertCycleInClub(gateways, target);
  const [own, shared] = await Promise.all([
    gateways.routines.listRoutines(actor.clubId, target.cycleId),
    gateways.routines.listRoutines(actor.clubId, null),
  ]);
  return { routines: [...own, ...shared] };
}

/** Sin metadata, como las marcas: ni el nombre ni el ciclo. */
export async function createClubRoutine(
  gateways: ClubRoutinesGateways,
  request: {
    readonly callerId: string;
    readonly cycleId: string | null;
    readonly name: string;
  },
): Promise<ManagedRoutineResult> {
  const name = validRoutineName(request.name);
  const actor = await findTrainingPlanner(gateways.members, request.callerId);
  const { cycleId } = request;
  if (cycleId !== null) {
    await assertCycleInClub(gateways, { clubId: actor.clubId, cycleId });
  }
  const inScope = await gateways.routines.listRoutines(actor.clubId, cycleId);
  const colorIndex = nextRoutineColorIndex(inScope.length);
  const result = await gateways.routines.insertRoutine({
    clubId: actor.clubId,
    cycleId,
    name,
    colorIndex,
  });
  if (result.kind === "cycle_not_found") {
    throw new CycleNotFoundError();
  }
  await recordRoutineEvent(gateways, {
    actor,
    action: "training_routine.created",
    routineId: result.routineId,
  });
  return {
    routine: {
      id: result.routineId,
      name,
      cycleId,
      colorIndex,
      itemCount: 0,
      daysUsed: 0,
    },
  };
}

export async function renameClubRoutine(
  gateways: ClubRoutinesGateways,
  request: {
    readonly callerId: string;
    readonly routineId: string;
    readonly name: string;
  },
): Promise<ManagedRoutineResult> {
  const name = validRoutineName(request.name);
  const actor = await findTrainingPlanner(gateways.members, request.callerId);
  const target = { clubId: actor.clubId, routineId: request.routineId };
  if (!(await gateways.routines.renameRoutine(target, name))) {
    throw new RoutineNotFoundError();
  }
  await recordRoutineEvent(gateways, {
    actor,
    action: "training_routine.renamed",
    routineId: request.routineId,
  });
  return { routine: await findRoutineInClub(gateways, target) };
}

/** Usada en la cuadrícula, sólo con `confirm`. La bitácora anota cuántos
 * días quedaron en descanso. */
export async function deleteClubRoutine(
  gateways: ClubRoutinesGateways,
  request: {
    readonly callerId: string;
    readonly routineId: string;
    readonly confirm: boolean;
  },
): Promise<DeletedRoutine> {
  const actor = await findTrainingPlanner(gateways.members, request.callerId);
  const result = await gateways.routines.deleteRoutine(
    { clubId: actor.clubId, routineId: request.routineId },
    request.confirm,
  );
  switch (result.kind) {
    case "not_found":
      throw new RoutineNotFoundError();
    case "in_use":
      throw new RoutineInUseError(result.daysUsed);
    case "deleted":
      break;
  }
  await recordRoutineEvent(gateways, {
    actor,
    action: "training_routine.deleted",
    routineId: request.routineId,
    metadata: { daysCleared: result.daysCleared },
  });
  return { routineId: request.routineId, daysCleared: result.daysCleared };
}

async function assertReferencesInClub(
  gateways: ClubRoutinesGateways,
  clubId: string,
  items: readonly RoutineItemDraft[],
): Promise<void> {
  const unknown = await gateways.routines.findUnknownReferences(
    clubId,
    referencedIds(items),
  );
  if (unknown.exerciseIds.length > 0 || unknown.markIds.length > 0) {
    throw new RoutineItemReferenceError();
  }
}

/** Sustituye las filas por `rawItems`, en ese orden. La bitácora anota
 * cuántas, no cuáles. */
export async function saveRoutineItems(
  gateways: ClubRoutinesGateways,
  request: {
    readonly callerId: string;
    readonly routineId: string;
    readonly items: readonly unknown[];
  },
): Promise<SavedRoutineItems> {
  const actor = await findTrainingPlanner(gateways.members, request.callerId);
  const items = readRoutineItems(request.items);
  const target = { clubId: actor.clubId, routineId: request.routineId };
  const routine = await findRoutineInClub(gateways, target);
  await assertReferencesInClub(gateways, actor.clubId, items);
  const result = await gateways.routines.replaceItems(target, items);
  switch (result.kind) {
    case "not_found":
      throw new RoutineNotFoundError();
    case "stale_reference":
      throw new RoutineItemReferenceError();
    case "replaced":
      break;
  }
  await recordRoutineEvent(gateways, {
    actor,
    action: "training_routine.items_saved",
    routineId: request.routineId,
    metadata: { itemCount: items.length },
  });
  return { routine: { ...routine, itemCount: items.length }, items };
}

/** La dosis de la última fila del club con ese ejercicio, o nula si nunca se
 * usó (RF-9). */
export async function findLastExerciseDose(
  gateways: ClubRoutinesGateways,
  request: { readonly callerId: string; readonly exerciseId: string },
): Promise<ExerciseLastDose> {
  const actor = await findTrainingPlanner(gateways.members, request.callerId);
  if (
    !(await gateways.routines.exerciseVisible(actor.clubId, request.exerciseId))
  ) {
    throw new ExerciseNotFoundError();
  }
  return {
    dose: await gateways.routines.findLastDose(
      actor.clubId,
      request.exerciseId,
    ),
  };
}
