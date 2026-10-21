"use client";

import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { useRef } from "react";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";

const SEARCH_FIELD_ID = "asistencia-buscar";

/**
 * El buscador por nombre de la hoja: con un club de cien socios, encontrar
 * a quien acaba de llegar sin bajar la lista entera. Sólo filtra lo que se
 * ve; lo marcado y lo que se guarda sigue siendo de todos.
 *
 * El ✕ propio sustituye al del navegador, que no se ve igual en todos y no
 * devuelve el foco al campo.
 */
export function AttendanceSearch({
  translate,
  query,
  onQueryChange,
}: {
  readonly translate: Translator;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  function clear(): void {
    onQueryChange("");
    inputRef.current?.focus();
  }

  return (
    <div className="attendance-search">
      <label htmlFor={SEARCH_FIELD_ID} className="visually-hidden">
        {translate("attendance.search.label")}
      </label>
      <Icon glyph={MagnifyingGlass} />
      <input
        ref={inputRef}
        id={SEARCH_FIELD_ID}
        type="search"
        value={query}
        placeholder={translate("attendance.search.label")}
        autoComplete="off"
        onChange={(event) => onQueryChange(event.target.value)}
      />
      {query === "" ? null : (
        <button
          type="button"
          className="attendance-search-clear"
          aria-label={translate("attendance.search.clear")}
          title={translate("attendance.search.clear")}
          onClick={clear}
        >
          <Icon glyph={X} />
        </button>
      )}
    </div>
  );
}
