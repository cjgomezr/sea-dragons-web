"use client";

import { Archive } from "@phosphor-icons/react/dist/ssr/Archive";
import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { useId, useState } from "react";
import { BottomSheet } from "@/components/directory/BottomSheet";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import {
  POSITION_COVERAGES,
  type PositionCoverage,
  positionName,
} from "@/lib/club/club-positions";
import type {
  ManagedPosition,
  PositionNamesInput,
} from "@/lib/club/manage-club-positions";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import {
  type ManagedPositionsRead,
  describePositionsFailure,
  isPositionsConflict,
} from "./club-positions-admin-client";
import {
  type Direction,
  describeMissingName,
  missingNameLocale,
  ReorderHandle,
} from "./ClubPositionItems";
import { describeCoverage } from "./PositionCoverageControl";
import { useSortableRow } from "./SortableRows";
import {
  type PositionFormOutcome,
  PositionNamesForm,
} from "./PositionNamesForm";

/**
 * Las posiciones en el móvil (#724, RF-6 del PRD de E26; "08-mobile-positions"
 * y "09-mobile-position-sheet" del handoff). La tabla no cabe: cada activa es
 * una fila con su asa, su nombre y, debajo, su rol y el nombre que le falte.
 * Tocarla fuera del asa sube una hoja con los dos nombres, el rol, Archivar y
 * Guardar. Lo que se manda y cómo se anuncia es lo de la tabla de escritorio:
 * lo pone `ClubPositionsSection`.
 *
 * La hoja no cambia nada hasta Guardar. Cerrarla de cualquier otra forma
 * (Escape, un toque fuera, arrastrarla) deja todo como estaba.
 */

/** Lo que tenía la hoja al guardarla. */
export type PositionSheetChanges = {
  readonly names: PositionNamesInput;
  readonly coverage: PositionCoverage | null;
};

/** El valor de "Sin rol": un radio sólo habla en textos. */
const NO_COVERAGE = "none";

const COVERAGE_OPTIONS = [null, ...POSITION_COVERAGES] as const;

export function openSheetFocusKey(positionId: string): string {
  return `${positionId}:open`;
}

export function PhonePositionRow({
  translate,
  locale,
  position,
  rank,
  total,
  handleHintId,
  onMove,
  onOpen,
}: {
  translate: Translator;
  locale: Locale;
  position: ManagedPosition;
  /** Empieza en 1. */
  rank: number;
  total: number;
  handleHintId: string;
  onMove: (direction: Direction) => void;
  onOpen: () => void;
}): React.JSX.Element {
  const nameId = useId();
  const detailId = useId();
  const name = positionName(position.names, locale);
  const missing = missingNameLocale(position, locale);
  const { setRowNode, rowClassName, rowStyle, setHandleNode, handleListeners } =
    useSortableRow(position.id);
  return (
    <li
      ref={setRowNode}
      className={`club-positions-phone-row ${rowClassName}`.trimEnd()}
      style={rowStyle}
    >
      <ReorderHandle
        translate={translate}
        positionId={position.id}
        name={name}
        rank={rank}
        total={total}
        hintId={handleHintId}
        setHandleNode={setHandleNode}
        handleListeners={handleListeners}
        onMove={onMove}
      />
      <button
        type="button"
        className="club-positions-phone-open"
        data-focus-key={openSheetFocusKey(position.id)}
        aria-labelledby={nameId}
        aria-describedby={detailId}
        aria-haspopup="dialog"
        onClick={onOpen}
      >
        <span className="club-positions-phone-text">
          <span id={nameId} className="club-positions-name">
            {name}
          </span>
          <span id={detailId} className="club-positions-note">
            {describeCoverage(translate, position.coverage)}
            {missing === null ? null : (
              <>
                {" · "}
                <span className="club-positions-note-missing">
                  {describeMissingName(translate, missing)}
                </span>
              </>
            )}
          </span>
        </span>
        <CaretRight className="club-positions-phone-caret" aria-hidden="true" />
      </button>
    </li>
  );
}

/** "Nueva posición" con Añadir, debajo de la lista: un solo campo, el del
 * idioma de la pantalla. El otro nombre se pone después en la hoja. */
export function PhoneAddPosition({
  translate,
  locale,
  isBusy,
  onSubmit,
}: {
  translate: Translator;
  locale: Locale;
  isBusy: boolean;
  onSubmit: (names: PositionNamesInput) => Promise<PositionFormOutcome>;
}): React.JSX.Element {
  const placeholder = translate(
    "clubSettings.positions.phone.createPlaceholder",
  );
  return (
    <div className="club-positions-phone-add">
      <PositionNamesForm
        translate={translate}
        formLabel={translate("clubSettings.positions.create.title")}
        placeholders={{ en: placeholder, es: placeholder }}
        initialNames={{ en: null, es: null }}
        isDisabled={isBusy}
        locales={[locale]}
        onSubmit={onSubmit}
      >
        {(hasName) => (
          <button
            type="submit"
            className="auth-submit club-positions-phone-add-button"
            disabled={isBusy || !hasName}
          >
            {translate("clubSettings.positions.create.submit")}
          </button>
        )}
      </PositionNamesForm>
    </div>
  );
}

/** ROL EN EL REPARTO: los cuatro como radios que se ven como botones, 2×2.
 * El teclado los recorre con las flechas. */
function SheetCoverageOptions({
  translate,
  chosen,
  isBusy,
  onChoose,
}: {
  translate: Translator;
  chosen: PositionCoverage | null;
  isBusy: boolean;
  onChoose: (coverage: PositionCoverage | null) => void;
}): React.JSX.Element {
  const groupName = useId();
  return (
    <fieldset className="club-positions-sheet-coverage" disabled={isBusy}>
      <legend className="directory-sheet-label">
        {translate("clubSettings.positions.column.coverage")}
      </legend>
      <div className="club-positions-sheet-coverage-options">
        {COVERAGE_OPTIONS.map((option) => (
          <label
            key={option ?? NO_COVERAGE}
            className="club-positions-sheet-coverage-option"
          >
            <input
              type="radio"
              name={groupName}
              value={option ?? NO_COVERAGE}
              checked={chosen === option}
              onChange={() => onChoose(option)}
            />
            <span>{describeCoverage(translate, option)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Por qué no se pudo: el de Archivar sale aquí; el de Guardar ya lo enseña
 * el formulario, junto a sus campos. Si otro Admin cambió las posiciones,
 * repetir no casaría nunca: se ofrece cargar las últimas. */
type SheetFailure = {
  readonly from: "save" | "archive";
  readonly failure: ApiRequestFailure;
};

function SheetFailureNotice({
  translate,
  sheetFailure,
  onReloadLatest,
}: {
  translate: Translator;
  sheetFailure: SheetFailure;
  onReloadLatest: () => void;
}): React.JSX.Element | null {
  const isConflict = isPositionsConflict(sheetFailure.failure);
  if (sheetFailure.from === "save" && !isConflict) {
    return null;
  }
  return (
    <div className="club-positions-sheet-failure">
      {sheetFailure.from === "archive" ? (
        <p className="auth-error" role="alert">
          {describePositionsFailure(translate, sheetFailure.failure)}
        </p>
      ) : null}
      {isConflict ? (
        <button
          type="button"
          className="auth-secondary"
          onClick={onReloadLatest}
        >
          {translate("clubSettings.positions.reloadLatest")}
        </button>
      ) : null}
    </div>
  );
}

function SheetBody({
  translate,
  name,
  position,
  isBusy,
  close,
  onSave,
  onArchive,
  onReloadLatest,
}: {
  translate: Translator;
  /** El de la posición en el idioma de la pantalla. */
  name: string;
  position: ManagedPosition;
  isBusy: boolean;
  close: () => void;
  onSave: (changes: PositionSheetChanges) => Promise<PositionFormOutcome>;
  onArchive: () => Promise<ManagedPositionsRead | null>;
  onReloadLatest: () => void;
}): React.JSX.Element {
  const [coverage, setCoverage] = useState(position.coverage);
  const [sheetFailure, setSheetFailure] = useState<SheetFailure | null>(null);

  async function save(names: PositionNamesInput): Promise<PositionFormOutcome> {
    setSheetFailure(null);
    const outcome = await onSave({ names, coverage });
    if (outcome?.kind === "done") {
      close();
    } else if (outcome !== null) {
      setSheetFailure({ from: "save", failure: outcome });
    }
    return outcome;
  }

  async function archive(): Promise<void> {
    setSheetFailure(null);
    const result = await onArchive();
    if (result?.kind === "loaded") {
      close();
    } else if (result !== null) {
      setSheetFailure({ from: "archive", failure: result });
    }
  }

  return (
    <PositionNamesForm
      translate={translate}
      formLabel={translate("clubSettings.positions.rename.label", {
        name,
      })}
      placeholders={{
        en: translate("clubSettings.positions.name.placeholder.en"),
        es: translate("clubSettings.positions.name.placeholder.es"),
      }}
      visibleLabels={{
        en: translate("clubSettings.positions.sheet.name.en"),
        es: translate("clubSettings.positions.sheet.name.es"),
      }}
      initialNames={position.names}
      isDisabled={isBusy}
      onSubmit={save}
    >
      {() => (
        <>
          <SheetCoverageOptions
            translate={translate}
            chosen={coverage}
            isBusy={isBusy}
            onChoose={setCoverage}
          />
          {sheetFailure === null ? null : (
            <SheetFailureNotice
              translate={translate}
              sheetFailure={sheetFailure}
              onReloadLatest={() => {
                close();
                onReloadLatest();
              }}
            />
          )}
          <div className="club-positions-sheet-actions">
            <button
              type="button"
              className="auth-secondary club-positions-sheet-archive"
              disabled={isBusy}
              onClick={() => void archive()}
            >
              <Archive aria-hidden="true" />
              {translate("clubSettings.positions.archive")}
            </button>
            <button
              type="submit"
              className="auth-submit club-positions-sheet-save"
              disabled={isBusy}
            >
              {translate("clubSettings.positions.sheet.save")}
            </button>
          </div>
        </>
      )}
    </PositionNamesForm>
  );
}

export function PositionSheet({
  translate,
  locale,
  position,
  isBusy,
  onSave,
  onArchive,
  onReloadLatest,
  onClosed,
}: {
  translate: Translator;
  locale: Locale;
  position: ManagedPosition;
  isBusy: boolean;
  /** Guarda lo que cambió; `done` cierra la hoja. */
  onSave: (changes: PositionSheetChanges) => Promise<PositionFormOutcome>;
  onArchive: () => Promise<ManagedPositionsRead | null>;
  onReloadLatest: () => void;
  /** Se cierre como se cierre. */
  onClosed: () => void;
}): React.JSX.Element {
  const name = positionName(position.names, locale);
  return (
    <BottomSheet
      title={name}
      gripLabel={translate("clubSettings.positions.sheet.close")}
      onClosed={onClosed}
    >
      {(close) => (
        <div className="club-positions-sheet">
          <SheetBody
            translate={translate}
            name={name}
            position={position}
            isBusy={isBusy}
            close={close}
            onSave={onSave}
            onArchive={onArchive}
            onReloadLatest={onReloadLatest}
          />
        </div>
      )}
    </BottomSheet>
  );
}
