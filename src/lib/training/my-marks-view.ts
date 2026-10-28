import type { MemberMark } from "./member-marks";
import { markUsedByRow } from "./routine-row-view";
import type { TrainingWeek } from "./training-plan";

/**
 * Qué enseña la tarjeta Mis marcas (#902, RF-5 del PRD de E35, §4.1 del
 * handoff). Con pocas marcas, todas. Con más, solo las que piden las rutinas
 * de la semana que se mira, para que el socio no busque la suya entre todas
 * las del club; el conmutador enseña el resto.
 */

/** Hasta aquí caben todas sin filtrar. */
const MAX_UNFILTERED_MARKS = 4;
/** Las que se enseñan cuando ninguna rutina de la semana usa marcas. */
const FALLBACK_MARK_COUNT = 3;

export type MyMarksEntry = {
  readonly mark: MemberMark;
  /** La usa alguna rutina de la semana; solo se dice cuando se filtra. */
  readonly isThisWeek: boolean;
};

/** "Show all {m} marks", "Show only this week's marks", o ninguno. */
export type MyMarksToggle = "none" | "showAll" | "showWeek";

export type MyMarksView = {
  readonly entries: readonly MyMarksEntry[];
  readonly setCount: number;
  readonly total: number;
  readonly toggle: MyMarksToggle;
};

/** Las marcas de las que salen kilos en alguna fila de la semana. */
function marksUsedInWeek(week: TrainingWeek): ReadonlySet<string> {
  const used = new Set<string>();
  for (const day of week.days) {
    for (const routine of day.routines) {
      for (const item of routine.items) {
        const mark =
          item.kind === "exercise" ? markUsedByRow(item, week.dose) : null;
        if (mark !== null) {
          used.add(mark.id);
        }
      }
    }
  }
  return used;
}

function filteredEntries(
  marks: readonly MemberMark[],
  used: ReadonlySet<string>,
): readonly MyMarksEntry[] {
  const thisWeek = marks.filter((mark) => used.has(mark.id));
  if (thisWeek.length === 0) {
    return marks
      .slice(0, FALLBACK_MARK_COUNT)
      .map((mark) => ({ mark, isThisWeek: false }));
  }
  return thisWeek.map((mark) => ({ mark, isThisWeek: true }));
}

export function myMarksView(input: {
  readonly marks: readonly MemberMark[];
  readonly week: TrainingWeek;
  readonly showAll: boolean;
}): MyMarksView {
  const { marks } = input;
  const counts = {
    setCount: marks.filter((mark) => mark.value !== null).length,
    total: marks.length,
  };
  if (marks.length <= MAX_UNFILTERED_MARKS) {
    return {
      ...counts,
      entries: marks.map((mark) => ({ mark, isThisWeek: false })),
      toggle: "none",
    };
  }
  const used = marksUsedInWeek(input.week);
  const filtered = filteredEntries(marks, used);
  if (filtered.length === marks.length) {
    return { ...counts, entries: filtered, toggle: "none" };
  }
  if (!input.showAll) {
    return { ...counts, entries: filtered, toggle: "showAll" };
  }
  return {
    ...counts,
    entries: marks.map((mark) => ({ mark, isThisWeek: used.has(mark.id) })),
    toggle: "showWeek",
  };
}
