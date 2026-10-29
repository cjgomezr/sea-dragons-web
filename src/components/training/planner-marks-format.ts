import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";
import type { ManagedMark } from "@/lib/training/club-marks";
import type { PlannerError } from "./use-planner-cycles";

/** Cómo se escriben las marcas en Planificar (#911). */

/** "Used in 1 exercise · 12 members recorded it": sólo cuentas, nunca un
 * valor ni un nombre (D11). */
export function markUsage(translate: Translator, mark: ManagedMark): string {
  const used =
    mark.routineRows === 0
      ? translate("training.marks.notUsed")
      : translate("training.marks.usedIn", { count: mark.routineRows });
  const recorded =
    mark.membersRecorded === 0
      ? translate("training.marks.notRecorded")
      : translate("training.marks.recorded", { count: mark.membersRecorded });
  return `${used} · ${recorded}`;
}

/** Los motivos de la API (#903) que se explican; los demás dicen el error
 * general. El nombre repetido no está: lo dice su campo. */
const ERROR_KEYS = {
  name_required: "training.marks.errorNameRequired",
  name_too_long: "training.marks.errorNameTooLong",
  mark_in_use: "training.marks.errorInUse",
  mark_has_values: "training.marks.errorHasValues",
} as const satisfies Record<string, MessageKey>;

type ExplainedReason = keyof typeof ERROR_KEYS;

function isExplained(reason: string | null): reason is ExplainedReason {
  return reason !== null && Object.hasOwn(ERROR_KEYS, reason);
}

export function markErrorMessage(
  translate: Translator,
  error: PlannerError,
): string {
  return translate(
    isExplained(error.reason)
      ? ERROR_KEYS[error.reason]
      : "training.manage.errorSave",
  );
}
