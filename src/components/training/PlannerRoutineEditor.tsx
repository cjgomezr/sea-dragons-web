"use client";

import { CaretLeft } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { useId, useState } from "react";
import { Icon } from "@/components/Icon";
import { useIsBelowDesktop } from "@/components/use-is-phone";
import type { Translator } from "@/lib/i18n/translator";
import {
  type ManagedRoutine,
  ROUTINE_NAME_MAX_LENGTH,
} from "@/lib/training/club-routines";
import { deleteRoutine } from "./planner-routines-client";
import { PlannerRoutineRows } from "./PlannerRoutineRows";
import { SavedTextField } from "./SavedTextField";
import type { PlannerError } from "./use-planner-cycles";
import {
  type RoutineEditorControls,
  useRoutineEditor,
} from "./use-routine-editor";

/**
 * El editor de una rutina en Planificar → Rutinas (#908, RF-9, D8 y D9 del
 * PRD de E35; §5.1 y §5.2 del handoff): su nombre, sus filas y los títulos
 * de sección. Borrar una rutina que usa la cuadrícula pide confirmar.
 * Buscar y añadir ejercicios llega con #909.
 */

export type RoutineEditorProps = {
  readonly translate: Translator;
  readonly routine: ManagedRoutine;
  readonly isPhone: boolean;
  readonly onSaved: (routine: ManagedRoutine) => void;
  readonly onDeleted: (routine: ManagedRoutine) => void;
  readonly onError: (error: PlannerError | null) => void;
  /** En el móvil, "‹ Routines" vuelve a la lista. */
  readonly onBack: () => void;
};

/** El motivo que dice la pantalla sin preguntar a la API. */
const NAME_REQUIRED_REASON = "name_required";

function RoutineNameField({
  translate,
  routine,
  editor,
  onError,
}: {
  readonly translate: Translator;
  readonly routine: ManagedRoutine;
  readonly editor: RoutineEditorControls;
  readonly onError: (error: PlannerError | null) => void;
}): React.JSX.Element {
  const inputId = useId();
  // Un nombre que la API no guarda vuelve al que tenía: el campo se monta de
  // nuevo con el nombre de la lista.
  const [failures, setFailures] = useState(0);
  return (
    <div className="training-plan-field training-routine-name-field">
      <label htmlFor={inputId}>
        {translate("training.manage.routineName")}
      </label>
      <SavedTextField
        key={failures}
        id={inputId}
        maxLength={ROUTINE_NAME_MAX_LENGTH}
        value={routine.name}
        onCommit={(text) => {
          const name = text.trim();
          if (name === "") {
            onError({ reason: NAME_REQUIRED_REASON });
            return false;
          }
          void editor.rename(name).then((isSaved) => {
            if (!isSaved) {
              setFailures((previous) => previous + 1);
            }
          });
          return true;
        }}
      />
    </div>
  );
}

function useRoutineDeletion({
  routine,
  onDeleted,
  onError,
}: Pick<RoutineEditorProps, "routine" | "onDeleted" | "onError">): {
  readonly daysToConfirm: number | null;
  readonly remove: (confirm: boolean) => void;
  readonly cancel: () => void;
} {
  const [daysToConfirm, setDaysToConfirm] = useState<number | null>(null);

  async function remove(confirm: boolean): Promise<void> {
    if (!confirm && routine.daysUsed > 0) {
      setDaysToConfirm(routine.daysUsed);
      return;
    }
    onError(null);
    const outcome = await deleteRoutine(routine.id, confirm);
    switch (outcome.kind) {
      case "confirmDelete":
        setDaysToConfirm(outcome.daysUsed);
        return;
      case "failed":
        onError({ reason: outcome.reason });
        return;
      case "deleted":
        setDaysToConfirm(null);
        onDeleted(routine);
    }
  }

  return {
    daysToConfirm,
    remove: (confirm) => void remove(confirm),
    cancel: () => setDaysToConfirm(null),
  };
}

function DeleteRoutine({
  translate,
  ...props
}: Pick<
  RoutineEditorProps,
  "translate" | "routine" | "onDeleted" | "onError"
>): React.JSX.Element {
  const deletion = useRoutineDeletion(props);
  if (deletion.daysToConfirm === null) {
    return (
      <button
        type="button"
        className="training-plan-action training-routine-delete-routine"
        onClick={() => deletion.remove(false)}
      >
        <Icon glyph={Trash} />
        {translate("training.manage.deleteRoutine")}
      </button>
    );
  }
  return (
    <div className="training-plan-confirm" role="group">
      <p>
        {translate("training.manage.confirmDeleteRoutine", {
          count: deletion.daysToConfirm,
        })}
      </p>
      <div className="training-plan-confirm-actions">
        <button
          type="button"
          className="training-plan-danger"
          onClick={() => deletion.remove(true)}
        >
          {translate("training.manage.deleteAnyway")}
        </button>
        <button
          type="button"
          className="training-plan-action"
          onClick={deletion.cancel}
        >
          {translate("training.manage.cancel")}
        </button>
      </div>
    </div>
  );
}

function EditorRows({
  translate,
  editor,
}: {
  readonly translate: Translator;
  readonly editor: RoutineEditorControls;
}): React.JSX.Element {
  // La tabla solo cabe en el escritorio; por debajo, una tarjeta por fila.
  const isCompact = useIsBelowDesktop();
  const { state } = editor;
  if (state.kind === "loading") {
    return (
      <p className="admin-empty">
        {translate("training.manage.routineLoading")}
      </p>
    );
  }
  if (state.kind === "failed") {
    return (
      <div className="admin-load-failure">
        <p className="auth-error" role="alert">
          {translate("training.manage.routineFailed")}
        </p>
        <button type="button" className="auth-submit" onClick={editor.retry}>
          {translate("training.manage.retry")}
        </button>
      </div>
    );
  }
  const { rows } = state;
  return (
    <>
      {rows.length === 0 ? (
        <p className="admin-empty">{translate("training.manage.noRows")}</p>
      ) : (
        <PlannerRoutineRows
          translate={translate}
          rows={rows}
          marks={state.marks}
          isCompact={isCompact}
          onSave={editor.saveRows}
        />
      )}
      <button
        type="button"
        className="training-routine-add-section"
        onClick={() =>
          editor.saveRows([
            ...rows,
            {
              key: editor.makeKey(),
              kind: "section",
              title: translate("training.manage.newSectionTitle"),
            },
          ])
        }
      >
        <Icon glyph={Plus} />
        {translate("training.manage.addSection")}
      </button>
    </>
  );
}

export function PlannerRoutineEditor(
  props: RoutineEditorProps,
): React.JSX.Element {
  const { translate, routine, isPhone, onSaved, onError } = props;
  const editor = useRoutineEditor(routine.id, { onSaved, onError });
  return (
    <section className="training-routine-editor" aria-label={routine.name}>
      {isPhone ? (
        <button
          type="button"
          className="training-routine-back"
          onClick={props.onBack}
        >
          <Icon glyph={CaretLeft} />
          {translate("training.manage.backToRoutines")}
        </button>
      ) : null}
      <div className="training-routine-editor-top">
        <RoutineNameField
          translate={translate}
          routine={routine}
          editor={editor}
          onError={onError}
        />
        <DeleteRoutine {...props} />
      </div>
      <EditorRows translate={translate} editor={editor} />
      <p className="training-routine-hint">
        {translate("training.manage.loadHint")}
      </p>
    </section>
  );
}
