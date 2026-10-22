"use client";

import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { useEffect, useId, useRef, useState } from "react";
import { SortableList } from "@/components/club/SortableRows";
import { usePendingAction } from "@/components/groups/use-pending-action";
import { useIsPhone } from "@/components/use-is-phone";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import type {
  EvaluationCategories,
  EvaluationCategory,
} from "@/lib/evaluations/evaluation-categories";
import type { Translator } from "@/lib/i18n/translator";
import { type CategoryFormOutcome, CategoryNameForm } from "./CategoryNameForm";
import {
  CategorySheet,
  openSheetFocusKey,
  PhoneAddCategory,
  PhoneCategoryRow,
} from "./EvaluationCategoriesPhone";
import {
  ActiveCategoryRow,
  type Direction,
  FOCUS_KEY_ATTRIBUTE,
  InactiveCategories,
  handleFocusKey,
  renameFocusKey,
} from "./EvaluationCategoryItems";
import {
  type CategoriesRead,
  createCategory,
  describeCategoriesFailure,
  isCategoriesOutdated,
  loadCategories,
  renameCategory,
  reorderCategories,
  setCategoryActive,
} from "./evaluation-categories-client";

/**
 * La pestaña Categorías de Evaluaciones (#821, RF-5 del PRD de E31). Antes
 * era su propia pantalla (#323); ahora `/evaluaciones/categorias` lleva aquí
 * (D1). La gestionan Admin y Coach, como siempre (D2).
 *
 * Es una tabla con la forma de las posiciones del club (#723): cada activa es
 * una fila con su asa, su número, su nombre y sus acciones; la última fila es
 * la de añadir, y las desactivadas van plegadas debajo. El orden se cambia
 * arrastrando por el asa, o con ↑ y ↓ sobre ella (D9); cada movimiento manda
 * la lista entera en el orden nuevo y el foco se queda en el asa.
 *
 * Nada cambia hasta que el servidor lo confirma: cada respuesta trae el
 * catálogo tal como quedó, y eso es lo que se pinta. Entonces sale abajo un
 * aviso corto, además del anuncio. La excepción es soltar una fila
 * arrastrada: se queda donde se soltó mientras el servidor contesta, y si
 * falla vuelve a su sitio.
 *
 * En el móvil (#823, RF-7) la tabla no cabe: cada activa es una fila de una
 * tarjeta que abre una hoja para renombrarla o desactivarla
 * (`EvaluationCategoriesPhone`). Lo que se manda y lo que se anuncia es lo
 * mismo, y también se arrastra.
 */

type LoadState = { readonly kind: "loading" } | CategoriesRead;

/** Una acción de la lista (mover, desactivar, reactivar) que falló: se puede
 * repetir tal cual con el botón de reintentar. */
type ListFailure = {
  readonly failure: ApiRequestFailure;
  readonly retry: () => void;
};

type CategoriesAction = {
  readonly key: string;
  readonly send: () => Promise<CategoriesRead>;
  /** Lo que se anuncia cuando sale bien, con el catálogo que quedó. */
  readonly describeDone: (categories: EvaluationCategories) => string;
};

/** Lo que una fila activa necesita de la lista en la que va. */
type ActiveRowsContext = {
  /** En el orden que se pinta, el soltado si aún no está confirmado. */
  readonly active: EvaluationCategories;
  /** Todas, para avisar del nombre repetido al renombrar. */
  readonly categories: EvaluationCategories;
};

/** El aviso de guardado. Un objeto nuevo en cada guardado para que el
 * temporizador vuelva a empezar aunque el texto se repita. */
type SavedNotice = { readonly text: string };

const CREATE_ACTION = "create";
/** Lo que dura a la vista el aviso de guardado: lo bastante para leerlo, y
 * el anuncio `aria-live` no depende de él. */
const SAVED_NOTICE_MS = 2500;

function activeOf(categories: EvaluationCategories): EvaluationCategories {
  return categories.filter((category) => category.isActive);
}

/** Las activas con `categoryId` cambiada de sitio con su vecina. */
function movedOrder(
  active: EvaluationCategories,
  categoryId: string,
  direction: Direction,
): readonly string[] {
  const ids = active.map((category) => category.id);
  const from = ids.indexOf(categoryId);
  const reordered = ids.filter((id) => id !== categoryId);
  reordered.splice(direction === "up" ? from - 1 : from + 1, 0, categoryId);
  return reordered;
}

function LoadFailure({
  translate,
  failure,
  onRetry,
}: {
  translate: Translator;
  failure: ApiRequestFailure;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="club-settings-failure">
      <p className="auth-error" role="alert">
        {describeCategoriesFailure(translate, failure)}
      </p>
      <button type="button" className="auth-submit" onClick={onRetry}>
        {translate("evaluations.categories.retry")}
      </button>
    </div>
  );
}

/** Si otro cambió el catálogo, repetir lo mismo no casaría nunca: lo que se
 * ofrece es cargar las últimas. */
function ActionFailure({
  translate,
  listFailure,
  isBusy,
  onReload,
}: {
  translate: Translator;
  listFailure: ListFailure;
  isBusy: boolean;
  onReload: () => void;
}): React.JSX.Element {
  const isOutdated = isCategoriesOutdated(listFailure.failure);
  return (
    <div className="club-settings-failure">
      <p className="auth-error" role="alert">
        {describeCategoriesFailure(translate, listFailure.failure)}
      </p>
      <button
        type="button"
        className="admin-secondary"
        disabled={isBusy}
        onClick={isOutdated ? onReload : listFailure.retry}
      >
        {translate(
          isOutdated
            ? "evaluations.categories.reloadLatest"
            : "evaluations.categories.retry",
        )}
      </button>
    </div>
  );
}

/** La cabecera se ve pero no se lee: cada control ya dice de qué es. */
function TableHead({
  translate,
}: {
  translate: Translator;
}): React.JSX.Element {
  return (
    <div
      className="club-positions-row club-positions-table-head"
      aria-hidden="true"
    >
      <span />
      <span>#</span>
      <span>{translate("evaluations.categories.column.category")}</span>
      <span />
    </div>
  );
}

/** Lo que dura el aviso de guardado a la vista. */
function useSavedNotice(): [SavedNotice | null, (text: string) => void] {
  const [notice, setNotice] = useState<SavedNotice | null>(null);
  useEffect(() => {
    if (notice === null) {
      return;
    }
    const timer = setTimeout(() => setNotice(null), SAVED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  return [notice, (text) => setNotice({ text })];
}

export function EvaluationCategoriesManager({
  translate,
  onCategoriesChange,
}: {
  translate: Translator;
  /** Recibe cada catálogo que confirma el servidor, para el número de la
   * pestaña. */
  onCategoriesChange?: (categories: EvaluationCategories) => void;
}): React.JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);
  const [listFailure, setListFailure] = useState<ListFailure | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [notice, showNotice] = useSavedNotice();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const isPhone = useIsPhone();
  /** El orden de las activas que se soltó y el servidor aún no confirma. */
  const [droppedOrder, setDroppedOrder] = useState<EvaluationCategories | null>(
    null,
  );
  const { pending, run } = usePendingAction<string>();
  const tabRef = useRef<HTMLDivElement>(null);
  const focusAfterUpdate = useRef<string | null>(null);
  const handleHintId = useId();

  useEffect(() => {
    let isCurrent = true;
    void loadCategories().then((outcome) => {
      if (isCurrent) {
        setState(outcome);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [reloads]);

  useEffect(() => {
    if (state.kind === "loaded") {
      onCategoriesChange?.(state.categories);
    }
  }, [state, onCategoriesChange]);

  // El foco vuelve a su sitio cuando la lista nueva ya está pintada y no
  // queda nada en vuelo: un control todavía desactivado no acepta el foco.
  useEffect(() => {
    if (pending !== null) {
      return;
    }
    const key = focusAfterUpdate.current;
    focusAfterUpdate.current = null;
    if (key !== null) {
      tabRef.current
        ?.querySelector<HTMLElement>(`[${FOCUS_KEY_ATTRIBUTE}="${key}"]`)
        ?.focus();
    }
  }, [state, editingId, sheetId, listFailure, pending, droppedOrder]);

  function reload(): void {
    setListFailure(null);
    setState({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  /** Lo manda y, si sale bien, pinta el catálogo que devolvió el servidor.
   * Devuelve el resultado para que quien llamó decida dónde enseñar un
   * fallo; `null` es que había otra acción en vuelo. */
  async function send(
    action: CategoriesAction,
    focusKey?: string,
  ): Promise<CategoriesRead | null> {
    const result = await run(action.key, action.send);
    // Antes de pintar la respuesta: si el foco se apunta después, el efecto
    // que lo devuelve puede correr con la lista nueva y no encontrarlo.
    if (result !== null && focusKey !== undefined) {
      focusAfterUpdate.current = focusKey;
    }
    if (result?.kind === "loaded") {
      const done = action.describeDone(result.categories);
      setListFailure(null);
      setState(result);
      setAnnouncement(done);
      showNotice(done);
    }
    return result;
  }

  async function runListAction(
    action: CategoriesAction,
    focusKey?: string,
  ): Promise<void> {
    const result = await send(action, focusKey);
    if (result?.kind === "failed") {
      setListFailure({
        failure: result,
        retry: () => void runListAction(action, focusKey),
      });
    }
  }

  async function runFormAction(
    action: CategoriesAction,
  ): Promise<CategoryFormOutcome> {
    const result = await send(action);
    return result?.kind === "loaded" ? { kind: "done" } : result;
  }

  function reorder(
    category: EvaluationCategory,
    order: readonly string[],
  ): Promise<void> {
    return runListAction(
      {
        key: `${category.id}:move`,
        send: () => reorderCategories(order),
        describeDone: (categories) => {
          const nowActive = activeOf(categories);
          return translate("evaluations.categories.moved", {
            name: category.name,
            rank: nowActive.findIndex(({ id }) => id === category.id) + 1,
            total: nowActive.length,
          });
        },
      },
      handleFocusKey(category.id),
    );
  }

  async function drop(
    category: EvaluationCategory,
    order: EvaluationCategories,
  ): Promise<void> {
    setDroppedOrder(order);
    try {
      await reorder(
        category,
        order.map(({ id }) => id),
      );
    } finally {
      setDroppedOrder(null);
    }
  }

  function activeAction(
    category: EvaluationCategory,
    isActive: boolean,
  ): CategoriesAction {
    return {
      key: `${category.id}:active`,
      send: () => setCategoryActive(category.id, isActive),
      describeDone: () =>
        translate(
          isActive
            ? "evaluations.categories.reactivated"
            : "evaluations.categories.deactivated",
          { name: category.name },
        ),
    };
  }

  function setActive(category: EvaluationCategory, isActive: boolean): void {
    void runListAction(activeAction(category, isActive));
  }

  function closeEditor(categoryId: string): void {
    focusAfterUpdate.current = renameFocusKey(categoryId);
    setEditingId(null);
  }

  function saveName(
    category: EvaluationCategory,
    name: string,
  ): Promise<CategoryFormOutcome> {
    return runFormAction({
      key: `${category.id}:rename`,
      send: () => renameCategory(category.id, name),
      describeDone: () => translate("evaluations.categories.renamed"),
    });
  }

  async function rename(
    category: EvaluationCategory,
    name: string,
  ): Promise<CategoryFormOutcome> {
    const outcome = await saveName(category, name);
    if (outcome?.kind === "done") {
      closeEditor(category.id);
    }
    return outcome;
  }

  /** El foco vuelve a la fila que la abrió; si se desactivó, ya no está. */
  function closeSheet(categoryId: string): void {
    focusAfterUpdate.current = openSheetFocusKey(categoryId);
    setSheetId(null);
  }

  function create(name: string): Promise<CategoryFormOutcome> {
    return runFormAction({
      key: CREATE_ACTION,
      send: () => createCategory(name),
      describeDone: () => translate("evaluations.categories.created", { name }),
    });
  }

  const isBusy = pending !== null;

  function renderRenameForm(
    category: EvaluationCategory,
    categories: EvaluationCategories,
  ): React.JSX.Element {
    return (
      <CategoryNameForm
        translate={translate}
        formLabel={translate("evaluations.categories.rename.label", {
          name: category.name,
        })}
        fieldLabel={translate("evaluations.categories.rename.field", {
          name: category.name,
        })}
        fieldClassName="evaluation-categories-rename-input"
        initialName={category.name}
        categories={categories}
        renamingId={category.id}
        isDisabled={isBusy}
        shouldFocusOnOpen
        onSubmit={(name) => rename(category, name)}
        onCancel={() => closeEditor(category.id)}
      >
        {(canSubmit) => (
          <div className="club-positions-cell club-positions-actions">
            <button
              type="submit"
              className="club-positions-icon-button club-positions-icon-button-primary"
              aria-label={translate("evaluations.categories.rename.submit")}
              disabled={isBusy || !canSubmit}
            >
              <Check aria-hidden="true" />
            </button>
            <button
              type="button"
              className="club-positions-icon-button"
              aria-label={translate("evaluations.categories.cancel")}
              disabled={isBusy}
              onClick={() => closeEditor(category.id)}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        )}
      </CategoryNameForm>
    );
  }

  function renderTableRow(
    category: EvaluationCategory,
    index: number,
    { active, categories }: ActiveRowsContext,
  ): React.JSX.Element {
    return (
      <ActiveCategoryRow
        key={category.id}
        translate={translate}
        category={category}
        rank={index + 1}
        total={active.length}
        handleHintId={handleHintId}
        isBusy={isBusy}
        renameForm={
          editingId === category.id
            ? renderRenameForm(category, categories)
            : null
        }
        onMove={(direction) =>
          void reorder(category, movedOrder(active, category.id, direction))
        }
        onRename={() => setEditingId(category.id)}
        onDeactivate={() => setActive(category, false)}
      />
    );
  }

  function renderPhoneRow(
    category: EvaluationCategory,
    index: number,
    { active }: ActiveRowsContext,
  ): React.JSX.Element {
    return (
      <PhoneCategoryRow
        key={category.id}
        translate={translate}
        category={category}
        rank={index + 1}
        total={active.length}
        handleHintId={handleHintId}
        onMove={(direction) =>
          void reorder(category, movedOrder(active, category.id, direction))
        }
        onOpen={() => setSheetId(category.id)}
      />
    );
  }

  function renderActive(categories: EvaluationCategories): React.JSX.Element {
    const saved = activeOf(categories);
    const listClassName = isPhone
      ? "club-positions-rows club-positions-phone-card"
      : "club-positions-rows";
    if (saved.length === 0) {
      return (
        <p className={`club-positions-empty ${listClassName}`}>
          {translate("evaluations.categories.active.empty")}
        </p>
      );
    }
    const active = droppedOrder ?? saved;
    const renderRow = isPhone ? renderPhoneRow : renderTableRow;
    return (
      <SortableList
        translate={translate}
        items={active}
        idOf={(category) => category.id}
        describeItem={(category) => category.name}
        isDisabled={isBusy}
        onDrop={(order, moved) => void drop(moved, order)}
      >
        <ol
          className={listClassName}
          aria-label={translate("evaluations.categories.active.title")}
        >
          {active.map((category, index) =>
            renderRow(category, index, { active, categories }),
          )}
        </ol>
      </SortableList>
    );
  }

  /** Se busca entre todas: al desactivarla desde la hoja, sigue abierta hasta
   * que se cierra. */
  function renderSheet(
    categories: EvaluationCategories,
  ): React.JSX.Element | null {
    const category = categories.find(({ id }) => id === sheetId);
    if (category === undefined) {
      return null;
    }
    return (
      <CategorySheet
        key={category.id}
        translate={translate}
        category={category}
        categories={categories}
        isBusy={isBusy}
        onRename={(name) => saveName(category, name)}
        onDeactivate={() => send(activeAction(category, false))}
        onClosed={() => closeSheet(category.id)}
      />
    );
  }

  function renderPhoneList(
    categories: EvaluationCategories,
  ): React.JSX.Element {
    return (
      <>
        {renderActive(categories)}
        <PhoneAddCategory
          translate={translate}
          categories={categories}
          isBusy={isBusy}
          onSubmit={create}
        />
        {renderSheet(categories)}
      </>
    );
  }

  function renderTable(categories: EvaluationCategories): React.JSX.Element {
    return (
      <div className="club-positions-table-scroll">
        <div className="club-positions-table">
          <TableHead translate={translate} />
          {renderActive(categories)}
          {renderAddRow(categories)}
        </div>
      </div>
    );
  }

  function renderAddRow(categories: EvaluationCategories): React.JSX.Element {
    return (
      <div className="club-positions-row club-positions-add-row">
        <span className="club-positions-cell club-positions-add-icon">
          <Plus aria-hidden="true" />
        </span>
        <CategoryNameForm
          translate={translate}
          formLabel={translate("evaluations.categories.create.label")}
          fieldLabel={translate("evaluations.categories.create.label")}
          fieldClassName="evaluation-categories-add-input"
          placeholder={translate("evaluations.categories.create.placeholder")}
          initialName=""
          categories={categories}
          isDisabled={isBusy}
          onSubmit={create}
        >
          {(canSubmit) => (
            <div className="club-positions-cell club-positions-actions">
              <button
                type="submit"
                className="auth-submit club-positions-add-button"
                disabled={isBusy || !canSubmit}
              >
                {translate(
                  pending === CREATE_ACTION
                    ? "evaluations.categories.create.saving"
                    : "evaluations.categories.create.submit",
                )}
              </button>
            </div>
          )}
        </CategoryNameForm>
      </div>
    );
  }

  function renderCatalog(categories: EvaluationCategories): React.JSX.Element {
    return (
      <>
        {isPhone ? renderPhoneList(categories) : renderTable(categories)}
        <p className="visually-hidden" id={handleHintId}>
          {translate("clubSettings.reorder.hint")}
        </p>
        {listFailure === null ? null : (
          <ActionFailure
            translate={translate}
            listFailure={listFailure}
            isBusy={isBusy}
            onReload={reload}
          />
        )}
        <InactiveCategories
          translate={translate}
          inactive={categories.filter((category) => !category.isActive)}
          isBusy={isBusy}
          onReactivate={(category) => setActive(category, true)}
        />
      </>
    );
  }

  return (
    <div ref={tabRef} className="club-positions evaluation-categories">
      <p className="auth-hint evaluation-categories-lead">
        {translate(
          isPhone
            ? "evaluations.categories.phone.hint"
            : "evaluations.categories.lead",
        )}
      </p>
      {state.kind === "loading" ? (
        <p className="admin-empty">
          {translate("evaluations.categories.loading")}
        </p>
      ) : null}
      {state.kind === "failed" ? (
        <LoadFailure translate={translate} failure={state} onRetry={reload} />
      ) : null}
      {state.kind === "loaded" ? renderCatalog(state.categories) : null}
      {/* El aviso se ve pero no se lee: lo que dice ya lo anuncia la región
          viva de abajo. */}
      {notice === null ? null : (
        <p className="club-saved-notice" aria-hidden="true">
          <Check />
          <span>{notice.text}</span>
        </p>
      )}
      {/* Sólo anuncia: los avisos que piden algo llevan su propio rol. */}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
