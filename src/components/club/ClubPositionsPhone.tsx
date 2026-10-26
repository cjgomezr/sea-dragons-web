"use client";

import { Archive } from "@phosphor-icons/react/dist/ssr/Archive";
import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { Minus } from "@phosphor-icons/react/dist/ssr/Minus";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { useId, useState } from "react";
import { BottomSheet } from "@/components/directory/BottomSheet";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import { positionName, positionShortName } from "@/lib/club/club-positions";
import {
  type ManagedPosition,
  POSITION_MIN_PER_TEAM_MAX,
  type PositionNamesInput,
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
import { useSortableRow } from "./SortableRows";
import {
  type PositionFormOutcome,
  PositionNamesForm,
} from "./PositionNamesForm";

/**
 * Las posiciones en el móvil (#724, RF-6 del PRD de E26; "08-mobile-positions"
 * y "09-mobile-position-sheet" del handoff). La tabla no cabe: cada activa es
 * una fila con su asa, su nombre y, debajo, su abreviatura, su mínimo por
 * equipo (#887) y el nombre que le falte. Tocarla fuera del asa sube una hoja
 * con los dos nombres y sus abreviaturas, el mínimo, Archivar y Guardar. Lo
 * que se manda y cómo se anuncia es lo de la tabla de escritorio: lo pone
 * `ClubPositionsSection`.
 *
 * La hoja no cambia nada hasta Guardar. Cerrarla de cualquier otra forma
 * (Escape, un toque fuera, arrastrarla) deja todo como estaba.
 */

/** Lo que tenía la hoja al guardarla. */
export type PositionSheetChanges = {
  readonly names: PositionNamesInput;
  readonly shortNames: PositionNamesInput;
  readonly minPerTeam: number;
};

function describeMinimum(translate: Translator, minPerTeam: number): string {
  return minPerTeam === 0
    ? translate("clubSettings.positions.minimum.none")
    : translate("clubSettings.positions.minimum.perTeam", {
        count: minPerTeam,
      });
}

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
            {positionShortName(position, locale).text}
            {" · "}
            {describeMinimum(translate, position.minPerTeam)}
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

/** MÍNIMO POR EQUIPO: un paso a paso (− n +) con botones de 44 px, de 0 a
 * 20. El número se anuncia al cambiar. */
function SheetMinimumStepper({
  translate,
  minPerTeam,
  isBusy,
  onChange,
}: {
  translate: Translator;
  minPerTeam: number;
  isBusy: boolean;
  onChange: (minPerTeam: number) => void;
}): React.JSX.Element {
  const hintId = useId();
  return (
    <fieldset
      className="club-positions-sheet-minimum"
      disabled={isBusy}
      aria-describedby={hintId}
    >
      <legend className="directory-sheet-label">
        {translate("clubSettings.positions.column.minimum")}
      </legend>
      <div className="club-positions-stepper">
        <button
          type="button"
          className="club-positions-stepper-button"
          aria-label={translate("clubSettings.positions.minimum.fewer")}
          disabled={minPerTeam === 0}
          onClick={() => onChange(minPerTeam - 1)}
        >
          <Minus aria-hidden="true" />
        </button>
        <output className="club-positions-stepper-value" aria-live="polite">
          {minPerTeam}
        </output>
        <button
          type="button"
          className="club-positions-stepper-button"
          aria-label={translate("clubSettings.positions.minimum.more")}
          disabled={minPerTeam === POSITION_MIN_PER_TEAM_MAX}
          onClick={() => onChange(minPerTeam + 1)}
        >
          <Plus aria-hidden="true" />
        </button>
      </div>
      <p className="club-positions-sheet-hint" id={hintId}>
        {translate("clubSettings.positions.minimum.hint")}
      </p>
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
  const [minPerTeam, setMinPerTeam] = useState(position.minPerTeam);
  const [sheetFailure, setSheetFailure] = useState<SheetFailure | null>(null);

  async function save(
    names: PositionNamesInput,
    shortNames: PositionNamesInput,
  ): Promise<PositionFormOutcome> {
    setSheetFailure(null);
    const outcome = await onSave({ names, shortNames, minPerTeam });
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
      initialShortNames={position.shortNames}
      isDisabled={isBusy}
      onSubmit={save}
    >
      {() => (
        <>
          <SheetMinimumStepper
            translate={translate}
            minPerTeam={minPerTeam}
            isBusy={isBusy}
            onChange={setMinPerTeam}
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
