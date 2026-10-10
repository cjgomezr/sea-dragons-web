"use client";

import { SortAscending } from "@phosphor-icons/react/dist/ssr/SortAscending";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import {
  DIRECTORY_SORTS,
  type DirectoryDirection,
  type DirectorySort,
} from "@/lib/directory/directory";
import type { Translator } from "@/lib/i18n/translator";
import { BottomSheet } from "./BottomSheet";

/**
 * El orden de la lista del móvil (#553, RF-7 del PRD de E21): por debajo de
 * 768px la tabla pierde sus cabeceras, y con ellas los botones que piden el
 * orden. Los sustituye "Orden: {campo} ↑", que abre la hoja "Ordenar por"
 * con los cuatro campos. Desde 768px lo esconde la hoja de estilos y quedan
 * las cabeceras de siempre.
 *
 * Hace lo mismo que una cabecera: un campo nuevo empieza por su sentido, y
 * el activo, tocado otra vez, lo invierte. Lee y escribe el mismo orden, que
 * vive en la pantalla, así que cambiar de ancho no lo pierde. Elegir cierra
 * la hoja, como en el diseño.
 */

export type DirectoryOrder = {
  readonly sort: DirectorySort;
  readonly direction: DirectoryDirection;
};

/** El título de cada columna de la tabla. */
export const SORT_COLUMN_LABELS = {
  name: "directory.column.member",
  role: "directory.column.role",
  position: "directory.column.position",
  attendance: "directory.column.attendance",
} as const satisfies Readonly<Record<DirectorySort, string>>;

/** El nombre de cada campo en la hoja: por lo que se ordena es el nombre, no
 * el miembro. */
const SORT_FIELD_LABELS = {
  ...SORT_COLUMN_LABELS,
  name: "directory.sort.field.name",
} as const satisfies Readonly<Record<DirectorySort, string>>;

/** La flecha del orden es decorativa: el sentido va dicho con palabras en
 * el nombre accesible. */
export const SORT_ARROWS: Readonly<Record<DirectoryDirection, string>> = {
  asc: "↑",
  desc: "↓",
};

function SortOption({
  translate,
  sort,
  order,
  onChoose,
}: {
  translate: Translator;
  sort: DirectorySort;
  order: DirectoryOrder;
  onChoose: () => void;
}): React.JSX.Element {
  const field = translate(SORT_FIELD_LABELS[sort]);
  const isActive = order.sort === sort;
  return (
    <button
      type="button"
      className="directory-sheet-option"
      aria-pressed={isActive}
      aria-label={
        isActive
          ? translate("directory.sort.activeOption", {
              field,
              direction: translate(`directory.sort.spoken.${order.direction}`),
            })
          : undefined
      }
      onClick={onChoose}
    >
      {field}
      {isActive ? (
        <span className="directory-sheet-option-detail" aria-hidden="true">
          {translate(`directory.sort.direction.${order.direction}`)}{" "}
          {SORT_ARROWS[order.direction]}
        </span>
      ) : null}
    </button>
  );
}

export function DirectorySortControl({
  translate,
  order,
  onSort,
}: {
  translate: Translator;
  order: DirectoryOrder;
  /** Lo mismo que pide una cabecera: sólo el campo. */
  onSort: (column: DirectorySort) => void;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const field = translate(SORT_FIELD_LABELS[order.sort]);

  function closeSheet(): void {
    setIsOpen(false);
    openerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className="directory-sort-open"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={translate("directory.sort.openLabel", {
          field,
          direction: translate(`directory.sort.spoken.${order.direction}`),
        })}
        onClick={() => setIsOpen(true)}
      >
        <Icon glyph={SortAscending} />
        {translate("directory.sort.open", { field })}
        <span aria-hidden="true">{SORT_ARROWS[order.direction]}</span>
      </button>
      {isOpen ? (
        <BottomSheet
          title={translate("directory.sort.label")}
          titleClassName="directory-sheet-label"
          onClosed={closeSheet}
        >
          {(close) => (
            <>
              <ul className="directory-sheet-options">
                {DIRECTORY_SORTS.map((sort) => (
                  <li key={sort}>
                    <SortOption
                      translate={translate}
                      sort={sort}
                      order={order}
                      onChoose={() => {
                        onSort(sort);
                        close();
                      }}
                    />
                  </li>
                ))}
              </ul>
              <p className="directory-sheet-hint">
                {translate("directory.sort.hint")}
              </p>
            </>
          )}
        </BottomSheet>
      ) : null}
    </>
  );
}
