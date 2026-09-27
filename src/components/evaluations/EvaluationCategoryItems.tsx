"use client";

import type { EvaluationCategory } from "@/lib/evaluations/evaluation-categories";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Una categoría en la pantalla de categorías (#323), con la forma de las
 * posiciones de #300 para que las dos pantallas se parezcan: las activas se
 * mueven, renombran y desactivan; las desactivadas sólo se reactivan.
 *
 * Mover es con botones de subir y bajar, no arrastrando, para que se pueda
 * con el teclado.
 */

export type Direction = "up" | "down";

/** Lo que marca un botón para que la pantalla le devuelva el foco después
 * de pintar la lista nueva: al esperar la respuesta estaba desactivado y lo
 * perdió. */
export const FOCUS_KEY_ATTRIBUTE = "data-focus-key";

export function moveFocusKey(categoryId: string, direction: Direction): string {
  return `${categoryId}:${direction}`;
}

export function renameFocusKey(categoryId: string): string {
  return `${categoryId}:rename`;
}

function CategoryHeading({
  name,
  rank,
}: {
  name: string;
  /** El puesto en el orden, sólo en las activas. */
  rank?: number;
}): React.JSX.Element {
  return (
    <div className="club-positions-head">
      {rank === undefined ? null : (
        <span className="club-positions-rank" aria-hidden="true">
          {rank}
        </span>
      )}
      <h3 className="club-positions-name">{name}</h3>
    </div>
  );
}

export function ActiveCategoryItem({
  translate,
  category,
  rank,
  total,
  isBusy,
  isEditing,
  onMove,
  onToggleRename,
  onDeactivate,
  children,
}: {
  translate: Translator;
  category: EvaluationCategory;
  /** Empieza en 1. */
  rank: number;
  total: number;
  isBusy: boolean;
  isEditing: boolean;
  onMove: (direction: Direction) => void;
  onToggleRename: () => void;
  onDeactivate: () => void;
  /** El formulario de renombrar, cuando está abierto. */
  children?: React.ReactNode;
}): React.JSX.Element {
  const { name } = category;
  const isAtEdge = (direction: Direction): boolean =>
    direction === "up" ? rank === 1 : rank === total;
  const moveButton = (direction: Direction): React.JSX.Element => (
    <button
      type="button"
      className="admin-secondary"
      data-focus-key={moveFocusKey(category.id, direction)}
      aria-label={translate(`evaluations.categories.move.${direction}.label`, {
        name,
      })}
      disabled={isBusy || isAtEdge(direction)}
      onClick={() => onMove(direction)}
    >
      {translate(`evaluations.categories.move.${direction}`)}
    </button>
  );
  return (
    <li className="groups-item club-positions-item">
      <CategoryHeading name={name} rank={rank} />
      <div className="groups-actions">
        {moveButton("up")}
        {moveButton("down")}
        <button
          type="button"
          className="admin-secondary"
          data-focus-key={renameFocusKey(category.id)}
          aria-label={translate("evaluations.categories.rename.label", {
            name,
          })}
          aria-expanded={isEditing}
          disabled={isBusy}
          onClick={onToggleRename}
        >
          {translate("evaluations.categories.rename")}
        </button>
        <button
          type="button"
          className="admin-secondary"
          aria-label={translate("evaluations.categories.deactivate.label", {
            name,
          })}
          disabled={isBusy}
          onClick={onDeactivate}
        >
          {translate("evaluations.categories.deactivate")}
        </button>
      </div>
      {children}
    </li>
  );
}

export function InactiveCategoryItem({
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
    <li className="groups-item club-positions-item">
      <CategoryHeading name={category.name} />
      <div className="groups-actions">
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
      </div>
    </li>
  );
}
