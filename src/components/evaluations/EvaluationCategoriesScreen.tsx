"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePendingAction } from "@/components/groups/use-pending-action";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import { EVALUATIONS_PATH } from "@/lib/auth/routes";
import type {
  EvaluationCategories,
  EvaluationCategory,
} from "@/lib/evaluations/evaluation-categories";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { type CategoryFormOutcome, CategoryNameForm } from "./CategoryNameForm";
import {
  ActiveCategoryItem,
  type Direction,
  FOCUS_KEY_ATTRIBUTE,
  InactiveCategoryItem,
  moveFocusKey,
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
 * Las categorías de evaluación (#323, RF-3 del PRD de E9). Vive dentro de
 * Evaluaciones y no en la configuración del club (decisión D1): quien evalúa
 * decide qué se mide, y un Coach no entra en la configuración. La frontera ya
 * la reserva a Admin y Coach, porque cuelga de `EVALUATIONS_PATH`.
 *
 * Copia la forma de las posiciones de #300, porque el problema es el mismo:
 * las activas en su orden, el alta y las desactivadas aparte. Reordenar es con
 * botones, para que se pueda con el teclado, y cada movimiento manda la lista
 * entera en el orden nuevo. Nada cambia hasta que el servidor lo confirma:
 * cada respuesta trae el catálogo tal como quedó, y eso es lo que se pinta.
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

const ACTIVE_TITLE_ID = "categorias-activas";
const INACTIVE_TITLE_ID = "categorias-desactivadas";
const CREATE_TITLE_ID = "categorias-nueva";
const CREATE_ACTION = "create";

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

function opposite(direction: Direction): Direction {
  return direction === "up" ? "down" : "up";
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

function Header({ translate }: { translate: Translator }): React.JSX.Element {
  return (
    <header className="evaluation-categories-header">
      <Link href={EVALUATIONS_PATH} className="member-record-back">
        <span aria-hidden="true">←</span>
        {translate("evaluations.categories.back")}
      </Link>
      <h1>{translate("evaluations.categories.title")}</h1>
      <p className="app-lead">{translate("evaluations.categories.lead")}</p>
    </header>
  );
}

export function EvaluationCategoriesScreen({
  locale,
}: {
  locale: Locale;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);
  const [listFailure, setListFailure] = useState<ListFailure | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const { pending, run } = usePendingAction<string>();
  const screenRef = useRef<HTMLDivElement>(null);
  const focusAfterUpdate = useRef<string | null>(null);

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

  // El foco vuelve a su sitio cuando la lista nueva ya está pintada: mientras
  // esperaba, el botón pulsado estaba desactivado y lo había perdido.
  useEffect(() => {
    const key = focusAfterUpdate.current;
    focusAfterUpdate.current = null;
    if (key !== null) {
      screenRef.current
        ?.querySelector<HTMLButtonElement>(`[${FOCUS_KEY_ATTRIBUTE}="${key}"]`)
        ?.focus();
    }
  }, [state, editingId]);

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
  ): Promise<CategoriesRead | null> {
    const result = await run(action.key, action.send);
    if (result?.kind === "loaded") {
      setListFailure(null);
      setState(result);
      setAnnouncement(action.describeDone(result.categories));
    }
    return result;
  }

  async function runListAction(action: CategoriesAction): Promise<boolean> {
    const result = await send(action);
    if (result?.kind === "failed") {
      setListFailure({
        failure: result,
        retry: () => void runListAction(action),
      });
    }
    return result?.kind === "loaded";
  }

  async function runFormAction(
    action: CategoriesAction,
  ): Promise<CategoryFormOutcome> {
    const result = await send(action);
    return result?.kind === "loaded" ? { kind: "done" } : result;
  }

  async function move(
    active: EvaluationCategories,
    category: EvaluationCategory,
    direction: Direction,
  ): Promise<void> {
    const isMoved = await runListAction({
      key: moveFocusKey(category.id, direction),
      send: () => reorderCategories(movedOrder(active, category.id, direction)),
      describeDone: (categories) => {
        const nowActive = activeOf(categories);
        return translate("evaluations.categories.moved", {
          name: category.name,
          rank: nowActive.findIndex(({ id }) => id === category.id) + 1,
          total: nowActive.length,
        });
      },
    });
    if (isMoved) {
      // En la primera o la última, el botón pulsado queda desactivado: el
      // foco pasa al de la otra dirección.
      const newRank = active.indexOf(category) + (direction === "up" ? -1 : 1);
      const isAtEdge = newRank === 0 || newRank === active.length - 1;
      focusAfterUpdate.current = moveFocusKey(
        category.id,
        isAtEdge ? opposite(direction) : direction,
      );
    }
  }

  function setActive(category: EvaluationCategory, isActive: boolean): void {
    void runListAction({
      key: `${category.id}:active`,
      send: () => setCategoryActive(category.id, isActive),
      describeDone: () =>
        translate(
          isActive
            ? "evaluations.categories.reactivated"
            : "evaluations.categories.deactivated",
          { name: category.name },
        ),
    });
  }

  function closeEditor(categoryId: string): void {
    focusAfterUpdate.current = renameFocusKey(categoryId);
    setEditingId(null);
  }

  async function rename(
    category: EvaluationCategory,
    name: string,
  ): Promise<CategoryFormOutcome> {
    const outcome = await runFormAction({
      key: `${category.id}:rename`,
      send: () => renameCategory(category.id, name),
      describeDone: () => translate("evaluations.categories.renamed"),
    });
    if (outcome?.kind === "done") {
      closeEditor(category.id);
    }
    return outcome;
  }

  function create(name: string): Promise<CategoryFormOutcome> {
    return runFormAction({
      key: CREATE_ACTION,
      send: () => createCategory(name),
      describeDone: () => translate("evaluations.categories.created", { name }),
    });
  }

  const isBusy = pending !== null;

  function renderActive(active: EvaluationCategories): React.JSX.Element {
    if (active.length === 0) {
      return (
        <p className="admin-empty">
          {translate("evaluations.categories.active.empty")}
        </p>
      );
    }
    return (
      <ol className="groups-items" aria-labelledby={ACTIVE_TITLE_ID}>
        {active.map((category, index) => (
          <ActiveCategoryItem
            key={category.id}
            translate={translate}
            category={category}
            rank={index + 1}
            total={active.length}
            isBusy={isBusy}
            isEditing={editingId === category.id}
            onMove={(direction) => void move(active, category, direction)}
            onToggleRename={() =>
              editingId === category.id
                ? closeEditor(category.id)
                : setEditingId(category.id)
            }
            onDeactivate={() => setActive(category, false)}
          >
            {editingId === category.id ? (
              <CategoryNameForm
                translate={translate}
                formLabel={translate("evaluations.categories.rename.label", {
                  name: category.name,
                })}
                submitText={translate("evaluations.categories.rename.submit")}
                savingText={translate("evaluations.categories.rename.saving")}
                initialName={category.name}
                isDisabled={isBusy}
                isSaving={pending === `${category.id}:rename`}
                shouldFocusOnOpen
                onSubmit={(name) => rename(category, name)}
                onCancel={() => closeEditor(category.id)}
              />
            ) : null}
          </ActiveCategoryItem>
        ))}
      </ol>
    );
  }

  function renderInactive(inactive: EvaluationCategories): React.JSX.Element {
    if (inactive.length === 0) {
      return (
        <p className="admin-empty">
          {translate("evaluations.categories.inactive.empty")}
        </p>
      );
    }
    return (
      <ul className="groups-items" aria-labelledby={INACTIVE_TITLE_ID}>
        {inactive.map((category) => (
          <InactiveCategoryItem
            key={category.id}
            translate={translate}
            category={category}
            isBusy={isBusy}
            onReactivate={() => setActive(category, true)}
          />
        ))}
      </ul>
    );
  }

  function renderCatalog(categories: EvaluationCategories): React.JSX.Element {
    return (
      <>
        <section
          className="evaluation-categories-group"
          aria-labelledby={ACTIVE_TITLE_ID}
        >
          <h2 id={ACTIVE_TITLE_ID}>
            {translate("evaluations.categories.active.title")}
          </h2>
          {renderActive(activeOf(categories))}
          {listFailure === null ? null : (
            <ActionFailure
              translate={translate}
              listFailure={listFailure}
              isBusy={isBusy}
              onReload={reload}
            />
          )}
        </section>
        <section
          className="evaluation-categories-group"
          aria-labelledby={CREATE_TITLE_ID}
        >
          <h2 id={CREATE_TITLE_ID}>
            {translate("evaluations.categories.create.title")}
          </h2>
          <CategoryNameForm
            translate={translate}
            formLabel={translate("evaluations.categories.create.title")}
            submitText={translate("evaluations.categories.create.submit")}
            savingText={translate("evaluations.categories.create.saving")}
            initialName=""
            isDisabled={isBusy}
            isSaving={pending === CREATE_ACTION}
            onSubmit={create}
          />
        </section>
        <section
          className="evaluation-categories-group"
          aria-labelledby={INACTIVE_TITLE_ID}
        >
          <h2 id={INACTIVE_TITLE_ID}>
            {translate("evaluations.categories.inactive.title")}
          </h2>
          {renderInactive(categories.filter((category) => !category.isActive))}
        </section>
      </>
    );
  }

  return (
    <div ref={screenRef} className="evaluation-categories">
      <Header translate={translate} />
      {state.kind === "loading" ? (
        <p className="admin-empty">
          {translate("evaluations.categories.loading")}
        </p>
      ) : null}
      {state.kind === "failed" ? (
        <LoadFailure translate={translate} failure={state} onRetry={reload} />
      ) : null}
      {state.kind === "loaded" ? renderCatalog(state.categories) : null}
      {/* Sólo anuncia: los avisos que piden algo llevan su propio rol. */}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
