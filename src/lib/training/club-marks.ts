import {
  type AuditAction,
  type AuditActor,
  type AuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import type { MarkUnit } from "./member-marks";
import { findTrainingPlanner } from "./training-planner";

/**
 * Las marcas del club en Planificar (#903, RF-11 y D11 del PRD de E35): el
 * Admin o el Coach las crea, las renombra y las borra. Las filas de rutina y
 * los valores de los socios apuntan al id, así que renombrar no les cambia
 * nada. De los valores sólo se ven cuentas: ni cuánto ni de quién (D11).
 *
 * El nombre repetido lo decide la base, sin mayúsculas ni acentos
 * (`0084_training_manage.sql`): es la que ve lo que otro guardó hace un
 * instante. Cada acción devuelve la lista entera tal como quedó.
 */

/** El límite de `training_marks_name_length` en `0083`. */
export const MARK_NAME_MAX_LENGTH = 60;

const MARK_ENTITY_TYPE = "training_mark";

/** Una marca del club con sus cuentas (`training_mark_usage`). */
export type ClubMarkRecord = {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
  /** Las filas de rutina que la usan para su carga. */
  readonly routineRows: number;
  /** Los socios que guardaron un valor. */
  readonly membersRecorded: number;
};

/** Lo que ve quien planifica. El orden es el de la lista, no un número. */
export type ManagedMark = {
  readonly id: string;
  readonly name: string;
  readonly unit: MarkUnit;
  readonly routineRows: number;
  readonly membersRecorded: number;
};

export type ManagedMarks = { readonly marks: readonly ManagedMark[] };

type MarkTarget = { readonly clubId: string; readonly markId: string };

export type MarkInsertResult =
  | { readonly kind: "created"; readonly markId: string }
  | { readonly kind: "name_taken" };

export type MarkRenameResult =
  | { readonly kind: "renamed" }
  | { readonly kind: "name_taken" }
  | { readonly kind: "not_found" };

/** `in_use` es la clave de una fila que empezó a usarla entretanto. */
export type MarkDeleteResult =
  { readonly kind: "deleted" } | { readonly kind: "in_use" };

export type ClubMarksGateway = {
  /** En su orden, con sus cuentas. */
  listMarks(clubId: string): Promise<readonly ClubMarkRecord[]>;
  insertMark(mark: {
    readonly clubId: string;
    readonly name: string;
    readonly sortOrder: number;
  }): Promise<MarkInsertResult>;
  renameMark(target: MarkTarget, name: string): Promise<MarkRenameResult>;
  /** Se lleva los valores de los socios con ella (`on delete cascade`). */
  deleteMark(target: MarkTarget): Promise<MarkDeleteResult>;
};

export type ClubMarksGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly marks: ClubMarksGateway;
  readonly audit: AuditLogWriter;
};

export type MarkIssueCode = "name_required" | "name_too_long";

export class MarkValidationError extends Error {
  readonly code: MarkIssueCode;

  constructor(code: MarkIssueCode) {
    super(`El nombre de la marca no vale: ${code}.`);
    this.name = "MarkValidationError";
    this.code = code;
  }
}

export class MarkNameTakenError extends Error {
  constructor() {
    super("Ya hay una marca con ese nombre.");
    this.name = "MarkNameTakenError";
  }
}

export class MarkNotFoundError extends Error {
  constructor() {
    super("No existe esa marca en tu club.");
    this.name = "MarkNotFoundError";
  }
}

export class MarkInUseError extends Error {
  constructor() {
    super("La marca está en uso: cambia antes esas filas de rutina.");
    this.name = "MarkInUseError";
  }
}

/** Sin usar, pero con valores: borrarla se los lleva, y eso se confirma. */
export class MarkHasValuesError extends Error {
  readonly membersRecorded: number;

  constructor(membersRecorded: number) {
    super(
      `${membersRecorded} socios registraron la marca: confirma para borrarla con sus valores.`,
    );
    this.name = "MarkHasValuesError";
    this.membersRecorded = membersRecorded;
  }
}

/** Como `char_length` de Postgres: un emoji es un carácter, no dos. */
function countCharacters(text: string): number {
  return [...text].length;
}

function validMarkName(raw: string): string {
  const name = raw.trim();
  if (name === "") {
    throw new MarkValidationError("name_required");
  }
  if (countCharacters(name) > MARK_NAME_MAX_LENGTH) {
    throw new MarkValidationError("name_too_long");
  }
  return name;
}

/** Detrás de la última: tras un borrado el orden no es seguido, así que no
 * vale contar cuántas hay. */
function nextSortOrder(marks: readonly ClubMarkRecord[]): number {
  return marks.reduce((last, mark) => Math.max(last, mark.sortOrder + 1), 0);
}

async function readManagedMarks(
  gateways: ClubMarksGateways,
  clubId: string,
): Promise<ManagedMarks> {
  const marks = await gateways.marks.listMarks(clubId);
  return {
    marks: marks.map((mark) => ({
      id: mark.id,
      name: mark.name,
      unit: "kg",
      routineRows: mark.routineRows,
      membersRecorded: mark.membersRecorded,
    })),
  };
}

function recordMarkEvent(
  gateways: ClubMarksGateways,
  event: {
    readonly actor: AuditActor;
    readonly action: AuditAction;
    readonly markId: string;
    readonly metadata?: Record<string, unknown>;
  },
): Promise<void> {
  return recordAuditEvent(gateways.audit, {
    actor: event.actor,
    clubId: event.actor.clubId,
    action: event.action,
    entityType: MARK_ENTITY_TYPE,
    entityId: event.markId,
    result: "success",
    metadata: event.metadata,
  });
}

export async function listClubMarks(
  gateways: ClubMarksGateways,
  callerId: string,
): Promise<ManagedMarks> {
  const actor = await findTrainingPlanner(gateways.members, callerId);
  return readManagedMarks(gateways, actor.clubId);
}

/** Al final de la lista. Sin metadata: ni el nombre nuevo ni el anterior,
 * como las posiciones del club. */
export async function createClubMark(
  gateways: ClubMarksGateways,
  request: { readonly callerId: string; readonly name: string },
): Promise<ManagedMarks> {
  const name = validMarkName(request.name);
  const actor = await findTrainingPlanner(gateways.members, request.callerId);
  const existing = await gateways.marks.listMarks(actor.clubId);
  const result = await gateways.marks.insertMark({
    clubId: actor.clubId,
    name,
    sortOrder: nextSortOrder(existing),
  });
  if (result.kind === "name_taken") {
    throw new MarkNameTakenError();
  }
  await recordMarkEvent(gateways, {
    actor,
    action: "training_mark.created",
    markId: result.markId,
  });
  return readManagedMarks(gateways, actor.clubId);
}

export async function renameClubMark(
  gateways: ClubMarksGateways,
  request: {
    readonly callerId: string;
    readonly markId: string;
    readonly name: string;
  },
): Promise<ManagedMarks> {
  const name = validMarkName(request.name);
  const actor = await findTrainingPlanner(gateways.members, request.callerId);
  const result = await gateways.marks.renameMark(
    { clubId: actor.clubId, markId: request.markId },
    name,
  );
  switch (result.kind) {
    case "not_found":
      throw new MarkNotFoundError();
    case "name_taken":
      throw new MarkNameTakenError();
    case "renamed":
      break;
  }
  await recordMarkEvent(gateways, {
    actor,
    action: "training_mark.renamed",
    markId: request.markId,
  });
  return readManagedMarks(gateways, actor.clubId);
}

/** Usada en una fila no se borra nunca. Sin usar y con valores, sólo con
 * `confirm`. La bitácora anota cuántos valores se fueron, nunca cuáles. */
export async function deleteClubMark(
  gateways: ClubMarksGateways,
  request: {
    readonly callerId: string;
    readonly markId: string;
    readonly confirm: boolean;
  },
): Promise<ManagedMarks> {
  const actor = await findTrainingPlanner(gateways.members, request.callerId);
  const marks = await gateways.marks.listMarks(actor.clubId);
  const mark = marks.find((candidate) => candidate.id === request.markId);
  if (mark === undefined) {
    throw new MarkNotFoundError();
  }
  if (mark.routineRows > 0) {
    throw new MarkInUseError();
  }
  if (mark.membersRecorded > 0 && !request.confirm) {
    throw new MarkHasValuesError(mark.membersRecorded);
  }
  const result = await gateways.marks.deleteMark({
    clubId: actor.clubId,
    markId: mark.id,
  });
  if (result.kind === "in_use") {
    throw new MarkInUseError();
  }
  await recordMarkEvent(gateways, {
    actor,
    action: "training_mark.deleted",
    markId: mark.id,
    metadata: { valuesDeleted: mark.membersRecorded },
  });
  return readManagedMarks(gateways, actor.clubId);
}
