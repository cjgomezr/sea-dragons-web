"use client";

import { useEffect, useRef, useState } from "react";
import { usePendingAction } from "@/components/groups/use-pending-action";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import {
  type ClubPosition,
  type ClubPositions,
  positionName,
} from "@/lib/club/club-positions";
import type { PositionNamesInput } from "@/lib/club/manage-club-positions";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import {
  type ManagedPositionsRead,
  createManagedPosition,
  describePositionsFailure,
  isPositionsConflict,
  loadManagedPositions,
  renameManagedPosition,
  reorderManagedPositions,
  setManagedPositionArchived,
} from "./club-positions-admin-client";
import {
  ActivePositionItem,
  ArchivedPositionItem,
  FOCUS_KEY_ATTRIBUTE,
  moveFocusKey,
  renameFocusKey,
  type Direction,
} from "./ClubPositionItems";
import {
  type PositionFormOutcome,
  PositionNamesForm,
} from "./PositionNamesForm";

/**
 * Las posiciones del club dentro de su configuración (#300, RF-7 del PRD de
 * E18a). El Admin ve las activas en su orden y las archivadas aparte, y las
 * crea, renombra, reordena, archiva y reactiva.
 *
 * Reordenar se hace con botones de subir y bajar, no arrastrando, para que
 * se pueda con el teclado. Cada movimiento manda la lista entera en el orden
 * nuevo, y el foco se queda en la posición que se movió.
 *
 * Nada cambia en la pantalla hasta que el servidor lo confirma: cada
 * respuesta trae el catálogo tal como quedó, y eso es lo que se pinta.
 */

type LoadState = { readonly kind: "loading" } | ManagedPositionsRead;

/** Una acción de la lista (mover, archivar, reactivar) que falló: se puede
 * repetir tal cual con el botón de reintentar. */
type ListFailure = {
  readonly failure: ApiRequestFailure;
  readonly retry: () => void;
};

type PositionsAction = {
  readonly key: string;
  readonly send: () => Promise<ManagedPositionsRead>;
  /** Lo que se anuncia cuando sale bien, con el catálogo que quedó. */
  readonly describeDone: (positions: ClubPositions) => string;
};

const TITLE_ID = "club-posiciones";
const ACTIVE_TITLE_ID = "club-posiciones-activas";
const ARCHIVED_TITLE_ID = "club-posiciones-archivadas";
const CREATE_TITLE_ID = "club-posiciones-nueva";
const CREATE_ACTION = "create";

const EMPTY_NAMES: PositionNamesInput = { en: null, es: null };

function activeOf(positions: ClubPositions): ClubPositions {
  return positions.filter((position) => !position.isArchived);
}

/** Las activas con `positionId` cambiada de sitio con su vecina. */
function movedOrder(
  active: ClubPositions,
  positionId: string,
  direction: Direction,
): readonly string[] {
  const ids = active.map((position) => position.id);
  const from = ids.indexOf(positionId);
  const reordered = ids.filter((id) => id !== positionId);
  reordered.splice(direction === "up" ? from - 1 : from + 1, 0, positionId);
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
        {describePositionsFailure(translate, failure)}
      </p>
      <button type="button" className="auth-secondary" onClick={onRetry}>
        {translate("clubSettings.positions.retry")}
      </button>
    </div>
  );
}

/** Si otro Admin cambió las activas, repetir el mismo movimiento no casaría
 * nunca: lo que se ofrece es cargar las últimas. */
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
  const isConflict = isPositionsConflict(listFailure.failure);
  return (
    <div className="club-settings-failure">
      <p className="auth-error" role="alert">
        {describePositionsFailure(translate, listFailure.failure)}
      </p>
      <button
        type="button"
        className="auth-secondary"
        disabled={isBusy}
        onClick={isConflict ? onReload : listFailure.retry}
      >
        {translate(
          isConflict
            ? "clubSettings.positions.reloadLatest"
            : "clubSettings.positions.retry",
        )}
      </button>
    </div>
  );
}

export function ClubPositionsSection({
  locale,
  translate,
}: {
  locale: Locale;
  translate: Translator;
}): React.JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);
  const [listFailure, setListFailure] = useState<ListFailure | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const { pending, run } = usePendingAction<string>();
  const sectionRef = useRef<HTMLElement>(null);
  const focusAfterUpdate = useRef<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    void loadManagedPositions().then((outcome) => {
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
      sectionRef.current
        ?.querySelector<HTMLButtonElement>(`[${FOCUS_KEY_ATTRIBUTE}="${key}"]`)
        ?.focus();
    }
  }, [state, editingId]);

  const nameOf = (position: ClubPosition): string =>
    positionName(position.names, locale);

  function reload(): void {
    setListFailure(null);
    setState({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  /** Lo manda y, si sale bien, pinta el catálogo que devolvió el servidor.
   * Devuelve el resultado para que quien llamó decida dónde enseñar un
   * fallo; `null` es que había otra acción en vuelo. */
  async function send(
    action: PositionsAction,
  ): Promise<ManagedPositionsRead | null> {
    const result = await run(action.key, action.send);
    if (result?.kind === "loaded") {
      setListFailure(null);
      setState(result);
      setAnnouncement(action.describeDone(result.positions));
    }
    return result;
  }

  async function runListAction(action: PositionsAction): Promise<boolean> {
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
    action: PositionsAction,
  ): Promise<PositionFormOutcome> {
    const result = await send(action);
    return result?.kind === "loaded" ? { kind: "done" } : result;
  }

  async function move(
    active: ClubPositions,
    position: ClubPosition,
    direction: Direction,
  ): Promise<void> {
    const isMoved = await runListAction({
      key: moveFocusKey(position.id, direction),
      send: () =>
        reorderManagedPositions(movedOrder(active, position.id, direction)),
      describeDone: (positions) => {
        const nowActive = activeOf(positions);
        return translate("clubSettings.positions.moved", {
          name: nameOf(position),
          rank: nowActive.findIndex(({ id }) => id === position.id) + 1,
          total: nowActive.length,
        });
      },
    });
    if (isMoved) {
      // En la primera o la última, el botón pulsado queda desactivado: el
      // foco pasa al de la otra dirección.
      const newRank = active.indexOf(position) + (direction === "up" ? -1 : 1);
      const isAtEdge = newRank === 0 || newRank === active.length - 1;
      focusAfterUpdate.current = moveFocusKey(
        position.id,
        isAtEdge ? opposite(direction) : direction,
      );
    }
  }

  function setArchived(position: ClubPosition, isArchived: boolean): void {
    void runListAction({
      key: `${position.id}:archive`,
      send: () => setManagedPositionArchived(position.id, isArchived),
      describeDone: () =>
        translate(
          isArchived
            ? "clubSettings.positions.archived"
            : "clubSettings.positions.reactivated",
          { name: nameOf(position) },
        ),
    });
  }

  function closeEditor(positionId: string): void {
    focusAfterUpdate.current = renameFocusKey(positionId);
    setEditingId(null);
  }

  async function rename(
    position: ClubPosition,
    names: PositionNamesInput,
  ): Promise<PositionFormOutcome> {
    const outcome = await runFormAction({
      key: `${position.id}:rename`,
      send: () => renameManagedPosition(position.id, names),
      describeDone: () => translate("clubSettings.positions.renamed"),
    });
    if (outcome?.kind === "done") {
      closeEditor(position.id);
    }
    return outcome;
  }

  function create(names: PositionNamesInput): Promise<PositionFormOutcome> {
    return runFormAction({
      key: CREATE_ACTION,
      send: () => createManagedPosition(names),
      // La nueva va detrás de todas: es la última del catálogo.
      describeDone: (positions) => {
        const created = positions.at(-1);
        return created === undefined
          ? ""
          : translate("clubSettings.positions.created", {
              name: nameOf(created),
            });
      },
    });
  }

  const isBusy = pending !== null;

  function renderActive(active: ClubPositions): React.JSX.Element {
    if (active.length === 0) {
      return (
        <p className="admin-empty">
          {translate("clubSettings.positions.active.empty")}
        </p>
      );
    }
    return (
      <ol className="groups-items" aria-labelledby={ACTIVE_TITLE_ID}>
        {active.map((position, index) => (
          <ActivePositionItem
            key={position.id}
            translate={translate}
            locale={locale}
            position={position}
            rank={index + 1}
            total={active.length}
            isBusy={isBusy}
            isEditing={editingId === position.id}
            onMove={(direction) => void move(active, position, direction)}
            onToggleRename={() =>
              editingId === position.id
                ? closeEditor(position.id)
                : setEditingId(position.id)
            }
            onArchive={() => setArchived(position, true)}
          >
            {editingId === position.id ? (
              <PositionNamesForm
                translate={translate}
                formLabel={translate("clubSettings.positions.rename.label", {
                  name: nameOf(position),
                })}
                submitText={translate("clubSettings.positions.rename.submit")}
                savingText={translate("clubSettings.positions.rename.saving")}
                initialNames={position.names}
                isDisabled={isBusy}
                isSaving={pending === `${position.id}:rename`}
                shouldFocusOnOpen
                onSubmit={(names) => rename(position, names)}
                onCancel={() => closeEditor(position.id)}
              />
            ) : null}
          </ActivePositionItem>
        ))}
      </ol>
    );
  }

  function renderArchived(archived: ClubPositions): React.JSX.Element {
    if (archived.length === 0) {
      return (
        <p className="admin-empty">
          {translate("clubSettings.positions.archived.empty")}
        </p>
      );
    }
    return (
      <ul className="groups-items" aria-labelledby={ARCHIVED_TITLE_ID}>
        {archived.map((position) => (
          <ArchivedPositionItem
            key={position.id}
            translate={translate}
            locale={locale}
            position={position}
            isBusy={isBusy}
            onReactivate={() => setArchived(position, false)}
          />
        ))}
      </ul>
    );
  }

  function renderCatalog(positions: ClubPositions): React.JSX.Element {
    return (
      <>
        <div className="club-positions-group">
          <h3 id={ACTIVE_TITLE_ID}>
            {translate("clubSettings.positions.active.title")}
          </h3>
          {renderActive(activeOf(positions))}
        </div>
        {listFailure === null ? null : (
          <ActionFailure
            translate={translate}
            listFailure={listFailure}
            isBusy={isBusy}
            onReload={reload}
          />
        )}
        <div className="club-positions-group">
          <h3 id={CREATE_TITLE_ID}>
            {translate("clubSettings.positions.create.title")}
          </h3>
          <PositionNamesForm
            translate={translate}
            formLabel={translate("clubSettings.positions.create.title")}
            submitText={translate("clubSettings.positions.create.submit")}
            savingText={translate("clubSettings.positions.create.saving")}
            initialNames={EMPTY_NAMES}
            isDisabled={isBusy}
            isSaving={pending === CREATE_ACTION}
            onSubmit={create}
          />
        </div>
        <div className="club-positions-group">
          <h3 id={ARCHIVED_TITLE_ID}>
            {translate("clubSettings.positions.archived.title")}
          </h3>
          {renderArchived(positions.filter((position) => position.isArchived))}
        </div>
      </>
    );
  }

  return (
    <section
      ref={sectionRef}
      className="auth-fields club-positions"
      aria-labelledby={TITLE_ID}
    >
      <h2 id={TITLE_ID}>{translate("clubSettings.positions.title")}</h2>
      <p className="auth-hint">{translate("clubSettings.positions.lead")}</p>
      {state.kind === "loading" ? (
        <p className="admin-empty">
          {translate("clubSettings.positions.loading")}
        </p>
      ) : null}
      {state.kind === "failed" ? (
        <LoadFailure translate={translate} failure={state} onRetry={reload} />
      ) : null}
      {state.kind === "loaded" ? renderCatalog(state.positions) : null}
      {/* Una región viva sin el rol `status`: la pantalla ya tiene los suyos
          (el guardado del formulario, el del logo), y éste sólo anuncia. */}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
