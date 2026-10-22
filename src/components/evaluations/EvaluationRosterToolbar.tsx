import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { Icon } from "@/components/Icon";
import { type NamedPosition, positionName } from "@/lib/club/club-positions";
import {
  ROSTER_SORTS,
  type RosterFilter,
  type RosterSort,
  type RosterView,
} from "@/lib/evaluations/roster-view";
import type { Translator } from "@/lib/i18n/translator";
import type { EvaluationsLayout } from "./evaluations-layout";

/**
 * La barra de encima de la tabla de jugadores (#818, RF-2 del PRD de E31): el
 * buscador, las fichas Todos y Sin evaluar con su número, la posición y el
 * orden. No guarda nada: cada cambio sale como una vista nueva. En el móvil
 * (#822) el orden lleva nombres cortos para caber junto a las fichas.
 */

const SEARCH_FIELD_ID = "evaluaciones-buscar";
const POSITION_FIELD_ID = "evaluaciones-posicion";
const SORT_FIELD_ID = "evaluaciones-orden";

/** El valor de Todas las posiciones en el selector; un id nunca está vacío. */
const ANY_POSITION_VALUE = "";

function sortLabels(
  translate: Translator,
  layout: EvaluationsLayout,
): Readonly<Record<RosterSort, string>> {
  if (layout === "compact") {
    return {
      name: translate("evaluations.sort.short.name"),
      overall_desc: translate("evaluations.sort.short.overallDesc"),
      overall_asc: translate("evaluations.sort.short.overallAsc"),
      oldest: translate("evaluations.sort.short.oldest"),
    };
  }
  return {
    name: translate("evaluations.sort.name"),
    overall_desc: translate("evaluations.sort.overallDesc"),
    overall_asc: translate("evaluations.sort.overallAsc"),
    oldest: translate("evaluations.sort.oldest"),
  };
}

function isRosterSort(value: string): value is RosterSort {
  return ROSTER_SORTS.some((sort) => sort === value);
}

export type RosterCounts = {
  readonly all: number;
  readonly notEvaluated: number;
};

function FilterChip({
  label,
  count,
  isActive,
  hasWarningDot,
  onPress,
}: {
  readonly label: string;
  readonly count: number;
  readonly isActive: boolean;
  readonly hasWarningDot: boolean;
  readonly onPress: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="evaluations-chip"
      aria-pressed={isActive}
      onClick={onPress}
    >
      {hasWarningDot ? (
        <span className="evaluations-chip-dot" aria-hidden="true" />
      ) : null}
      {label}
      <span className="evaluations-chip-count">{count}</span>
    </button>
  );
}

export function EvaluationRosterToolbar({
  translate,
  view,
  counts,
  positions,
  layout,
  onViewChange,
}: {
  readonly translate: Translator;
  readonly view: RosterView;
  readonly counts: RosterCounts;
  readonly positions: readonly NamedPosition[];
  readonly layout: EvaluationsLayout;
  readonly onViewChange: (view: RosterView) => void;
}): React.JSX.Element {
  const labels = sortLabels(translate, layout);

  function setFilter(filter: RosterFilter): void {
    onViewChange({ ...view, filter });
  }

  function setSort(value: string): void {
    if (isRosterSort(value)) {
      onViewChange({ ...view, sort: value });
    }
  }

  return (
    <div className="evaluations-toolbar">
      <div className="evaluations-search">
        <label htmlFor={SEARCH_FIELD_ID} className="visually-hidden">
          {translate("evaluations.search.label")}
        </label>
        <Icon glyph={MagnifyingGlass} />
        <input
          id={SEARCH_FIELD_ID}
          type="search"
          value={view.search}
          placeholder={translate("evaluations.search.label")}
          autoComplete="off"
          onChange={(event) =>
            onViewChange({ ...view, search: event.target.value })
          }
        />
      </div>
      <div
        className="evaluations-chips"
        role="group"
        aria-label={translate("evaluations.filter.label")}
      >
        <FilterChip
          label={translate("evaluations.filter.all")}
          count={counts.all}
          isActive={view.filter === "all"}
          hasWarningDot={false}
          onPress={() => setFilter("all")}
        />
        <FilterChip
          label={translate("evaluations.filter.notEvaluated")}
          count={counts.notEvaluated}
          isActive={view.filter === "not_evaluated"}
          hasWarningDot
          onPress={() => setFilter("not_evaluated")}
        />
      </div>
      <label htmlFor={POSITION_FIELD_ID} className="visually-hidden">
        {translate("evaluations.position.label")}
      </label>
      <select
        id={POSITION_FIELD_ID}
        className="evaluations-select"
        value={view.positionId ?? ANY_POSITION_VALUE}
        onChange={(event) =>
          onViewChange({
            ...view,
            positionId:
              event.target.value === ANY_POSITION_VALUE
                ? null
                : event.target.value,
          })
        }
      >
        <option value={ANY_POSITION_VALUE}>
          {translate("evaluations.position.all")}
        </option>
        {positions.map((position) => (
          <option key={position.id} value={position.id}>
            {positionName(position.names, translate.locale)}
          </option>
        ))}
      </select>
      <label htmlFor={SORT_FIELD_ID} className="visually-hidden">
        {translate("evaluations.sort.label")}
      </label>
      <select
        id={SORT_FIELD_ID}
        className="evaluations-select"
        value={view.sort}
        onChange={(event) => setSort(event.target.value)}
      >
        {ROSTER_SORTS.map((sort) => (
          <option key={sort} value={sort}>
            {labels[sort]}
          </option>
        ))}
      </select>
    </div>
  );
}
