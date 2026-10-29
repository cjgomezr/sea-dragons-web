import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";
import type { ManagedExercise } from "@/lib/training/club-exercises";
import type { PlannerError } from "./use-planner-cycles";

/** Cómo se escriben los ejercicios en Planificar (#910). */

const ROUTINE_SEPARATOR = " · ";

/** "Gym A · Strength", como la fila del handoff. */
export function formatRoutineNames(routines: readonly string[]): string {
  return routines.join(ROUTINE_SEPARATOR);
}

/** "In Gym A · Strength" o "Not in any routine yet". */
export function exerciseUsage(
  translate: Translator,
  exercise: ManagedExercise,
): string {
  return exercise.routines.length === 0
    ? translate("training.exercises.notInRoutine")
    : translate("training.exercises.inRoutines", {
        routines: formatRoutineNames(exercise.routines),
      });
}

/** Los motivos de la API (#903) que se explican; los demás dicen el error
 * general. El nombre repetido no está: lo dice su campo. */
const ERROR_KEYS = {
  name_required: "training.exercises.errorNameRequired",
  name_too_long: "training.exercises.errorNameTooLong",
  too_many_tips: "training.exercises.errorTooManyTips",
  tip_too_long: "training.exercises.errorTipTooLong",
  youtube_too_long: "training.exercises.errorYoutubeTooLong",
  photo_too_large: "training.exercises.photoTooLarge",
  photo_type_unsupported: "training.exercises.photoType",
  exercise_in_use: "training.exercises.errorInUse",
} as const satisfies Record<string, MessageKey>;

type ExplainedReason = keyof typeof ERROR_KEYS;

function isExplained(reason: string | null): reason is ExplainedReason {
  return reason !== null && Object.hasOwn(ERROR_KEYS, reason);
}

export function exerciseErrorMessage(
  translate: Translator,
  error: PlannerError,
): string {
  return translate(
    isExplained(error.reason)
      ? ERROR_KEYS[error.reason]
      : "training.manage.errorSave",
  );
}
