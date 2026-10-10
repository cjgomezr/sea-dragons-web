"use client";

import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { Icon } from "@/components/Icon";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import { describeActiveFilters } from "./DirectoryFilterChips";
import type { DirectoryFilterState } from "./DirectoryFilters";
import type { FilterChoices } from "./use-filter-choices";

/**
 * El directorio cuando nadie coincide (#549, "Empty state" del handoff de
 * E21): el icono de búsqueda, la frase, qué se está pidiendo (el rol, el
 * nombre y cada filtro, como sus fichas) y "Borrar filtros".
 *
 * Sin nada que recortara la lista, un club vacío no tiene filtros que
 * enseñar ni que borrar: queda la frase de siempre.
 */

/** Lo que recorta la lista, en palabras; null si no se recorta nada. El rol
 * va siempre primero, aunque sea "todos", para que la frase diga a quién se
 * buscaba. */
export function describeEmptyCriteria(
  filters: DirectoryFilterState,
  context: {
    readonly translate: Translator;
    readonly locale: Locale;
    readonly choices: FilterChoices;
  },
): readonly string[] | null {
  const { translate } = context;
  const search = filters.search.trim();
  const narrowing = [
    ...(search === ""
      ? []
      : [
          translate("directory.filter.chip", {
            filter: translate("directory.empty.name"),
            value: search,
          }),
        ]),
    ...describeActiveFilters(filters, context),
  ];
  if (filters.role === null && narrowing.length === 0) {
    return null;
  }
  return [
    filters.role === null
      ? translate("directory.empty.allRoles")
      : translate(`role.${filters.role}`),
    ...narrowing,
  ];
}

const CRITERIA_SEPARATOR = " · ";

export function DirectoryEmptyState({
  translate,
  criteria,
  onClear,
}: {
  translate: Translator;
  criteria: readonly string[] | null;
  onClear: () => void;
}): React.JSX.Element {
  if (criteria === null) {
    return (
      <div className="directory-empty">
        <p className="admin-empty">{translate("directory.empty")}</p>
      </div>
    );
  }
  return (
    <div className="directory-empty">
      <span className="directory-empty-icon">
        <Icon glyph={MagnifyingGlass} />
      </span>
      <p className="directory-empty-title">
        {translate("directory.empty.title")}
      </p>
      <p className="directory-empty-criteria">
        {translate("directory.empty.criteria", {
          criteria: criteria.join(CRITERIA_SEPARATOR),
        })}
      </p>
      <button type="button" className="admin-secondary" onClick={onClear}>
        {translate("directory.clearFilters")}
      </button>
    </div>
  );
}
