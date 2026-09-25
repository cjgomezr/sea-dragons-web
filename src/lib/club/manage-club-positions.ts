import {
  type AuditAction,
  type AuditActor,
  type AuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import type { Locale } from "@/lib/i18n/locale";
import type { ClubPositions, PositionNames } from "./club-positions";
import { type ClubSettingsGateways, findAdministrator } from "./club-settings";

/**
 * El Admin administra las posiciones del club (#300, RF-7 del PRD de E18a),
 * contado sin Supabase delante: crea, renombra, reordena, archiva y reactiva.
 *
 * Nada se borra (D3 del PRD) y nada toca a los miembros: `members` apunta al
 * id de la posición, así que renombrarla o archivarla no les cambia cuál
 * tienen. Cada acción devuelve el catálogo entero tal como quedó, que es lo
 * que la pantalla vuelve a pintar.
 */

/** El límite de `club_position_names_name_length` en `0025`. */
export const POSITION_NAME_MAX_LENGTH = 40;

export const POSITION_ISSUE_CODES = [
  "name_required",
  "name_en_too_long",
  "name_es_too_long",
  "name_en_taken",
  "name_es_taken",
] as const;

export type PositionIssueCode = (typeof POSITION_ISSUE_CODES)[number];

export type PositionIssue = { readonly code: PositionIssueCode };

/** Lo que llega del formulario: un campo por idioma, quizá en blanco. */
export type PositionNamesInput = {
  readonly [L in Locale]: string | null;
};

export const POSITIONS_CHANGED_REASON = "club_positions_changed";

type PositionTarget = { readonly clubId: string; readonly positionId: string };

export type PositionInsertResult =
  | { readonly kind: "created"; readonly positionId: string }
  | { readonly kind: "name_taken"; readonly locale: Locale };

export type PositionRenameResult =
  | { readonly kind: "renamed" }
  | { readonly kind: "name_taken"; readonly locale: Locale }
  | { readonly kind: "not_found" };

export type PositionReorderResult =
  { readonly kind: "reordered" } | { readonly kind: "positions_changed" };

export type PositionArchiveResult =
  | { readonly kind: "changed" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "not_found" };

export type ManagedPositionsGateways = {
  readonly members: ClubSettingsGateways["members"];
  readonly positions: {
    /** Todas, archivadas incluidas, en el orden del club. */
    findClubPositions(clubId: string): Promise<ClubPositions>;
    insertPosition(
      clubId: string,
      names: PositionNames,
    ): Promise<PositionInsertResult>;
    renamePosition(
      target: PositionTarget,
      names: PositionNames,
    ): Promise<PositionRenameResult>;
    /** `positionIds` son las activas, todas, en el orden nuevo. */
    reorderPositions(
      clubId: string,
      positionIds: readonly string[],
    ): Promise<PositionReorderResult>;
    setPositionArchived(
      target: PositionTarget,
      isArchived: boolean,
    ): Promise<PositionArchiveResult>;
  };
  readonly audit: AuditLogWriter;
};

export class PositionValidationError extends Error {
  readonly issues: readonly PositionIssue[];

  constructor(issues: readonly PositionIssue[]) {
    super(
      `Los nombres de la posición no valen: ${issues
        .map((issue) => issue.code)
        .join(", ")}.`,
    );
    this.name = "PositionValidationError";
    this.issues = issues;
  }
}

export class PositionNotFoundError extends Error {
  constructor() {
    super("No existe esa posición en tu club.");
    this.name = "PositionNotFoundError";
  }
}

export class PositionsChangedError extends Error {
  constructor() {
    super(
      "Otro Admin cambió las posiciones mientras las ordenabas: vuelve a cargarlas.",
    );
    this.name = "PositionsChangedError";
  }
}

const TOO_LONG_ISSUE: Readonly<Record<Locale, PositionIssueCode>> = {
  en: "name_en_too_long",
  es: "name_es_too_long",
};

const TAKEN_ISSUE: Readonly<Record<Locale, PositionIssueCode>> = {
  en: "name_en_taken",
  es: "name_es_taken",
};

const LOCALES = ["en", "es"] as const satisfies readonly Locale[];

const POSITION_ENTITY_TYPE = "club_position";
const CLUB_ENTITY_TYPE = "club";

function normalizeName(name: string | null): string | null {
  const trimmed = name?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** Recortados, y un campo en blanco como ninguno: así los guarda la base. */
export function normalizePositionNames(
  names: PositionNamesInput,
): PositionNames {
  return { en: normalizeName(names.en), es: normalizeName(names.es) };
}

/** Como `char_length` de Postgres: un emoji es un carácter, no dos. */
function countCharacters(text: string): number {
  return [...text].length;
}

/** Lo que se puede saber sin mirar el catálogo. El nombre repetido lo decide
 * la base, que es la que ve lo que otro Admin guardó hace un instante. */
export function findPositionNameIssues(
  input: PositionNamesInput,
): readonly PositionIssue[] {
  const names = normalizePositionNames(input);
  if (names.en === null && names.es === null) {
    return [{ code: "name_required" }];
  }
  return LOCALES.filter((locale) => {
    const name = names[locale];
    return name !== null && countCharacters(name) > POSITION_NAME_MAX_LENGTH;
  }).map((locale) => ({ code: TOO_LONG_ISSUE[locale] }));
}

function validNames(input: PositionNamesInput): PositionNames {
  const issues = findPositionNameIssues(input);
  if (issues.length > 0) {
    throw new PositionValidationError(issues);
  }
  return normalizePositionNames(input);
}

function nameTaken(locale: Locale): PositionValidationError {
  return new PositionValidationError([{ code: TAKEN_ISSUE[locale] }]);
}

/** Sin metadata salvo al reordenar: quién, qué y sobre qué ya están en la
 * entrada, y el nombre no hace falta para saber qué pasó. */
function recordPositionEvent(
  gateways: ManagedPositionsGateways,
  event: {
    readonly actor: AuditActor;
    readonly action: AuditAction;
    readonly positionId: string;
  },
): Promise<void> {
  return recordAuditEvent(gateways.audit, {
    actor: event.actor,
    clubId: event.actor.clubId,
    action: event.action,
    entityType: POSITION_ENTITY_TYPE,
    entityId: event.positionId,
    result: "success",
  });
}

async function findAdministratorActor(
  gateways: ManagedPositionsGateways,
  callerId: string,
): Promise<AuditActor> {
  const caller = await findAdministrator(gateways, callerId);
  return { id: callerId, clubId: caller.clubId };
}

export async function listManagedPositions(
  gateways: ManagedPositionsGateways,
  callerId: string,
): Promise<ClubPositions> {
  const actor = await findAdministratorActor(gateways, callerId);
  return gateways.positions.findClubPositions(actor.clubId);
}

/** Valida antes de leer nada y anota después de escribir: auditar primero
 * dejaría rastro de un cambio que no se guardó. */
export async function createPosition(
  gateways: ManagedPositionsGateways,
  request: { readonly callerId: string; readonly names: PositionNamesInput },
): Promise<ClubPositions> {
  const names = validNames(request.names);
  const actor = await findAdministratorActor(gateways, request.callerId);
  const result = await gateways.positions.insertPosition(actor.clubId, names);
  if (result.kind === "name_taken") {
    throw nameTaken(result.locale);
  }
  await recordPositionEvent(gateways, {
    actor,
    action: "club_position.created",
    positionId: result.positionId,
  });
  return gateways.positions.findClubPositions(actor.clubId);
}

export async function renamePosition(
  gateways: ManagedPositionsGateways,
  request: {
    readonly callerId: string;
    readonly positionId: string;
    readonly names: PositionNamesInput;
  },
): Promise<ClubPositions> {
  const names = validNames(request.names);
  const actor = await findAdministratorActor(gateways, request.callerId);
  const result = await gateways.positions.renamePosition(
    { clubId: actor.clubId, positionId: request.positionId },
    names,
  );
  switch (result.kind) {
    case "not_found":
      throw new PositionNotFoundError();
    case "name_taken":
      throw nameTaken(result.locale);
    case "renamed":
      break;
  }
  await recordPositionEvent(gateways, {
    actor,
    action: "club_position.renamed",
    positionId: request.positionId,
  });
  return gateways.positions.findClubPositions(actor.clubId);
}

/** La lista entera en el orden nuevo, no un movimiento: si otro Admin cambió
 * las activas entretanto, no casa y no se aplica. */
export async function reorderPositions(
  gateways: ManagedPositionsGateways,
  request: {
    readonly callerId: string;
    readonly positionIds: readonly string[];
  },
): Promise<ClubPositions> {
  const actor = await findAdministratorActor(gateways, request.callerId);
  const result = await gateways.positions.reorderPositions(
    actor.clubId,
    request.positionIds,
  );
  if (result.kind === "positions_changed") {
    throw new PositionsChangedError();
  }
  await recordAuditEvent(gateways.audit, {
    actor,
    clubId: actor.clubId,
    action: "club_position.reordered",
    entityType: CLUB_ENTITY_TYPE,
    entityId: actor.clubId,
    result: "success",
    metadata: { positionIds: request.positionIds },
  });
  return gateways.positions.findClubPositions(actor.clubId);
}

/** Archivar la que ya lo está no es un cambio, y no se anota. */
export async function setPositionArchived(
  gateways: ManagedPositionsGateways,
  request: {
    readonly callerId: string;
    readonly positionId: string;
    readonly isArchived: boolean;
  },
): Promise<ClubPositions> {
  const actor = await findAdministratorActor(gateways, request.callerId);
  const result = await gateways.positions.setPositionArchived(
    { clubId: actor.clubId, positionId: request.positionId },
    request.isArchived,
  );
  if (result.kind === "not_found") {
    throw new PositionNotFoundError();
  }
  if (result.kind === "changed") {
    await recordPositionEvent(gateways, {
      actor,
      action: request.isArchived
        ? "club_position.archived"
        : "club_position.reactivated",
      positionId: request.positionId,
    });
  }
  return gateways.positions.findClubPositions(actor.clubId);
}
