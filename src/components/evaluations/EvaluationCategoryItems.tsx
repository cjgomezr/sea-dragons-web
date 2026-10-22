"use client";

import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { DotsSixVertical } from "@phosphor-icons/react/dist/ssr/DotsSixVertical";
import { EyeSlash } from "@phosphor-icons/react/dist/ssr/EyeSlash";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { useId, useState } from "react";
import {
  type SortableRowBinding,
  useSortableRow,
} from "@/components/club/SortableRows";
import type {
  EvaluationCategories,
  EvaluationCategory,
} from "@/lib/evaluations/evaluation-categories";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Las filas de la tabla de categorías (#821, RF-5 del PRD de E31), con la
 * forma de las posiciones del club (#723): una activa tiene su asa, su
 * número, su nombre, Renombrar y Desactivar; las desactivadas van plegadas
 * debajo, sólo con su nombre y Reactivar.
 *
 * El asa reordena con ↑ y ↓, o arrastrándola con ratón o dedo, como las
 * posiciones (#725). Ya no hay botones de subir y bajar (D9).
 */

export type Direction = "up" | "down";

/** Lo que marca un control para que la pestaña le devuelva el foco después
 * de pintar la lista nueva: al esperar la respuesta estaba desactivado, o su
 * fila cambió de sitio, y lo perdió. */
export const FOCUS_KEY_ATTRIBUTE = "data-focus-key";

const DIRECTION_OF_KEY: Readonly<Record<string, Direction>> = {
  ArrowUp: "up",
  ArrowDown: "down",
};

export function handleFocusKey(categoryId: string): string {
  return `${categoryId}:handle`;
}

export function renameFocusKey(categoryId: string): string {
  return `${categoryId}:rename`;
}

function CategoryHandle({
  translate,
  category,
  rank,
  total,
  hintId,
  setHandleNode,
  handleListeners,
  onMove,
}: {
  translate: Translator;
  category: EvaluationCategory;
  rank: number;
  total: number;
  hintId: string;
  setHandleNode: SortableRowBinding["setHandleNode"];
  handleListeners: SortableRowBinding["handleListeners"];
  onMove: (direction: Direction) => void;
}): React.JSX.Element {
  function handleKey(event: React.KeyboardEvent): void {
    const direction = DIRECTION_OF_KEY[event.key];
    if (direction === undefined) {
      return;
    }
    // Las flechas no mueven la página mientras el asa tiene el foco.
    event.preventDefault();
    const isAtEdge = direction === "up" ? rank === 1 : rank === total;
    if (!isAtEdge) {
      onMove(direction);
    }
  }

  return (
    <div className="club-positions-cell">
      <button
        ref={setHandleNode}
        type="button"
        className="club-positions-handle"
        data-focus-key={handleFocusKey(category.id)}
        aria-label={translate("evaluations.categories.handle.label", {
          name: category.name,
          rank,
          total,
        })}
        aria-describedby={hintId}
        title={translate("evaluations.categories.handle.title")}
        {...handleListeners}
        onKeyDown={handleKey}
      >
        <DotsSixVertical aria-hidden="true" />
      </button>
    </div>
  );
}

function RowActions({
  translate,
  category,
  isBusy,
  onRename,
  onDeactivate,
}: {
  translate: Translator;
  category: EvaluationCategory;
  isBusy: boolean;
  onRename: () => void;
  onDeactivate: () => void;
}): React.JSX.Element {
  const { name } = category;
  return (
    <div className="club-positions-cell club-positions-actions">
      <button
        type="button"
        className="club-positions-icon-button"
        data-focus-key={renameFocusKey(category.id)}
        aria-label={translate("evaluations.categories.rename.label", { name })}
        disabled={isBusy}
        onClick={onRename}
      >
        <PencilSimple aria-hidden="true" />
      </button>
      <button
        type="button"
        className="club-positions-icon-button evaluation-categories-deactivate"
        aria-label={translate("evaluations.categories.deactivate.label", {
          name,
        })}
        disabled={isBusy}
        onClick={onDeactivate}
      >
        <EyeSlash aria-hidden="true" />
      </button>
    </div>
  );
}

export function ActiveCategoryRow({
  translate,
  category,
  rank,
  total,
  handleHintId,
  isBusy,
  renameForm,
  onMove,
  onRename,
  onDeactivate,
}: {
  translate: Translator;
  category: EvaluationCategory;
  /** Empieza en 1. */
  rank: number;
  total: number;
  /** El texto que explica cómo se mueve con el asa. */
  handleHintId: string;
  isBusy: boolean;
  /** El formulario de renombrar, que ocupa el nombre y las acciones mientras
   * está abierto. */
  renameForm: React.ReactNode | null;
  onMove: (direction: Direction) => void;
  onRename: () => void;
  onDeactivate: () => void;
}): React.JSX.Element {
  const { setRowNode, rowClassName, rowStyle, setHandleNode, handleListeners } =
    useSortableRow(category.id);
  return (
    <li
      ref={setRowNode}
      className={`club-positions-row ${rowClassName}`.trimEnd()}
      style={rowStyle}
    >
      <CategoryHandle
        translate={translate}
        category={category}
        rank={rank}
        total={total}
        hintId={handleHintId}
        setHandleNode={setHandleNode}
        handleListeners={handleListeners}
        onMove={onMove}
      />
      <span className="club-positions-cell evaluation-categories-rank">
        {rank}
      </span>
      {renameForm ?? (
        <>
          <span className="club-positions-cell evaluation-categories-name">
            {category.name}
          </span>
          <RowActions
            translate={translate}
            category={category}
            isBusy={isBusy}
            onRename={onRename}
            onDeactivate={onDeactivate}
          />
        </>
      )}
    </li>
  );
}

function InactiveCategoryRow({
  translate,
  category,
  isBusy,
  onReactivate,
}: {
  translate: Translator;
  category: EvaluationCategory;
  isBusy: boolean;
  onReactivate: () => void;
}): React.JSX.Element {
  return (
    <li className="club-positions-archived-row">
      <span className="evaluation-categories-name">{category.name}</span>
      <button
        type="button"
        className="admin-secondary"
        aria-label={translate("evaluations.categories.reactivate.label", {
          name: category.name,
        })}
        disabled={isBusy}
        onClick={onReactivate}
      >
        {translate("evaluations.categories.reactivate")}
      </button>
    </li>
  );
}

/** Las desactivadas, plegadas bajo la tabla: salen sólo si hay alguna. */
export function InactiveCategories({
  translate,
  inactive,
  isBusy,
  onReactivate,
}: {
  translate: Translator;
  inactive: EvaluationCategories;
  isBusy: boolean;
  onReactivate: (category: EvaluationCategory) => void;
}): React.JSX.Element | null {
  const [isOpen, setIsOpen] = useState(false);
  const listId = useId();
  if (inactive.length === 0) {
    return null;
  }
  const total = inactive.length;
  return (
    <div className="club-positions-archived">
      <button
        type="button"
        className="club-positions-archived-toggle"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-label={translate("evaluations.categories.inactive.toggle.label", {
          total,
        })}
        onClick={() => setIsOpen((current) => !current)}
      >
        <CaretRight
          className="club-positions-archived-caret"
          aria-hidden="true"
        />
        <span className="club-positions-archived-count">
          {translate("evaluations.categories.inactive.toggle", { total })}
        </span>
        <span className="club-positions-note">
          {translate("evaluations.categories.inactive.note")}
        </span>
      </button>
      {isOpen ? (
        <ul
          id={listId}
          className="club-positions-archived-list"
          aria-label={translate("evaluations.categories.inactive.title")}
        >
          {inactive.map((category) => (
            <InactiveCategoryRow
              key={category.id}
              translate={translate}
              category={category}
              isBusy={isBusy}
              onReactivate={() => onReactivate(category)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
