"use client";

import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { ListChecks } from "@phosphor-icons/react/dist/ssr/ListChecks";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { useId, useState } from "react";
import { useChangeNotice } from "@/components/groups/use-change-notice";
import { Icon } from "@/components/Icon";
import { useIsPhone } from "@/components/use-is-phone";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";
import type { ManagedCycle } from "@/lib/training/club-cycles";
import type {
  ManagedRoutine,
  RoutineIssueCode,
} from "@/lib/training/club-routines";
import {
  SHARED_ROUTINES_FILTER,
  defaultRoutineFilter,
  routineFilterGroups,
} from "@/lib/training/routine-editor";
import { PlannerRoutineEditor } from "./PlannerRoutineEditor";
import { routineColorStyle } from "./training-format";
import type { PlannerError } from "./use-planner-cycles";
import { EXERCISE_NAME_TAKEN_REASON } from "./use-planner-exercises";
import { type RoutineList, useRoutineList } from "./use-routine-list";

/**
 * La pestaña Rutinas de Planificar (#908, RF-9 y D8 del PRD de E35; §5.1 y
 * §5.2 del handoff): "Routines of" con el activo, los borradores, las
 * compartidas y los archivados aparte, sin "All"; la lista con las
 * compartidas al final, y el editor de la que está abierta. En el móvil, la
 * lista o el editor, uno cada vez.
 */

type RoutinesTabProps = {
  readonly translate: Translator;
  readonly cycles: readonly ManagedCycle[];
  readonly selectedCycleId: string | null;
};

/** Los motivos que se explican; los demás dicen el error general. */
const ERROR_KEYS = {
  name_required: "training.manage.errorRoutineName",
  name_too_long: "training.manage.errorRoutineNameTooLong",
  // Crear un ejercicio desde la fila de añadir (#909).
  [EXERCISE_NAME_TAKEN_REASON]: "training.exercises.errorNameTaken",
} as const satisfies Partial<
  Record<RoutineIssueCode | typeof EXERCISE_NAME_TAKEN_REASON, MessageKey>
>;

type ExplainedReason = keyof typeof ERROR_KEYS;

function isExplained(reason: string | null): reason is ExplainedReason {
  return reason !== null && Object.hasOwn(ERROR_KEYS, reason);
}

function errorMessage(translate: Translator, error: PlannerError): string {
  return translate(
    isExplained(error.reason)
      ? ERROR_KEYS[error.reason]
      : "training.manage.errorSave",
  );
}

function RoutineFilter({
  translate,
  cycles,
  list,
  onChange,
}: {
  readonly translate: Translator;
  readonly cycles: readonly ManagedCycle[];
  readonly list: RoutineList;
  readonly onChange: (filter: string) => void;
}): React.JSX.Element {
  const selectId = useId();
  const { current, archived } = routineFilterGroups(cycles);
  return (
    <div className="training-routine-filter">
      <label htmlFor={selectId}>
        {translate("training.manage.routinesOf")}
      </label>
      <select
        id={selectId}
        value={list.filter}
        onChange={(event) => onChange(event.target.value)}
      >
        {current.map((cycle) => (
          <option key={cycle.id} value={cycle.id}>
            {translate(
              cycle.status === "active"
                ? "training.manage.optionActive"
                : "training.manage.optionDraft",
              { name: cycle.name },
            )}
          </option>
        ))}
        <option value={SHARED_ROUTINES_FILTER}>
          {translate("training.manage.sharedOnly")}
        </option>
        {archived.length === 0 ? null : (
          <optgroup label={translate("training.manage.archivedCycles")}>
            {archived.map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}

function RoutineButton({
  translate,
  routine,
  isSelected,
  isPhone,
  onOpen,
}: {
  readonly translate: Translator;
  readonly routine: ManagedRoutine;
  readonly isSelected: boolean;
  readonly isPhone: boolean;
  readonly onOpen: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="training-routine-item"
      style={routineColorStyle(routine.colorIndex)}
      aria-pressed={isPhone ? undefined : isSelected}
      onClick={onOpen}
    >
      {isPhone ? null : (
        <span className="training-routine-tile" aria-hidden="true">
          <Icon glyph={ListChecks} />
        </span>
      )}
      <span className="training-routine-item-text">
        <span className="training-routine-item-name">{routine.name}</span>
        <span className="training-routine-item-meta">
          {translate("training.manage.routineMeta", {
            count: routine.itemCount,
            used: routine.daysUsed,
          })}
        </span>
      </span>
      {routine.cycleId === null ? (
        <span className="training-routine-shared">
          {translate("training.manage.sharedTag")}
        </span>
      ) : null}
      {isPhone ? (
        <span className="training-routine-caret" aria-hidden="true">
          <Icon glyph={CaretRight} />
        </span>
      ) : null}
    </button>
  );
}

function NewRoutineButton({
  translate,
  list,
  onCreated,
}: {
  readonly translate: Translator;
  readonly list: RoutineList;
  readonly onCreated: () => void;
}): React.JSX.Element {
  const isShared = list.filter === SHARED_ROUTINES_FILTER;
  return (
    <button
      type="button"
      className="training-plan-new-card training-routine-new"
      disabled={list.isCreating}
      onClick={() =>
        void list
          .create(translate("training.manage.newRoutineName"))
          .then((routine) => {
            if (routine !== null) {
              onCreated();
            }
          })
      }
    >
      <Icon glyph={Plus} />
      {translate(
        isShared
          ? "training.manage.newSharedRoutine"
          : "training.manage.newRoutineInCycle",
      )}
    </button>
  );
}

function EmptyRoutines({
  translate,
  isShared,
}: {
  readonly translate: Translator;
  readonly isShared: boolean;
}): React.JSX.Element {
  return (
    <div className="training-empty">
      <p className="training-empty-title">
        {translate("training.manage.noRoutines")}
      </p>
      <p className="admin-empty">
        {translate(
          isShared
            ? "training.manage.noRoutinesShared"
            : "training.manage.noRoutinesCycle",
        )}
      </p>
    </div>
  );
}

function RoutineColumn({
  translate,
  list,
  routines,
  isPhone,
  onOpen,
}: {
  readonly translate: Translator;
  readonly list: RoutineList;
  readonly routines: readonly ManagedRoutine[];
  readonly isPhone: boolean;
  readonly onOpen: () => void;
}): React.JSX.Element {
  return (
    <div className="training-routine-column">
      <ul
        className="training-routine-list"
        aria-label={translate("training.manage.routineList")}
      >
        {routines.map((routine) => (
          <li key={routine.id}>
            <RoutineButton
              translate={translate}
              routine={routine}
              isSelected={routine.id === list.selected?.id}
              isPhone={isPhone}
              onOpen={() => {
                list.select(routine.id);
                onOpen();
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoutineMessages({
  translate,
  notice,
  error,
}: {
  readonly translate: Translator;
  readonly notice: string | null;
  readonly error: PlannerError | null;
}): React.JSX.Element {
  return (
    <>
      <p className="training-plan-notice" role="status">
        {notice}
      </p>
      {error === null ? null : (
        <p className="auth-error" role="alert">
          {errorMessage(translate, error)}
        </p>
      )}
    </>
  );
}

/** La lista y el editor, según el estado de la lista y la pantalla. */
function RoutinesBody({
  translate,
  list,
  phoneEditor,
  onError,
  announce,
}: {
  readonly translate: Translator;
  readonly list: RoutineList;
  readonly phoneEditor: PhoneEditor;
  readonly onError: (error: PlannerError | null) => void;
  readonly announce: (notice: string) => void;
}): React.JSX.Element {
  const { isPhone, isShown, open, close } = phoneEditor;
  const { state, selected } = list;
  if (state.kind === "loading") {
    return (
      <p className="admin-empty">
        {translate("training.manage.routinesLoading")}
      </p>
    );
  }
  if (state.kind === "failed") {
    return (
      <div className="admin-load-failure">
        <p className="auth-error" role="alert">
          {translate("training.manage.routinesFailed")}
        </p>
        <button type="button" className="auth-submit" onClick={list.retry}>
          {translate("training.manage.retry")}
        </button>
      </div>
    );
  }
  const editor =
    selected === null ? null : (
      <PlannerRoutineEditor
        key={selected.id}
        translate={translate}
        routine={selected}
        isPhone={isPhone}
        onSaved={list.replace}
        onDeleted={(routine) => {
          list.remove(routine.id);
          close();
          announce(
            translate("training.manage.routineDeleted", { name: routine.name }),
          );
        }}
        onError={onError}
        onNotice={announce}
        onBack={close}
      />
    );
  if (isShown && editor !== null) {
    return editor;
  }
  const empty = (
    <EmptyRoutines
      translate={translate}
      isShared={list.filter === SHARED_ROUTINES_FILTER}
    />
  );
  // Sin rutinas no queda columna: se crean con el botón de la fila del filtro.
  if (state.routines.length === 0) {
    return empty;
  }
  const column = (
    <RoutineColumn
      translate={translate}
      list={list}
      routines={state.routines}
      isPhone={isPhone}
      onOpen={open}
    />
  );
  if (isPhone) {
    return column;
  }
  return (
    <div className="training-routine-layout">
      {column}
      {editor ?? empty}
    </div>
  );
}

/** En el móvil, la lista o el editor a pantalla completa, uno cada vez. */
type PhoneEditor = {
  readonly isPhone: boolean;
  readonly isShown: boolean;
  readonly open: () => void;
  readonly close: () => void;
};

function usePhoneEditor(list: RoutineList): PhoneEditor {
  const isPhone = useIsPhone();
  const [isOpen, setIsOpen] = useState(false);
  return {
    isPhone,
    isShown: isPhone && isOpen && list.selected !== null,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}

export function PlannerRoutinesTab({
  translate,
  cycles,
  selectedCycleId,
}: RoutinesTabProps): React.JSX.Element {
  const [error, setError] = useState<PlannerError | null>(null);
  const { notice, announce } = useChangeNotice();
  const list = useRoutineList(defaultRoutineFilter(selectedCycleId), setError);
  const phoneEditor = usePhoneEditor(list);
  const canCreate = list.state.kind === "ready" && !phoneEditor.isShown;
  return (
    <>
      <div className="training-routine-filter-row">
        <RoutineFilter
          translate={translate}
          cycles={cycles}
          list={list}
          onChange={(filter) => {
            // Otro filtro es otra lista: en el móvil vuelve a ella, sin editor.
            phoneEditor.close();
            list.changeFilter(filter);
          }}
        />
        <p className="training-routine-filter-hint">
          {translate("training.manage.routinesHint")}
        </p>
        {canCreate ? (
          <NewRoutineButton
            translate={translate}
            list={list}
            onCreated={phoneEditor.open}
          />
        ) : null}
      </div>
      <RoutineMessages translate={translate} notice={notice} error={error} />
      <RoutinesBody
        translate={translate}
        list={list}
        phoneEditor={phoneEditor}
        onError={setError}
        announce={announce}
      />
    </>
  );
}
