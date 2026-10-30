import type { IsoWeekday } from "@/lib/events/event-occurrences";
import { formatDashboardDay, formatWeekdayName } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";
import type {
  CycleStatus,
  CycleWeekRecord,
  ManagedCycle,
} from "@/lib/training/club-cycles";
import type { ManagedRoutine } from "@/lib/training/club-routines";
import type { CycleIssueCode } from "@/lib/training/club-cycle-input";
import type { CycleSummary } from "@/lib/training/cycle-planner-view";
import { cycleDayDate, cycleEndDate } from "@/lib/training/cycle-week";
import type { DoseIntensity, WeekDose } from "@/lib/training/training-load";
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

/** Otra pestaña activó el ciclo entre que se pintó y se pidió borrarlo
 * (#935). */
export const CYCLE_IS_ACTIVE_REASON = "cycle_is_active";

/** Los motivos que se explican al cambiar un ciclo desde sus campos; los
 * demás dicen el error general. También el de borrar un ciclo que ya está
 * activo, que no viene de los campos pero lo dice el mismo aviso. */
const ERROR_KEYS = {
  name_required: "training.manage.errorNameRequired",
  name_too_long: "training.manage.errorNameTooLong",
  event_name_required: "training.manage.errorEventName",
  event_name_too_long: "training.manage.errorNameTooLong",
  weeks_out_of_range: "training.manage.errorWeeks",
  note_too_long: "training.manage.errorNoteTooLong",
  dose_sets_out_of_range: "training.manage.errorDoseSets",
  dose_reps_too_long: "training.manage.errorDoseTextTooLong",
  dose_text_too_long: "training.manage.errorDoseTextTooLong",
  dose_pct_out_of_range: "training.manage.errorDosePct",
  [DATE_REQUIRED_REASON]: "training.manage.errorDate",
  [CYCLE_IS_ACTIVE_REASON]: "training.manage.errorCycleIsActive",
} as const satisfies Partial<
  Record<
    | CycleIssueCode
    | typeof DATE_REQUIRED_REASON
    | typeof CYCLE_IS_ACTIVE_REASON,
    MessageKey
  >
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

/** "Mon", "lun": la cabecera de un día de la cuadrícula (0 es el lunes). */
export function gridWeekdayName(
  translate: Translator,
  weekday: number,
): string {
  return formatWeekdayName(
    translate.locale,
    (weekday + 1) as IsoWeekday,
    "short",
  );
}

/** "26 Oct – 1 Nov": del lunes al domingo de una semana del ciclo. */
export function gridWeekRange(
  translate: Translator,
  cycle: ManagedCycle,
  week: number,
): string {
  const dateOf = (weekday: number): string =>
    formatShortDate(translate.locale, cycleDayDate(cycle, { week, weekday }));
  return translate("training.member.weekRange", {
    start: dateOf(0),
    end: dateOf(6),
  });
}

/** Las compartidas acaban en "(shared)" (§5.1 del handoff). */
export function routineOptionLabel(
  translate: Translator,
  routine: ManagedRoutine,
): string {
  return routine.cycleId === null
    ? translate("training.manage.sharedRoutine", { name: routine.name })
    : routine.name;
}

function describeSetsReps(
  translate: Translator,
  dose: WeekDose,
): string | null {
  const { sets, reps } = dose;
  if (sets !== null && reps !== null) {
    return translate("training.member.doseSetsReps", { sets, reps });
  }
  return reps ?? (sets === null ? null : String(sets));
}

function describeIntensity(
  translate: Translator,
  intensity: DoseIntensity,
): string | null {
  switch (intensity.kind) {
    case "none":
      return null;
    case "pct":
      return translate("training.member.pct", { pct: intensity.pct });
    case "text":
      return intensity.text;
  }
}

const SUMMARY_SEPARATOR = " · ";

/** "Camp · 4 × 5 · 80%" junto a las fechas; nulo sin nota ni dosis. */
export function weekSummary(
  translate: Translator,
  week: CycleWeekRecord,
): string | null {
  const parts = [
    week.note,
    ...(week.dose === null
      ? []
      : [
          describeSetsReps(translate, week.dose),
          describeIntensity(translate, week.dose.intensity),
        ]),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(SUMMARY_SEPARATOR);
}
