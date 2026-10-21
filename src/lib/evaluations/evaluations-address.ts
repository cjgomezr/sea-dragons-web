import {
  DEFAULT_ROSTER_VIEW,
  type RosterFilter,
  type RosterSort,
  type RosterView,
} from "./roster-view";

/**
 * La pestaña, los filtros y el orden de Evaluaciones en la dirección (#818,
 * D8 del PRD de E31), para que recargar o compartir el enlace devuelva la
 * misma tabla. Lo que vale por defecto no se escribe, y un valor que no se
 * conoce se lee como el de por defecto. Los demás parámetros (`?miembro=`)
 * no se tocan.
 */

export const EVALUATIONS_TABS = ["players", "categories"] as const;

export type EvaluationsTab = (typeof EVALUATIONS_TABS)[number];

const TAB_PARAM = "tab";
const CATEGORIES_TAB_VALUE = "categories";
const SEARCH_PARAM = "q";
const FILTER_PARAM = "filtro";
const POSITION_PARAM = "posicion";
const SORT_PARAM = "orden";

const FILTER_VALUES: Readonly<Record<RosterFilter, string | null>> = {
  all: null,
  not_evaluated: "sin-evaluar",
};

const SORT_VALUES: Readonly<Record<RosterSort, string | null>> = {
  name: null,
  overall_desc: "ovr-desc",
  overall_asc: "ovr-asc",
  oldest: "antigua",
};

/** La clave cuyo valor en la dirección es `value`, si alguna lo es. */
function keyForValue<Key extends string>(
  values: Readonly<Record<Key, string | null>>,
  value: string | null,
): Key | null {
  const keys = Object.keys(values) as Key[];
  return keys.find((key) => value !== null && values[key] === value) ?? null;
}

export function readEvaluationsTab(params: URLSearchParams): EvaluationsTab {
  return params.get(TAB_PARAM) === CATEGORIES_TAB_VALUE
    ? "categories"
    : "players";
}

export function readRosterView(params: URLSearchParams): RosterView {
  const positionId = params.get(POSITION_PARAM);
  return {
    search: params.get(SEARCH_PARAM) ?? DEFAULT_ROSTER_VIEW.search,
    filter:
      keyForValue(FILTER_VALUES, params.get(FILTER_PARAM)) ??
      DEFAULT_ROSTER_VIEW.filter,
    positionId: positionId === "" ? null : positionId,
    sort:
      keyForValue(SORT_VALUES, params.get(SORT_PARAM)) ??
      DEFAULT_ROSTER_VIEW.sort,
  };
}

function setOrDelete(
  params: URLSearchParams,
  name: string,
  value: string | null,
): void {
  if (value === null || value === "") {
    params.delete(name);
  } else {
    params.set(name, value);
  }
}

function asSearch(params: URLSearchParams): string {
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

/** La búsqueda de la dirección con `view`; vacía si no queda nada. */
export function searchWithRosterView(
  current: URLSearchParams,
  view: RosterView,
): string {
  const next = new URLSearchParams(current);
  setOrDelete(next, SEARCH_PARAM, view.search);
  setOrDelete(next, FILTER_PARAM, FILTER_VALUES[view.filter]);
  setOrDelete(next, POSITION_PARAM, view.positionId);
  setOrDelete(next, SORT_PARAM, SORT_VALUES[view.sort]);
  return asSearch(next);
}

export function searchWithEvaluationsTab(
  current: URLSearchParams,
  tab: EvaluationsTab,
): string {
  const next = new URLSearchParams(current);
  setOrDelete(
    next,
    TAB_PARAM,
    tab === "categories" ? CATEGORIES_TAB_VALUE : null,
  );
  return asSearch(next);
}
