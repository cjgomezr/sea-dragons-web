"use client";

import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { useEffect, useId, useRef, useState } from "react";
import { usePendingAction } from "@/components/groups/use-pending-action";
import { useIsPhone } from "@/components/use-is-phone";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import {
  type ClubPosition,
  type PositionCoverage,
  positionName,
} from "@/lib/club/club-positions";
import type {
  ManagedPosition,
  ManagedPositions,
  PositionNamesInput,
} from "@/lib/club/manage-club-positions";
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
  setManagedPositionCoverage,
} from "./club-positions-admin-client";
import { SortableList } from "./SortableRows";
import {
  ActivePositionRow,
  ArchivedPositions,
  FOCUS_KEY_ATTRIBUTE,
  handleFocusKey,
  renameFocusKey,
  type Direction,
} from "./ClubPositionItems";
import {
  openSheetFocusKey,
  PhoneAddPosition,
  PhonePositionRow,
  type PositionSheetChanges,
  PositionSheet,
} from "./ClubPositionsPhone";
import {
  coverageFocusKey,
  describeCoverage,
  PositionCoverageControl,
} from "./PositionCoverageControl";
import {
  type PositionFormOutcome,
  PositionNamesForm,
} from "./PositionNamesForm";

/**
 * Las posiciones del club dentro de su configuración (#300, RF-7 del PRD de
 * E18a), en una tabla desde #723 (RF-5 del PRD de E26). Cada activa es una
 * fila con su asa, su número, sus nombres, su función en el auto-balance
 * (#404) y sus acciones; la última fila es la de añadir, y las archivadas van
 * plegadas debajo.
 *
 * Todo se guarda al momento: la función al cambiarla, el orden con ↑ y ↓
 * sobre el asa, y renombrar con ✓ en la misma fila. Cada movimiento manda la
 * lista entera en el orden nuevo, y el foco se queda en el asa.
 *
 * Nada cambia en la pantalla hasta que el servidor lo confirma: cada
 * respuesta trae el catálogo tal como quedó, y eso es lo que se pinta.
 * Entonces sale arriba a la derecha un aviso corto, además del anuncio.
 *
 * La excepción es arrastrar por el asa (#725): la fila se queda donde se
 * soltó mientras el servidor contesta, porque volver a su sitio y saltar
 * después al nuevo parecería un fallo. Si falla, vuelve al orden de antes.
 *
 * En el móvil (#724, RF-6) la tabla no cabe: cada activa es una fila que abre
 * una hoja con sus nombres y su rol (`ClubPositionsPhone`). Lo que se manda y
 * lo que se anuncia es lo mismo, y también se arrastra.
 */

type LoadState = { readonly kind: "loading" } | ManagedPositionsRead;

/** Una acción de la lista (mover, el rol, archivar, reactivar) que falló:
 * se puede repetir tal cual con el botón de reintentar. */
type ListFailure = {
  readonly failure: ApiRequestFailure;
  readonly retry: () => void;
};

type PositionsAction = {
  readonly key: string;
  readonly send: () => Promise<ManagedPositionsRead>;
  /** Lo que se anuncia cuando sale bien, con el catálogo que quedó. */
  readonly describeDone: (positions: ManagedPositions) => string;
};

/** El aviso de guardado. Un objeto nuevo en cada guardado para que el
 * temporizador vuelva a empezar aunque el texto se repita. */
type SavedNotice = { readonly text: string };

const TITLE_ID = "club-posiciones";
const CREATE_ACTION = "create";
/** Lo que dura a la vista el aviso de guardado: lo bastante para leerlo, y
 * el anuncio `aria-live` no depende de él. */
const SAVED_NOTICE_MS = 2500;

const EMPTY_NAMES: PositionNamesInput = { en: null, es: null };

function haveSameNames(
  position: ClubPosition,
  names: PositionNamesInput,
): boolean {
  return position.names.en === names.en && position.names.es === names.es;
}

function activeOf(positions: ManagedPositions): ManagedPositions {
  return positions.filter((position) => !position.isArchived);
}

/** Las activas con `positionId` cambiada de sitio con su vecina. */
function movedOrder(
  active: ManagedPositions,
  positionId: string,
  direction: Direction,
): readonly string[] {
  const ids = active.map((position) => position.id);
  const from = ids.indexOf(positionId);
  const reordered = ids.filter((id) => id !== positionId);
  reordered.splice(direction === "up" ? from - 1 : from + 1, 0, positionId);
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
      <span className="club-positions-rank">#</span>
      <span>{translate("clubSettings.positions.column.position")}</span>
      <span>{translate("clubSettings.positions.column.coverage")}</span>
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
  const [notice, showNotice] = useSavedNotice();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const isPhone = useIsPhone();
  /** El orden de las activas que se soltó y el servidor aún no confirma. */
  const [droppedOrder, setDroppedOrder] = useState<ManagedPositions | null>(
    null,
  );
  const { pending, run } = usePendingAction<string>();
  const sectionRef = useRef<HTMLElement>(null);
  const focusAfterUpdate = useRef<string | null>(null);
  const handleHintId = useId();

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
  // esperaba, el control estaba desactivado, o su fila cambió de sitio, y lo
  // había perdido.
  useEffect(() => {
    const key = focusAfterUpdate.current;
    focusAfterUpdate.current = null;
    if (key !== null) {
      sectionRef.current
        ?.querySelector<HTMLElement>(`[${FOCUS_KEY_ATTRIBUTE}="${key}"]`)
        ?.focus();
    }
  }, [state, editingId, sheetId, listFailure]);

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
      const done = action.describeDone(result.positions);
      setListFailure(null);
      setState(result);
      setAnnouncement(done);
      showNotice(
        isPhone
          ? translate("clubSettings.positions.phone.savedNotice")
          : translate("clubSettings.positions.savedNotice", { change: done }),
      );
    }
    return result;
  }

  /** Al terminar, salga bien o mal, el foco vuelve a `focusKey`. */
  async function runListAction(
    action: PositionsAction,
    focusKey: string | null = null,
  ): Promise<void> {
    const result = await send(action);
    if (result === null) {
      return;
    }
    focusAfterUpdate.current = focusKey;
    if (result.kind === "failed") {
      setListFailure({
        failure: result,
        retry: () => void runListAction(action, focusKey),
      });
    }
  }

  async function runFormAction(
    action: PositionsAction,
  ): Promise<PositionFormOutcome> {
    const result = await send(action);
    return result?.kind === "loaded" ? { kind: "done" } : result;
  }

  function reorder(
    position: ManagedPosition,
    order: readonly string[],
  ): Promise<void> {
    return runListAction(
      {
        key: `${position.id}:move`,
        send: () => reorderManagedPositions(order),
        describeDone: (positions) => {
          const nowActive = activeOf(positions);
          return translate("clubSettings.positions.moved", {
            name: nameOf(position),
            rank: nowActive.findIndex(({ id }) => id === position.id) + 1,
            total: nowActive.length,
          });
        },
      },
      handleFocusKey(position.id),
    );
  }

  function move(
    active: ManagedPositions,
    position: ManagedPosition,
    direction: Direction,
  ): void {
    void reorder(position, movedOrder(active, position.id, direction));
  }

  async function drop(
    position: ManagedPosition,
    order: ManagedPositions,
  ): Promise<void> {
    setDroppedOrder(order);
    try {
      await reorder(
        position,
        order.map(({ id }) => id),
      );
    } finally {
      setDroppedOrder(null);
    }
  }

  function archiveAction(
    position: ClubPosition,
    isArchived: boolean,
  ): PositionsAction {
    return {
      key: `${position.id}:archive`,
      send: () => setManagedPositionArchived(position.id, isArchived),
      describeDone: () =>
        translate(
          isArchived
            ? "clubSettings.positions.archived"
            : "clubSettings.positions.reactivated",
          { name: nameOf(position) },
        ),
    };
  }

  function coverageAction(
    position: ManagedPosition,
    coverage: PositionCoverage | null,
  ): PositionsAction {
    return {
      key: coverageFocusKey(position.id),
      send: () => setManagedPositionCoverage(position.id, coverage),
      describeDone: () =>
        coverage === null
          ? translate("clubSettings.positions.coverage.cleared", {
              name: nameOf(position),
            })
          : translate("clubSettings.positions.coverage.saved", {
              name: nameOf(position),
              coverage: describeCoverage(translate, coverage),
            }),
    };
  }

  function renameAction(
    position: ClubPosition,
    names: PositionNamesInput,
  ): PositionsAction {
    return {
      key: `${position.id}:rename`,
      send: () => renameManagedPosition(position.id, names),
      describeDone: () =>
        translate("clubSettings.positions.renamed", {
          name: positionName(names, locale),
        }),
    };
  }

  function setArchived(position: ClubPosition, isArchived: boolean): void {
    void runListAction(archiveAction(position, isArchived));
  }

  function saveCoverage(
    position: ManagedPosition,
    coverage: PositionCoverage | null,
  ): void {
    void runListAction(
      coverageAction(position, coverage),
      coverageFocusKey(position.id),
    );
  }

  function closeEditor(positionId: string): void {
    focusAfterUpdate.current = renameFocusKey(positionId);
    setEditingId(null);
  }

  async function rename(
    position: ClubPosition,
    names: PositionNamesInput,
  ): Promise<PositionFormOutcome> {
    const outcome = await runFormAction(renameAction(position, names));
    if (outcome?.kind === "done") {
      closeEditor(position.id);
    }
    return outcome;
  }

  /** Lo que cambió en la hoja, uno detrás de otro: si el nombre falla, el rol
   * no sale. Un reintento compara con lo ya guardado y sólo manda lo que
   * falta. */
  async function saveFromSheet(
    position: ManagedPosition,
    { names, coverage }: PositionSheetChanges,
  ): Promise<PositionFormOutcome> {
    if (!haveSameNames(position, names)) {
      const renamed = await runFormAction(renameAction(position, names));
      if (renamed?.kind !== "done") {
        return renamed;
      }
    }
    if (coverage !== position.coverage) {
      return runFormAction(coverageAction(position, coverage));
    }
    return { kind: "done" };
  }

  function closeSheet(positionId: string): void {
    focusAfterUpdate.current = openSheetFocusKey(positionId);
    setSheetId(null);
  }

  function create(names: PositionNamesInput): Promise<PositionFormOutcome> {
    return runFormAction({
      key: CREATE_ACTION,
      send: () => createManagedPosition(names),
      describeDone: () =>
        translate("clubSettings.positions.created", {
          name: positionName(names, locale),
        }),
    });
  }

  const isBusy = pending !== null;

  /** Se monta otra vez cuando cambia la función guardada, y así lo elegido
   * empieza por la del servidor. */
  function renderCoverage(position: ManagedPosition): React.JSX.Element {
    return (
      <PositionCoverageControl
        key={`${position.id}:${position.coverage ?? "none"}`}
        translate={translate}
        positionId={position.id}
        name={nameOf(position)}
        coverage={position.coverage}
        isBusy={isBusy}
        onSave={(coverage) => saveCoverage(position, coverage)}
      />
    );
  }

  function renderRenameForm(position: ManagedPosition): React.JSX.Element {
    return (
      <PositionNamesForm
        translate={translate}
        formLabel={translate("clubSettings.positions.rename.label", {
          name: nameOf(position),
        })}
        placeholders={{
          en: translate("clubSettings.positions.name.placeholder.en"),
          es: translate("clubSettings.positions.name.placeholder.es"),
        }}
        initialNames={position.names}
        isDisabled={isBusy}
        shouldFocusOnOpen
        onSubmit={(names) => rename(position, names)}
      >
        {() => (
          <>
            {renderCoverage(position)}
            <div className="club-positions-cell club-positions-actions">
              <button
                type="submit"
                className="club-positions-icon-button club-positions-icon-button-primary"
                aria-label={translate("clubSettings.positions.rename.submit")}
                disabled={isBusy}
              >
                <Check aria-hidden="true" />
              </button>
              <button
                type="button"
                className="club-positions-icon-button"
                aria-label={translate("clubSettings.positions.cancel")}
                disabled={isBusy}
                onClick={() => closeEditor(position.id)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </PositionNamesForm>
    );
  }

  function renderActive(saved: ManagedPositions): React.JSX.Element {
    if (saved.length === 0) {
      return (
        <p className="club-positions-empty">
          {translate("clubSettings.positions.active.empty")}
        </p>
      );
    }
    const active = droppedOrder ?? saved;
    return (
      <SortableList
        translate={translate}
        items={active}
        idOf={(position) => position.id}
        describeItem={nameOf}
        isDisabled={isBusy}
        onDrop={(order, moved) => void drop(moved, order)}
      >
        {renderActiveRows(active)}
      </SortableList>
    );
  }

  function renderActiveRows(active: ManagedPositions): React.JSX.Element {
    return (
      <ol
        className="club-positions-rows"
        aria-label={translate("clubSettings.positions.active.title")}
      >
        {active.map((position, index) => (
          <ActivePositionRow
            key={position.id}
            translate={translate}
            locale={locale}
            position={position}
            rank={index + 1}
            total={active.length}
            handleHintId={handleHintId}
            isBusy={isBusy}
            coverageControl={renderCoverage(position)}
            renameForm={
              editingId === position.id ? renderRenameForm(position) : null
            }
            onMove={(direction) => move(active, position, direction)}
            onRename={() => setEditingId(position.id)}
            onArchive={() => setArchived(position, true)}
          />
        ))}
      </ol>
    );
  }

  function renderAddRow(): React.JSX.Element {
    return (
      <div className="club-positions-row club-positions-add-row">
        <span className="club-positions-cell club-positions-add-icon">
          <Plus aria-hidden="true" />
        </span>
        <span className="club-positions-cell" />
        <PositionNamesForm
          translate={translate}
          formLabel={translate("clubSettings.positions.create.title")}
          placeholders={{
            en: translate("clubSettings.positions.create.placeholder"),
            es: translate("clubSettings.positions.name.placeholder.es"),
          }}
          initialNames={EMPTY_NAMES}
          isDisabled={isBusy}
          onSubmit={create}
        >
          {(hasName) => (
            <>
              <p className="club-positions-cell club-positions-add-hint">
                {translate("clubSettings.positions.create.hint")}
              </p>
              <div className="club-positions-cell club-positions-actions">
                <button
                  type="submit"
                  className="auth-submit club-positions-add-button"
                  disabled={isBusy || !hasName}
                >
                  {translate(
                    pending === CREATE_ACTION
                      ? "clubSettings.positions.create.saving"
                      : "clubSettings.positions.create.submit",
                  )}
                </button>
              </div>
            </>
          )}
        </PositionNamesForm>
      </div>
    );
  }

  function renderPhoneActive(saved: ManagedPositions): React.JSX.Element {
    if (saved.length === 0) {
      return (
        <p className="club-positions-empty club-positions-phone-card">
          {translate("clubSettings.positions.active.empty")}
        </p>
      );
    }
    const active = droppedOrder ?? saved;
    return (
      <SortableList
        translate={translate}
        items={active}
        idOf={(position) => position.id}
        describeItem={nameOf}
        isDisabled={isBusy}
        onDrop={(order, moved) => void drop(moved, order)}
      >
        <ol
          className="club-positions-rows club-positions-phone-card"
          aria-label={translate("clubSettings.positions.active.title")}
        >
          {active.map((position, index) => (
            <PhonePositionRow
              key={position.id}
              translate={translate}
              locale={locale}
              position={position}
              rank={index + 1}
              total={active.length}
              handleHintId={handleHintId}
              onMove={(direction) => move(active, position, direction)}
              onOpen={() => setSheetId(position.id)}
            />
          ))}
        </ol>
      </SortableList>
    );
  }

  /** Se busca entre todas: al archivarla desde la hoja, sigue abierta hasta
   * que se cierra. */
  function renderSheet(positions: ManagedPositions): React.JSX.Element | null {
    const position = positions.find(({ id }) => id === sheetId);
    if (position === undefined) {
      return null;
    }
    return (
      <PositionSheet
        key={position.id}
        translate={translate}
        locale={locale}
        position={position}
        isBusy={isBusy}
        onSave={(changes) => saveFromSheet(position, changes)}
        onArchive={() => send(archiveAction(position, true))}
        onReloadLatest={reload}
        onClosed={() => closeSheet(position.id)}
      />
    );
  }

  function renderPhoneList(positions: ManagedPositions): React.JSX.Element {
    return (
      <>
        {renderPhoneActive(activeOf(positions))}
        <PhoneAddPosition
          translate={translate}
          locale={locale}
          isBusy={isBusy}
          onSubmit={create}
        />
        {renderSheet(positions)}
      </>
    );
  }

  function renderTable(positions: ManagedPositions): React.JSX.Element {
    return (
      <div className="club-positions-table-scroll">
        <div className="club-positions-table">
          <TableHead translate={translate} />
          {renderActive(activeOf(positions))}
          {renderAddRow()}
        </div>
      </div>
    );
  }

  function renderCatalog(positions: ManagedPositions): React.JSX.Element {
    return (
      <>
        {isPhone ? renderPhoneList(positions) : renderTable(positions)}
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
        <ArchivedPositions
          translate={translate}
          locale={locale}
          archived={positions.filter((position) => position.isArchived)}
          isBusy={isBusy}
          onReactivate={(position) => setArchived(position, false)}
        />
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
      <p className="auth-hint club-positions-lead">
        {translate(
          isPhone
            ? "clubSettings.positions.phone.hint"
            : "clubSettings.positions.lead",
        )}
      </p>
      {state.kind === "loading" ? (
        <p className="admin-empty">
          {translate("clubSettings.positions.loading")}
        </p>
      ) : null}
      {state.kind === "failed" ? (
        <LoadFailure translate={translate} failure={state} onRetry={reload} />
      ) : null}
      {state.kind === "loaded" ? renderCatalog(state.positions) : null}
      {/* El aviso se ve pero no se lee: lo que dice ya lo anuncia la región
          viva de abajo. */}
      {notice === null ? null : (
        <p className="club-positions-notice" aria-hidden="true">
          {notice.text}
        </p>
      )}
      {/* Una región viva sin el rol `status`: la pantalla ya tiene los suyos
          (el guardado del formulario, el del logo), y éste sólo anuncia. */}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
