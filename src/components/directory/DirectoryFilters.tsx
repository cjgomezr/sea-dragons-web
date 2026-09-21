"use client";

import { ROLES, type Role } from "@/lib/auth/roles";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Los controles con los que se recorta el directorio (RF-2 del PRD de E5): la
 * búsqueda por nombre, el filtro por rol y, sólo para un Admin, los socios
 * dados de baja.
 *
 * No filtran nada por su cuenta: dicen qué se pidió y la pantalla vuelve a
 * preguntárselo al servidor, que es quien decide qué puede ver cada rol.
 */

/** Qué se está pidiendo. `search` es el texto tal como se escribe, sin asentar
 * todavía: la pantalla es la que decide cuándo eso llega a ser una consulta. */
export type DirectoryFilterState = {
  readonly search: string;
  readonly role: Role | null;
  readonly includeInactive: boolean;
};

/** "Todos" primero, que es el estado en el que llega quien abre la pantalla. */
const ROLE_OPTIONS: readonly (Role | null)[] = [null, ...ROLES];

const SEARCH_FIELD_ID = "directorio-buscar";
const INACTIVE_FIELD_ID = "directorio-inactivos";

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

export function DirectoryFilters({
  translate,
  filters,
  /** Sólo un Admin puede pedir a los dados de baja (AC-040), y el servidor lo
   * dice al responder la lista. Para el resto el control no existe. */
  canIncludeInactive,
  onChange,
}: {
  translate: Translator;
  filters: DirectoryFilterState;
  canIncludeInactive: boolean;
  onChange: (filters: DirectoryFilterState) => void;
}): React.JSX.Element {
  return (
    <div className="directory-filters">
      <div className="auth-field directory-search">
        <label htmlFor={SEARCH_FIELD_ID}>
          {translate("directory.search.label")}
        </label>
        <input
          id={SEARCH_FIELD_ID}
          type="search"
          value={filters.search}
          placeholder={translate("directory.search.placeholder")}
          onChange={(event) =>
            onChange({ ...filters, search: event.target.value })
          }
        />
      </div>
      <fieldset className="directory-roles">
        <legend>{translate("directory.role.legend")}</legend>
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
      {canIncludeInactive ? (
        <div className="auth-consent directory-inactive">
          <input
            id={INACTIVE_FIELD_ID}
            type="checkbox"
            checked={filters.includeInactive}
            onChange={(event) =>
              onChange({ ...filters, includeInactive: event.target.checked })
            }
          />
          <label htmlFor={INACTIVE_FIELD_ID}>
            {translate("directory.includeInactive")}
          </label>
        </div>
      ) : null}
    </div>
  );
}
