import { type NamedPosition, positionName } from "@/lib/club/club-positions";
import type { Locale } from "@/lib/i18n/locale";
import { matchesNameSearch } from "@/lib/text/name-search";
import { compareNames } from "@/lib/text/name-order";
import type { EvaluationRosterEntry } from "./evaluation-roster";

/**
 * Lo que enseña la tabla de jugadores de Evaluaciones (#818, RF-2 del PRD de
 * E31): quién pasa la búsqueda, la ficha y la posición, y en qué orden. Se
 * filtra en el navegador porque la lista llega entera: un club tiene decenas
 * de jugadores, no miles (D10).
 */

export type RosterFilter = "all" | "not_evaluated";

export const ROSTER_SORTS = [
  "name",
  "overall_desc",
  "overall_asc",
  "oldest",
] as const;

export type RosterSort = (typeof ROSTER_SORTS)[number];

export type RosterView = {
  readonly search: string;
  readonly filter: RosterFilter;
  /** `null` es Todas las posiciones. */
  readonly positionId: string | null;
  readonly sort: RosterSort;
};

export const DEFAULT_ROSTER_VIEW: RosterView = {
  search: "",
  filter: "all",
  positionId: null,
  sort: "name",
};

type RosterComparator = (
  first: EvaluationRosterEntry,
  second: EvaluationRosterEntry,
) => number;

function byName(
  first: EvaluationRosterEntry,
  second: EvaluationRosterEntry,
): number {
  return compareNames(first.fullName, second.fullName);
}

/** El OVR para ordenar; `null` sin evaluación o sin ninguna nota. */
function overallOf(member: EvaluationRosterEntry): number | null {
  return member.status === "evaluated" ? member.overall : null;
}

/** Los que no tienen nota van al final en los dos sentidos: un hueco no es
 * ni el mejor ni el peor. */
function byOverall(direction: 1 | -1): RosterComparator {
  return (first, second) => {
    const firstOverall = overallOf(first);
    const secondOverall = overallOf(second);
    if (firstOverall === null || secondOverall === null) {
      return (
        Number(firstOverall === null) - Number(secondOverall === null) ||
        byName(first, second)
      );
    }
    return direction * (firstOverall - secondOverall) || byName(first, second);
  };
}

/** Quien nunca se evaluó es lo más antiguo que hay: va primero. */
function updatedTimeOf(member: EvaluationRosterEntry): number {
  return member.status === "evaluated"
    ? Date.parse(member.updatedAt)
    : Number.NEGATIVE_INFINITY;
}

function byOldestEvaluation(
  first: EvaluationRosterEntry,
  second: EvaluationRosterEntry,
): number {
  const firstTime = updatedTimeOf(first);
  const secondTime = updatedTimeOf(second);
  if (firstTime === secondTime) {
    return byName(first, second);
  }
  return firstTime < secondTime ? -1 : 1;
}

const COMPARATORS: Readonly<Record<RosterSort, RosterComparator>> = {
  name: byName,
  overall_desc: byOverall(-1),
  overall_asc: byOverall(1),
  oldest: byOldestEvaluation,
};

function matchesView(member: EvaluationRosterEntry, view: RosterView): boolean {
  if (view.filter === "not_evaluated" && member.status !== "not_evaluated") {
    return false;
  }
  if (view.positionId !== null && member.position?.id !== view.positionId) {
    return false;
  }
  return matchesNameSearch(member.fullName, view.search.trim());
}

export function applyRosterView(
  members: readonly EvaluationRosterEntry[],
  view: RosterView,
): readonly EvaluationRosterEntry[] {
  return members
    .filter((member) => matchesView(member, view))
    .sort(COMPARATORS[view.sort]);
}

export function countNotEvaluated(
  members: readonly EvaluationRosterEntry[],
): number {
  return members.filter((member) => member.status === "not_evaluated").length;
}

/** Las posiciones del selector: las que tiene alguien de la plantilla, una
 * vez cada una. Una posición que nadie tiene sólo daría una tabla vacía. */
export function rosterPositions(
  members: readonly EvaluationRosterEntry[],
  locale: Locale,
): readonly NamedPosition[] {
  const byId = new Map<string, NamedPosition>();
  for (const { position } of members) {
    if (position !== null) {
      byId.set(position.id, position);
    }
  }
  return [...byId.values()].sort((first, second) =>
    compareNames(
      positionName(first.names, locale),
      positionName(second.names, locale),
    ),
  );
}

/** Una posición de la dirección que nadie tiene se lee como Todas: si
 * no, la tabla saldría vacía con el selector diciendo Todas las posiciones. */
export function withHeldPosition(
  view: RosterView,
  positions: readonly NamedPosition[],
): RosterView {
  const isHeld = positions.some(({ id }) => id === view.positionId);
  return view.positionId === null || isHeld
    ? view
    : { ...view, positionId: null };
}

/** El orden no es un filtro: borrar los filtros lo deja como estaba. */
export function clearRosterFilters(view: RosterView): RosterView {
  return { ...DEFAULT_ROSTER_VIEW, sort: view.sort };
}
