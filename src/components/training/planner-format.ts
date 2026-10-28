import { formatDashboardDay } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";
import type { CycleStatus, ManagedCycle } from "@/lib/training/club-cycles";
import type { CycleIssueCode } from "@/lib/training/club-cycle-input";
import type { CycleSummary } from "@/lib/training/cycle-planner-view";
import { cycleEndDate } from "@/lib/training/cycle-week";
import { formatShortDate } from "./training-format";
import type { PlannerError } from "./use-planner-cycles";

/** Cómo se escriben los ciclos en Planificar (#906). */

const STATUS_KEYS = {
  active: "training.manage.statusActive",
  draft: "training.manage.statusDraft",
  archived: "training.manage.statusArchived",
} as const satisfies Record<CycleStatus, MessageKey>;

export function statusLabel(
  translate: Translator,
  status: CycleStatus,
): string {
  return translate(STATUS_KEYS[status]);
}

/** "28 weeks · 12 Oct – 25 Apr · 4 routines". */
export function cycleMeta(translate: Translator, cycle: ManagedCycle): string {
  return translate("training.manage.cycleMeta", {
    count: cycle.weeks,
    start: formatShortDate(translate.locale, cycle.startDate),
    end: formatShortDate(translate.locale, cycleEndDate(cycle)),
    routines: translate("training.manage.routines", {
      count: cycle.ownRoutines,
    }),
  });
}

/** La línea calculada bajo los campos. */
export function summaryLine(
  translate: Translator,
  summary: CycleSummary,
): string {
  const start = formatDashboardDay(translate.locale, summary.startDate);
  switch (summary.kind) {
    case "active":
      return summary.eventWeek === null
        ? translate("training.manage.lineActive", {
            start,
            end: formatDashboardDay(translate.locale, summary.endDate),
            week: summary.currentWeek,
          })
        : translate("training.manage.lineActiveEvent", {
            start,
            eventWeek: summary.eventWeek,
            week: summary.currentWeek,
          });
    case "draft":
      return translate("training.manage.lineDraft", { start });
    case "archived":
      return translate("training.manage.lineArchived", {
        start: formatShortDate(translate.locale, summary.startDate),
        end: formatShortDate(translate.locale, summary.endDate),
      });
  }
}

/** El motivo que dice la pantalla sin preguntar a la API. */
export const DATE_REQUIRED_REASON = "date_required";

/** Los motivos que se explican al cambiar un ciclo desde sus campos; los
 * demás dicen el error general. */
const ERROR_KEYS = {
  name_required: "training.manage.errorNameRequired",
  name_too_long: "training.manage.errorNameTooLong",
  event_name_required: "training.manage.errorEventName",
  event_name_too_long: "training.manage.errorNameTooLong",
  weeks_out_of_range: "training.manage.errorWeeks",
  [DATE_REQUIRED_REASON]: "training.manage.errorDate",
} as const satisfies Partial<
  Record<CycleIssueCode | typeof DATE_REQUIRED_REASON, MessageKey>
>;

type ExplainedReason = keyof typeof ERROR_KEYS;

function isExplained(reason: string | null): reason is ExplainedReason {
  return reason !== null && Object.hasOwn(ERROR_KEYS, reason);
}

export function plannerErrorMessage(
  translate: Translator,
  error: PlannerError,
): string {
  return translate(
    isExplained(error.reason)
      ? ERROR_KEYS[error.reason]
      : "training.manage.errorSave",
  );
}
