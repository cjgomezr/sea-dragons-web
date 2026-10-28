import { z } from "zod";

/**
 * Las filas de una rutina tal como llegan a Planificar (#905, D9 y D10 del
 * PRD de E35). Pura: lee la lista entera y la devuelve recortada, o dice qué
 * fila no vale. Que el ejercicio y la marca sean del club lo comprueba el
 * dominio, que tiene la base.
 *
 * Los topes son los de `training_routine_items` en `0083_training.sql`.
 */

export const ROUTINE_ITEMS_MAX = 60;
export const SECTION_TITLE_MAX_LENGTH = 60;
export const ITEM_REPS_MAX_LENGTH = 20;
export const ITEM_REST_MAX_LENGTH = 20;
export const ITEM_NOTE_MAX_LENGTH = 200;
export const LOAD_TEXT_MAX_LENGTH = 30;
export const ITEM_SETS_MIN = 1;
export const ITEM_SETS_MAX = 99;
export const LOAD_PCT_MAX = 150;
/** `numeric(4, 1)`: un decimal como mucho, para que la base no redondee. */
const LOAD_PCT_DECIMALS_FACTOR = 10;

/** Una de las cuatro cargas de D10, con la marca por su id. */
export type RoutineLoadDraft =
  | { readonly kind: "none" }
  | { readonly kind: "pct"; readonly markId: string; readonly pct: number }
  | { readonly kind: "week"; readonly markId: string }
  | { readonly kind: "text"; readonly text: string };

export type RoutineItemDraft =
  | { readonly kind: "section"; readonly title: string }
  | {
      readonly kind: "exercise";
      readonly exerciseId: string;
      readonly sets: number | null;
      readonly reps: string | null;
      readonly rest: string | null;
      readonly note: string | null;
      readonly load: RoutineLoadDraft;
    };

export type RoutineItemsIssueCode = "too_many_items" | "invalid_item";

export class RoutineItemsValidationError extends Error {
  readonly code: RoutineItemsIssueCode;
  /** La fila que no vale, desde 0; nula si es la lista entera. */
  readonly index: number | null;

  constructor(code: RoutineItemsIssueCode, index: number | null) {
    super(
      index === null
        ? `Las filas de la rutina no valen: ${code}.`
        : `La fila ${index + 1} de la rutina no vale.`,
    );
    this.name = "RoutineItemsValidationError";
    this.code = code;
    this.index = index;
  }
}

/** Como `char_length` de Postgres: un emoji es un carácter, no dos. */
export function countCharacters(text: string): number {
  return [...text].length;
}

function trimmedText(maxLength: number) {
  return z
    .string()
    .transform((text) => text.trim())
    .refine((text) => countCharacters(text) <= maxLength);
}

function requiredText(maxLength: number) {
  return trimmedText(maxLength).refine((text) => text !== "");
}

/** Vacío o ausente es nulo: la fila no lo lleva. */
function optionalText(maxLength: number) {
  return trimmedText(maxLength)
    .nullish()
    .transform((text) => (text === "" || text == null ? null : text));
}

const loadPctSchema = z
  .number()
  .gt(0)
  .max(LOAD_PCT_MAX)
  .refine((pct) => Number.isInteger(pct * LOAD_PCT_DECIMALS_FACTOR));

const loadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({ kind: z.literal("pct"), markId: z.uuid(), pct: loadPctSchema })
    .strict(),
  z.object({ kind: z.literal("week"), markId: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal("text"),
      text: requiredText(LOAD_TEXT_MAX_LENGTH),
    })
    .strict(),
]);

const itemSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("section"),
      title: requiredText(SECTION_TITLE_MAX_LENGTH),
    })
    .strict(),
  z
    .object({
      kind: z.literal("exercise"),
      exerciseId: z.uuid(),
      sets: z
        .number()
        .int()
        .min(ITEM_SETS_MIN)
        .max(ITEM_SETS_MAX)
        .nullish()
        .transform((sets) => sets ?? null),
      reps: optionalText(ITEM_REPS_MAX_LENGTH),
      rest: optionalText(ITEM_REST_MAX_LENGTH),
      note: optionalText(ITEM_NOTE_MAX_LENGTH),
      load: loadSchema,
    })
    .strict(),
]);

function readRoutineItem(raw: unknown, index: number): RoutineItemDraft {
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RoutineItemsValidationError("invalid_item", index);
  }
  return parsed.data;
}

/** La lista entera, en su orden, o el rechazo de la primera fila que no
 * vale. */
export function readRoutineItems(
  raw: readonly unknown[],
): readonly RoutineItemDraft[] {
  if (raw.length > ROUTINE_ITEMS_MAX) {
    throw new RoutineItemsValidationError("too_many_items", null);
  }
  return raw.map(readRoutineItem);
}

/** Los ejercicios y las marcas que nombran las filas, cada uno una vez. */
export function referencedIds(items: readonly RoutineItemDraft[]): {
  readonly exerciseIds: readonly string[];
  readonly markIds: readonly string[];
} {
  const exerciseIds = new Set<string>();
  const markIds = new Set<string>();
  for (const item of items) {
    if (item.kind === "section") {
      continue;
    }
    exerciseIds.add(item.exerciseId);
    if (item.load.kind === "pct" || item.load.kind === "week") {
      markIds.add(item.load.markId);
    }
  }
  return { exerciseIds: [...exerciseIds], markIds: [...markIds] };
}
