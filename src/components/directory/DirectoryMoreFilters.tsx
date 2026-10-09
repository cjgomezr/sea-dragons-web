"use client";

import { FunnelSimple } from "@phosphor-icons/react/dist/ssr/FunnelSimple";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useDismissal } from "@/components/use-dismissal";
import type { Translator } from "@/lib/i18n/translator";
import {
  CheckFields,
  type FieldsProps,
  NO_MORE_FILTERS,
  SelectFields,
  countActiveFilters,
} from "./DirectoryFilterFields";

/**
 * El botón "Filtros" del directorio, con cuántos hay activos, y lo que abre
 * (#548): desde 768 px, un popover anclado al botón con los campos en una
 * cuadrícula, "Borrar todo" y "Mostrar {n} socios"; por debajo, la hoja que
 * sube desde abajo, como desde #497.
 *
 * Cuál de los dos se decide al pulsar, midiendo la pantalla en ese momento:
 * nada se dibuja antes de saberlo, así que el foco nunca cae en un control
 * escondido por el CSS.
 */

/** El mismo corte que el CSS del directorio entre el móvil y el escritorio. */
const WIDE_SCREEN_QUERY = "(min-width: 768px)";

const FOCUSABLE_SELECTOR = "select, input, button";

type OpenedFilters = "none" | "popover" | "sheet";

/** Lo que recibe el foco al pulsarlo: un campo, un botón, un enlace. */
const PRESS_FOCUSABLE_SELECTOR =
  "input, select, textarea, button, a[href], [tabindex]";

function takesFocus(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(PRESS_FOCUSABLE_SELECTOR) !== null
  );
}

function isWideScreen(): boolean {
  return window.matchMedia(WIDE_SCREEN_QUERY).matches;
}

function focusableIn(panel: HTMLElement | null): readonly HTMLElement[] {
  return panel === null
    ? []
    : [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

/** Tab desde el último control vuelve al primero, y Mayúsculas+Tab desde el
 * primero va al último. El `<dialog>` modal deja inerte la página, pero no
 * impide que el foco salga a la barra del navegador. */
function cycleFocus(
  event: React.KeyboardEvent,
  panel: HTMLElement | null,
): void {
  if (event.key !== "Tab") {
    return;
  }
  const focusable = focusableIn(panel);
  const first = focusable.at(0);
  const last = focusable.at(-1);
  const edge = event.shiftKey ? first : last;
  if (edge === undefined || document.activeElement !== edge) {
    return;
  }
  event.preventDefault();
  (event.shiftKey ? last : first)?.focus();
}

/** La hoja del móvil: un `<dialog>` modal, como el visor de la foto (#355),
 * con lo que comparte con él por `useDismissal`. Cerrarla devuelve el foco
 * al botón que la abrió. */
function FilterSheet({
  fields,
  onClosed,
}: {
  fields: FieldsProps;
  onClosed: () => void;
}): React.JSX.Element {
  const { translate } = fields;
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const focusFirstField = useCallback(() => {
    focusableIn(panelRef.current).at(0)?.focus();
  }, []);

  useEffect(() => {
    dialogRef.current?.showModal();
    focusFirstField();
  }, [focusFirstField]);

  const close = useCallback(() => dialogRef.current?.close(), []);
  const pressOutside = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      close();
    },
    [close],
  );
  const keepFocusInside = useCallback(() => {
    if (dialogRef.current?.open === true) {
      focusFirstField();
    }
  }, [focusFirstField]);
  useDismissal({
    isOpen: true,
    containerRef: panelRef,
    onEscape: close,
    onPressOutside: pressOutside,
    onFocusOutside: keepFocusInside,
  });

  return (
    <dialog
      ref={dialogRef}
      className="directory-sheet"
      aria-labelledby={titleId}
      onClose={onClosed}
      onKeyDown={(event) => cycleFocus(event, panelRef.current)}
    >
      <div ref={panelRef} className="directory-sheet-panel">
        <h2 id={titleId} className="directory-sheet-title">
          {translate("directory.filter.sheetTitle")}
        </h2>
        <div className="directory-sheet-fields">
          <SelectFields {...fields} />
          <CheckFields {...fields} />
        </div>
        <button type="button" className="auth-submit" onClick={close}>
          {translate("directory.filter.apply")}
        </button>
      </div>
    </dialog>
  );
}

/** El popover de escritorio. No es modal: la lista de detrás se rehace con
 * cada cambio y sigue a la vista. Al abrirse, el foco entra en su primer
 * control. */
function FilterPopover({
  fields,
  shownCount,
  onDone,
}: {
  fields: FieldsProps;
  shownCount: number;
  onDone: () => void;
}): React.JSX.Element {
  const { translate, onChange } = fields;
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    focusableIn(panelRef.current).at(0)?.focus();
  }, []);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={translate("directory.filter.sheetTitle")}
      className="directory-popover"
    >
      <div className="directory-popover-grid">
        <SelectFields {...fields} />
      </div>
      <div className="directory-popover-checks">
        <CheckFields {...fields} />
      </div>
      <div className="directory-popover-footer">
        <button
          type="button"
          className="directory-link-button"
          onClick={() => onChange(NO_MORE_FILTERS)}
        >
          {translate("directory.filter.clearAll")}
        </button>
        <button type="button" className="auth-submit" onClick={onDone}>
          {translate("directory.filter.showMembers", { count: shownCount })}
        </button>
      </div>
    </div>
  );
}

function FiltersToggle({
  translate,
  activeCount,
  isExpanded,
  toggleRef,
  onToggle,
}: {
  translate: Translator;
  activeCount: number;
  isExpanded: boolean;
  toggleRef: React.RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      ref={toggleRef}
      type="button"
      className="directory-tool directory-filter-toggle"
      aria-haspopup="dialog"
      aria-expanded={isExpanded}
      aria-label={
        activeCount === 0
          ? undefined
          : translate("directory.filter.toggleActive", { count: activeCount })
      }
      onClick={onToggle}
    >
      <Icon glyph={FunnelSimple} />
      {translate("directory.filter.toggle")}
      {activeCount === 0 ? null : (
        <span className="directory-filter-count" aria-hidden="true">
          {activeCount}
        </span>
      )}
    </button>
  );
}

export function DirectoryMoreFilters({
  shownCount,
  ...fields
}: FieldsProps & {
  /** Cuántos socios enseña la lista ahora: el "Mostrar {n} socios". */
  shownCount: number;
}): React.JSX.Element {
  const [opened, setOpened] = useState<OpenedFilters>("none");
  const toggleRef = useRef<HTMLButtonElement>(null);
  // El botón cuenta como dentro del popover: pulsarlo lo cierra por su
  // `onClick`, no por pulsar fuera, que lo volvería a abrir enseguida.
  const anchorRef = useRef<HTMLDivElement>(null);

  const closeAndRefocus = useCallback(() => {
    setOpened("none");
    toggleRef.current?.focus();
  }, []);
  // Pulsar otro control lo cierra y deja el foco en ese control; pulsar
  // donde no hay ninguno lo devuelve a Filtros, como Escape.
  const pressOutside = useCallback(
    (event: MouseEvent) => {
      if (takesFocus(event.target)) {
        setOpened("none");
        return;
      }
      event.preventDefault();
      closeAndRefocus();
    },
    [closeAndRefocus],
  );
  // Quien sale con el tabulador ya eligió adónde va: se cierra sin moverlo.
  const leave = useCallback(() => setOpened("none"), []);
  useDismissal({
    isOpen: opened === "popover",
    containerRef: anchorRef,
    onEscape: closeAndRefocus,
    onPressOutside: pressOutside,
    onFocusOutside: leave,
  });

  function toggle(): void {
    if (opened === "popover") {
      setOpened("none");
      return;
    }
    setOpened(isWideScreen() ? "popover" : "sheet");
  }

  return (
    <div ref={anchorRef} className="directory-filters-anchor">
      <FiltersToggle
        translate={fields.translate}
        activeCount={countActiveFilters(fields.filters)}
        isExpanded={opened !== "none"}
        toggleRef={toggleRef}
        onToggle={toggle}
      />
      {opened === "popover" ? (
        <FilterPopover
          fields={fields}
          shownCount={shownCount}
          onDone={closeAndRefocus}
        />
      ) : null}
      {opened === "sheet" ? (
        <FilterSheet fields={fields} onClosed={closeAndRefocus} />
      ) : null}
    </div>
  );
}
