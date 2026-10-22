"use client";

import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { EyeSlash } from "@phosphor-icons/react/dist/ssr/EyeSlash";
import { useState } from "react";
import { useSortableRow } from "@/components/club/SortableRows";
import { BottomSheet } from "@/components/directory/BottomSheet";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import type {
  EvaluationCategories,
  EvaluationCategory,
} from "@/lib/evaluations/evaluation-categories";
import type { Translator } from "@/lib/i18n/translator";
import { type CategoryFormOutcome, CategoryNameForm } from "./CategoryNameForm";
import { CategoryHandle, type Direction } from "./EvaluationCategoryItems";
import {
  type CategoriesRead,
  describeCategoriesFailure,
} from "./evaluation-categories-client";

/**
 * Las categorías en el móvil (#823, RF-7 del PRD de E31; "07-mobile-
 * categories" del handoff). La tabla no cabe: cada activa es una fila de una
 * tarjeta con su asa, su número, su nombre y una flecha. Tocarla fuera del
 * asa sube una hoja con el nombre, Desactivar y Guardar. Lo que se manda y
 * cómo se anuncia es lo de la tabla de escritorio: lo pone
 * `EvaluationCategoriesManager`.
 *
 * La hoja no cambia nada hasta Guardar o Desactivar. Cerrarla de cualquier
 * otra forma (Escape, un toque fuera, arrastrarla) deja todo como estaba.
 */

export function openSheetFocusKey(categoryId: string): string {
  return `${categoryId}:open`;
}

export function PhoneCategoryRow({
  translate,
  category,
  rank,
  total,
  handleHintId,
  onMove,
  onOpen,
}: {
  translate: Translator;
  category: EvaluationCategory;
  /** Empieza en 1. */
  rank: number;
  total: number;
  handleHintId: string;
  onMove: (direction: Direction) => void;
  onOpen: () => void;
}): React.JSX.Element {
  const { setRowNode, rowClassName, rowStyle, setHandleNode, handleListeners } =
    useSortableRow(category.id);
  return (
    <li
      ref={setRowNode}
      className={`club-positions-phone-row evaluation-categories-phone-row ${rowClassName}`.trimEnd()}
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
      <span className="evaluation-categories-rank" aria-hidden="true">
        {rank}
      </span>
      <button
        type="button"
        className="club-positions-phone-open"
        data-focus-key={openSheetFocusKey(category.id)}
        aria-haspopup="dialog"
        onClick={onOpen}
      >
        <span className="evaluation-categories-name">{category.name}</span>
        <CaretRight className="club-positions-phone-caret" aria-hidden="true" />
      </button>
    </li>
  );
}

/** "Nueva categoría" con Añadir, debajo de la tarjeta. */
export function PhoneAddCategory({
  translate,
  categories,
  isBusy,
  onSubmit,
}: {
  translate: Translator;
  /** Todas, para avisar del nombre repetido. */
  categories: EvaluationCategories;
  isBusy: boolean;
  onSubmit: (name: string) => Promise<CategoryFormOutcome>;
}): React.JSX.Element {
  return (
    <div className="club-positions-phone-add">
      <CategoryNameForm
        translate={translate}
        formLabel={translate("evaluations.categories.create.label")}
        fieldLabel={translate("evaluations.categories.create.label")}
        fieldClassName="evaluation-categories-phone-input"
        placeholder={translate("evaluations.categories.phone.placeholder")}
        initialName=""
        categories={categories}
        isDisabled={isBusy}
        onSubmit={onSubmit}
      >
        {(canSubmit) => (
          <button
            type="submit"
            className="auth-submit club-positions-phone-add-button"
            disabled={isBusy || !canSubmit}
          >
            {translate("evaluations.categories.create.submit")}
          </button>
        )}
      </CategoryNameForm>
    </div>
  );
}

function SheetBody({
  translate,
  category,
  categories,
  isBusy,
  close,
  onRename,
  onDeactivate,
}: {
  translate: Translator;
  category: EvaluationCategory;
  categories: EvaluationCategories;
  isBusy: boolean;
  close: () => void;
  onRename: (name: string) => Promise<CategoryFormOutcome>;
  onDeactivate: () => Promise<CategoriesRead | null>;
}): React.JSX.Element {
  // El fallo de Guardar lo enseña el formulario, junto a su campo; aquí va
  // sólo el de Desactivar.
  const [deactivateFailure, setDeactivateFailure] =
    useState<ApiRequestFailure | null>(null);

  async function save(name: string): Promise<CategoryFormOutcome> {
    setDeactivateFailure(null);
    const outcome =
      name === category.name
        ? ({ kind: "done" } as const)
        : await onRename(name);
    if (outcome?.kind === "done") {
      close();
    }
    return outcome;
  }

  async function deactivate(): Promise<void> {
    setDeactivateFailure(null);
    const result = await onDeactivate();
    if (result?.kind === "loaded") {
      close();
    } else if (result !== null) {
      setDeactivateFailure(result);
    }
  }

  return (
    <CategoryNameForm
      translate={translate}
      formLabel={translate("evaluations.categories.rename.label", {
        name: category.name,
      })}
      fieldLabel={translate("evaluations.categories.sheet.name")}
      isLabelVisible
      fieldClassName="evaluation-categories-phone-input"
      initialName={category.name}
      categories={categories}
      renamingId={category.id}
      isDisabled={isBusy}
      onSubmit={save}
    >
      {(canSubmit) => (
        <>
          {deactivateFailure === null ? null : (
            <p className="auth-error" role="alert">
              {describeCategoriesFailure(translate, deactivateFailure)}
            </p>
          )}
          <div className="club-positions-sheet-actions">
            <button
              type="button"
              className="auth-secondary club-positions-sheet-archive evaluation-categories-sheet-deactivate"
              disabled={isBusy}
              onClick={() => void deactivate()}
            >
              <EyeSlash aria-hidden="true" />
              {translate("evaluations.categories.sheet.deactivate")}
            </button>
            <button
              type="submit"
              className="auth-submit club-positions-sheet-save"
              disabled={isBusy || !canSubmit}
            >
              {translate("evaluations.categories.sheet.save")}
            </button>
          </div>
        </>
      )}
    </CategoryNameForm>
  );
}

export function CategorySheet({
  translate,
  category,
  categories,
  isBusy,
  onRename,
  onDeactivate,
  onClosed,
}: {
  translate: Translator;
  category: EvaluationCategory;
  /** Todas, para avisar del nombre repetido. */
  categories: EvaluationCategories;
  isBusy: boolean;
  /** Guarda el nombre nuevo; `done` cierra la hoja. */
  onRename: (name: string) => Promise<CategoryFormOutcome>;
  onDeactivate: () => Promise<CategoriesRead | null>;
  /** Se cierre como se cierre. */
  onClosed: () => void;
}): React.JSX.Element {
  return (
    <BottomSheet
      title={category.name}
      gripLabel={translate("evaluations.categories.sheet.close")}
      onClosed={onClosed}
    >
      {(close) => (
        <div className="club-positions-sheet">
          <SheetBody
            translate={translate}
            category={category}
            categories={categories}
            isBusy={isBusy}
            close={close}
            onRename={onRename}
            onDeactivate={onDeactivate}
          />
        </div>
      )}
    </BottomSheet>
  );
}
