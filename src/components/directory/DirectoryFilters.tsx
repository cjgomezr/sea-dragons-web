"use client";

import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { Icon } from "@/components/Icon";
import type { Role } from "@/lib/auth/roles";
import type { DirectoryFilter } from "@/lib/directory/directory";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import type { MoreFilters } from "./DirectoryFilterFields";
import { DirectoryFilterChips } from "./DirectoryFilterChips";
import { DirectoryMoreFilters } from "./DirectoryMoreFilters";
import type { FilterChoices } from "./use-filter-choices";

/**
 * La barra con la que se recorta el directorio (RF-2 de los PRD de E5 y
 * E21): en una sola fila, la búsqueda por nombre, el control segmentado del
 * rol y el botón Filtros, que abre el resto (#497, #499) en un popover o en
 * la hoja del móvil. Debajo, las fichas de los filtros activos (#548).
 *
 * No filtran nada por su cuenta: dicen qué se pidió y la pantalla vuelve a
 * preguntárselo al servidor, que es quien decide qué puede ver cada rol.
 *
 * El botón del panel lateral del diseño todavía no está: llega con el panel
 * (#550), para no dejar un botón que no hace nada.
 */

/** Qué se está pidiendo. `search` es el texto tal como se escribe, sin asentar
 * todavía: la pantalla es la que decide cuándo eso llega a ser una consulta. */
export type DirectoryFilterState = MoreFilters & {
  readonly search: string;
  readonly role: Role | null;
};

/** El orden del mockup y del ticket: "Todos" primero, que es el estado en el
 * que llega quien abre la pantalla, y después del rol más común al menos. No
 * es el de `ROLES`, que es el de la matriz de permisos del SRD y el que el
 * servidor usa para ordenar la columna: aquí manda a quién se busca más. */
const ROLE_OPTIONS: readonly (Role | null)[] = [
  null,
  "Player",
  "Coach",
  "Committee",
  "Admin",
];

const SEARCH_FIELD_ID = "directorio-buscar";

/** Un radio por opción: el teclado recorre el control con las flechas, como
 * un grupo de radios, y lo que se pinta es el segmento. */
function RoleOption({
  translate,
  role,
  isChosen,
  onChoose,
}: {
  translate: Translator;
  role: Role | null;
  isChosen: boolean;
  onChoose: () => void;
}): React.JSX.Element {
  return (
    <label className="directory-role">
      <input
        type="radio"
        name="directory-role"
        checked={isChosen}
        onChange={onChoose}
      />
      <span>
        {role === null
          ? translate("directory.role.all")
          : translate(`role.${role}`)}
      </span>
    </label>
  );
}

function SearchField({
  translate,
  search,
  onSearch,
}: {
  translate: Translator;
  search: string;
  onSearch: (search: string) => void;
}): React.JSX.Element {
  return (
    <div className="directory-search">
      <label htmlFor={SEARCH_FIELD_ID} className="visually-hidden">
        {translate("directory.search.label")}
      </label>
      <Icon glyph={MagnifyingGlass} />
      <input
        id={SEARCH_FIELD_ID}
        type="search"
        value={search}
        placeholder={translate("directory.search.placeholder")}
        onChange={(event) => onSearch(event.target.value)}
      />
    </div>
  );
}

export function DirectoryFilters({
  translate,
  locale,
  filters,
  canIncludeInactive,
  availableFilters,
  choices,
  shownCount,
  onChange,
}: {
  translate: Translator;
  locale: Locale;
  filters: DirectoryFilterState;
  canIncludeInactive: boolean;
  availableFilters: readonly DirectoryFilter[];
  choices: FilterChoices;
  /** Cuántos socios enseña la lista ahora, para el pie del popover. */
  shownCount: number;
  onChange: (filters: DirectoryFilterState) => void;
}): React.JSX.Element {
  const changeMore = (more: MoreFilters): void =>
    onChange({ ...filters, ...more });
  return (
    <div className="directory-filters">
      <div className="directory-toolbar">
        <SearchField
          translate={translate}
          search={filters.search}
          onSearch={(search) => onChange({ ...filters, search })}
        />
        <fieldset className="directory-roles">
          <legend className="visually-hidden">
            {translate("directory.role.legend")}
          </legend>
          <div className="directory-role-options">
            {ROLE_OPTIONS.map((role) => (
              <RoleOption
                key={role ?? "all"}
                translate={translate}
                role={role}
                isChosen={filters.role === role}
                onChoose={() => onChange({ ...filters, role })}
              />
            ))}
          </div>
        </fieldset>
        <DirectoryMoreFilters
          translate={translate}
          locale={locale}
          filters={filters}
          availableFilters={availableFilters}
          canIncludeInactive={canIncludeInactive}
          choices={choices}
          shownCount={shownCount}
          onChange={changeMore}
        />
      </div>
      <DirectoryFilterChips
        translate={translate}
        locale={locale}
        filters={filters}
        choices={choices}
        onChange={changeMore}
      />
    </div>
  );
}
