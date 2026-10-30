"use client";

import { DotsSixVertical } from "@phosphor-icons/react/dist/ssr/DotsSixVertical";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { useEffect, useRef } from "react";
import {
  SortableList,
  type SortableRowBinding,
  useSortableRow,
} from "@/components/club/SortableRows";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import {
  type EditorRow,
  type ExerciseEditorRow,
  type MoveDirection,
  moveRow,
  parseSets,
} from "@/lib/training/routine-editor";
import { SECTION_TITLE_MAX_LENGTH } from "@/lib/training/routine-items";
import { PlannerRoutineLoad } from "./PlannerRoutineLoad";
import type { RoutineMark } from "./planner-routines-client";
import { SavedTextField } from "./SavedTextField";
import { ExercisePhoto } from "./TrainingExerciseRow";

/**
 * Las filas del editor de rutinas (#908, RF-9 y D9 del PRD de E35; §5.1 y
 * §5.2 del handoff): un ejercicio con su dosis y su carga, o un título de
 * sección. En el escritorio, una fila de la tabla; por debajo, donde la
 * tabla no cabe, una tarjeta.
 * Cada una se arrastra por su asa (dnd-kit, con el dedo tras mantenerlo) o
 * se mueve con ↑ ↓ con el foco en el asa.
 */

const MOVE_KEYS: Readonly<Record<string, MoveDirection>> = {
  ArrowUp: "up",
  ArrowDown: "down",
};

const NON_DIGITS = /\D/g;

type RowsProps = {
  readonly translate: Translator;
  readonly rows: readonly EditorRow[];
  readonly marks: readonly RoutineMark[];
  readonly isCompact: boolean;
  readonly onSave: (rows: readonly EditorRow[]) => void;
};

type RowProps = {
  readonly translate: Translator;
  readonly rank: number;
  readonly total: number;
  readonly isCompact: boolean;
  readonly onMove: (direction: MoveDirection) => void;
  readonly onDelete: () => void;
};

function rowName(row: EditorRow): string {
  return row.kind === "section" ? row.title : row.exercise.name;
}

function handleFocusKey(key: string): string {
  return `handle:${key}`;
}

/** El asa: se arrastra, o mueve la fila con ↑ ↓. */
function RowHandle({
  translate,
  setHandleNode,
  handleListeners,
  rowKey,
  item,
  rank,
  total,
  onMove,
}: {
  readonly translate: Translator;
  readonly setHandleNode: SortableRowBinding["setHandleNode"];
  readonly handleListeners: SortableRowBinding["handleListeners"];
  readonly rowKey: string;
  readonly item: string;
  readonly rank: number;
  readonly total: number;
  readonly onMove: (direction: MoveDirection) => void;
}): React.JSX.Element {
  return (
    <button
      ref={setHandleNode}
      type="button"
      className="training-routine-handle"
      data-focus-key={handleFocusKey(rowKey)}
      aria-label={translate("training.manage.reorderRow", {
        item,
        rank,
        total,
      })}
      {...handleListeners}
      onKeyDown={(event) => {
        const direction = MOVE_KEYS[event.key];
        if (direction === undefined) {
          return;
        }
        event.preventDefault();
        onMove(direction);
      }}
    >
      <Icon glyph={DotsSixVertical} />
    </button>
  );
}

function DeleteRowButton({
  translate,
  item,
  onDelete,
}: {
  readonly translate: Translator;
  readonly item: string;
  readonly onDelete: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="training-routine-delete"
      aria-label={translate("training.manage.deleteRow", { item })}
      onClick={onDelete}
    >
      <Icon glyph={Trash} />
    </button>
  );
}

function SectionRow({
  row,
  onChange,
  ...props
}: RowProps & {
  readonly row: Extract<EditorRow, { kind: "section" }>;
  readonly onChange: (row: EditorRow) => void;
}): React.JSX.Element {
  const { translate } = props;
  const { setRowNode, rowClassName, rowStyle, setHandleNode, handleListeners } =
    useSortableRow(row.key);
  return (
    <li
      ref={setRowNode}
      className={`training-routine-row training-routine-section ${rowClassName}`.trimEnd()}
      style={rowStyle}
    >
      <RowHandle
        {...props}
        setHandleNode={setHandleNode}
        handleListeners={handleListeners}
        rowKey={row.key}
        item={row.title}
      />
      <SavedTextField
        className="training-routine-section-title"
        aria-label={translate("training.manage.sectionTitle")}
        maxLength={SECTION_TITLE_MAX_LENGTH}
        value={row.title}
        onCommit={(text) => {
          const title = text.trim();
          if (title === "") {
            return false;
          }
          onChange({ ...row, title });
          return true;
        }}
      />
      <DeleteRowButton
        translate={translate}
        item={row.title}
        onDelete={props.onDelete}
      />
    </li>
  );
}

/** Vacío es nulo: la fila no lo lleva. */
function optionalText(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/** Series, repeticiones y descanso, con su etiqueta a la vista en la
 * tarjeta. */
function DoseFields({
  translate,
  row,
  isCompact,
  onChange,
}: {
  readonly translate: Translator;
  readonly row: ExerciseEditorRow;
  readonly isCompact: boolean;
  readonly onChange: (row: EditorRow) => void;
}): React.JSX.Element {
  const exercise = row.exercise.name;
  const fields = [
    {
      name: "sets",
      label: translate("training.manage.columnSets"),
      field: (
        <SavedTextField
          inputMode="numeric"
          aria-label={translate("training.manage.setsFor", { exercise })}
          value={row.sets === null ? "" : String(row.sets)}
          sanitize={(text) => text.replace(NON_DIGITS, "")}
          onCommit={(text) => {
            const sets = parseSets(text);
            if (sets.kind === "invalid") {
              return false;
            }
            onChange({ ...row, sets: sets.value });
            return true;
          }}
        />
      ),
    },
    {
      name: "reps",
      label: translate("training.manage.repsLabel"),
      field: (
        <SavedTextField
          aria-label={translate("training.manage.repsFor", { exercise })}
          value={row.reps ?? ""}
          onCommit={(text) => {
            onChange({ ...row, reps: optionalText(text) });
            return true;
          }}
        />
      ),
    },
    {
      name: "rest",
      label: translate("training.manage.columnRest"),
      field: (
        <SavedTextField
          aria-label={translate("training.manage.restFor", { exercise })}
          value={row.rest ?? ""}
          onCommit={(text) => {
            onChange({ ...row, rest: optionalText(text) });
            return true;
          }}
        />
      ),
    },
  ];
  return (
    <>
      {fields.map(({ name, label, field }) =>
        isCompact ? (
          <label key={name} className={`training-routine-dose-${name}`}>
            <span>{label}</span>
            {field}
          </label>
        ) : (
          <span key={name} className={`training-routine-dose-${name}`}>
            {field}
          </span>
        ),
      )}
    </>
  );
}

function NoteField({
  translate,
  row,
  onChange,
}: {
  readonly translate: Translator;
  readonly row: ExerciseEditorRow;
  readonly onChange: (row: EditorRow) => void;
}): React.JSX.Element {
  return (
    <SavedTextField
      className="training-routine-note"
      aria-label={translate("training.manage.noteFor", {
        exercise: row.exercise.name,
      })}
      placeholder={translate("training.manage.notePlaceholder")}
      value={row.note ?? ""}
      onCommit={(text) => {
        onChange({ ...row, note: optionalText(text) });
        return true;
      }}
    />
  );
}

function ExerciseRow({
  row,
  marks,
  onChange,
  ...props
}: RowProps & {
  readonly row: ExerciseEditorRow;
  readonly marks: readonly RoutineMark[];
  readonly onChange: (row: EditorRow) => void;
}): React.JSX.Element {
  const { translate, isCompact } = props;
  const name = row.exercise.name;
  const fieldProps = { translate, row, onChange };
  const { setRowNode, rowClassName, rowStyle, setHandleNode, handleListeners } =
    useSortableRow(row.key);
  return (
    <li
      ref={setRowNode}
      className={`training-routine-row training-routine-exercise ${rowClassName}`.trimEnd()}
      style={rowStyle}
    >
      <RowHandle
        {...props}
        setHandleNode={setHandleNode}
        handleListeners={handleListeners}
        rowKey={row.key}
        item={name}
      />
      <span className="training-routine-exercise-name">
        <span className="training-routine-thumbnail">
          <ExercisePhoto url={row.exercise.photoUrl ?? undefined} alt="" />
        </span>
        <span className="training-routine-name-and-note">
          <span className="training-routine-name">{name}</span>
          {isCompact ? null : <NoteField {...fieldProps} />}
        </span>
      </span>
      <DoseFields {...fieldProps} isCompact={isCompact} />
      <PlannerRoutineLoad
        translate={translate}
        row={row}
        marks={marks}
        onChange={(load) => onChange({ ...row, load })}
      />
      {isCompact ? <NoteField {...fieldProps} /> : null}
      <DeleteRowButton
        translate={translate}
        item={name}
        onDelete={props.onDelete}
      />
    </li>
  );
}

function ColumnHeader({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <div className="training-routine-columns" aria-hidden="true">
      <span />
      <span>{translate("training.manage.columnExercise")}</span>
      <span>{translate("training.manage.columnSets")}</span>
      <span>{translate("training.manage.columnReps")}</span>
      <span>{translate("training.manage.columnRest")}</span>
      <span>{translate("training.manage.columnLoad")}</span>
      <span />
    </div>
  );
}

/** Tras mover con el teclado, el foco vuelve al asa de la fila movida: al
 * cambiar de sitio en la página, el navegador lo suelta. */
function useFocusAfterMove(rows: readonly EditorRow[]): {
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
  readonly focusLater: (rowKey: string) => void;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingKey = useRef<string | null>(null);
  useEffect(() => {
    const key = pendingKey.current;
    pendingKey.current = null;
    if (key !== null) {
      containerRef.current
        ?.querySelector<HTMLElement>(
          `[data-focus-key="${handleFocusKey(key)}"]`,
        )
        ?.focus();
    }
  }, [rows]);
  return {
    containerRef,
    focusLater: (rowKey) => {
      pendingKey.current = rowKey;
    },
  };
}

export function PlannerRoutineRows({
  translate,
  rows,
  marks,
  isCompact,
  onSave,
}: RowsProps): React.JSX.Element {
  const { containerRef, focusLater } = useFocusAfterMove(rows);
  const total = rows.length;

  function rowProps(row: EditorRow, index: number): RowProps {
    return {
      translate,
      rank: index + 1,
      total,
      isCompact,
      onMove: (direction) => {
        const moved = moveRow(rows, index, direction);
        if (moved !== null) {
          focusLater(row.key);
          onSave(moved);
        }
      },
      onDelete: () => onSave(rows.filter((entry) => entry.key !== row.key)),
    };
  }

  function onChange(changed: EditorRow): void {
    onSave(rows.map((row) => (row.key === changed.key ? changed : row)));
  }

  return (
    <div ref={containerRef} className="training-routine-table">
      {isCompact ? null : <ColumnHeader translate={translate} />}
      <SortableList
        translate={translate}
        isDisabled={false}
        items={rows}
        idOf={(row) => row.key}
        describeItem={rowName}
        onDrop={(order) => onSave(order)}
      >
        <ul className="training-routine-rows">
          {rows.map((row, index) =>
            row.kind === "section" ? (
              <SectionRow
                key={row.key}
                {...rowProps(row, index)}
                row={row}
                onChange={onChange}
              />
            ) : (
              <ExerciseRow
                key={row.key}
                {...rowProps(row, index)}
                row={row}
                marks={marks}
                onChange={onChange}
              />
            ),
          )}
        </ul>
      </SortableList>
    </div>
  );
}
