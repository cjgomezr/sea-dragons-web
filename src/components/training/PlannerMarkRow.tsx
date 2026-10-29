"use client";

import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { useEffect, useId, useRef } from "react";
import type { Translator } from "@/lib/i18n/translator";
import type { ManagedMark } from "@/lib/training/club-marks";
import { markDeletion } from "@/lib/training/mark-planner-view";
import { PlannerMarkNameForm } from "./PlannerMarkNameForm";
import { markUsage } from "./planner-marks-format";
import type { MarkActionResult } from "./use-planner-marks";

/**
 * Una marca en Planificar → Marcas (#911, §5.1 "Tab Marks"): su nombre, cuánto
 * se usa, Rename y Delete. Renombrar cambia el nombre por un campo en la
 * misma fila; borrar una que registraron socios abre debajo la confirmación,
 * que sólo dice cuántos (D11).
 */

export type MarkRowMode = "view" | "renaming" | "confirming";

/** El control de la fila al que vuelve el foco tras cerrar algo. Un objeto
 * nuevo cada vez, para que pedirlo dos veces seguidas también mueva el
 * foco. */
export type MarkFocusRequest = {
  readonly markId: string;
  readonly control: "rename" | "delete";
};

export type MarkRowActions = {
  readonly startRename: () => void;
  readonly cancelRename: () => void;
  readonly rename: (name: string) => Promise<MarkActionResult>;
  readonly startDelete: () => void;
  readonly cancelDelete: () => void;
  readonly confirmDelete: () => void;
};

function RenameForm({
  translate,
  mark,
  marks,
  isBusy,
  actions,
}: {
  readonly translate: Translator;
  readonly mark: ManagedMark;
  readonly marks: readonly ManagedMark[];
  readonly isBusy: boolean;
  readonly actions: MarkRowActions;
}): React.JSX.Element {
  const hintId = useId();
  return (
    <div className="training-marks-rename">
      <PlannerMarkNameForm
        translate={translate}
        className="training-marks-row-main"
        fieldLabel={translate("training.marks.renameField", {
          name: mark.name,
        })}
        initialName={mark.name}
        marks={marks}
        renaming={mark}
        hintId={hintId}
        isBusy={isBusy}
        onSubmit={actions.rename}
        onCancel={actions.cancelRename}
      >
        {(canSubmit) => (
          <div className="training-marks-actions">
            <button
              type="submit"
              className="training-marks-icon-button training-marks-icon-button-primary"
              aria-label={translate("training.marks.renameSave")}
              disabled={isBusy || !canSubmit}
            >
              <Check aria-hidden="true" />
            </button>
            <button
              type="button"
              className="training-marks-icon-button"
              aria-label={translate("training.marks.renameCancel")}
              onClick={actions.cancelRename}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        )}
      </PlannerMarkNameForm>
      <p className="training-marks-hint" id={hintId}>
        {translate("training.marks.renameHint")}
      </p>
    </div>
  );
}

/** Usada en una rutina, Delete sigue enfocable y dice por qué no borra:
 * desactivado del todo, ni el lector ni el ratón verían la razón. */
function DeleteButton({
  translate,
  mark,
  isBusy,
  buttonRef,
  onDelete,
}: {
  readonly translate: Translator;
  readonly mark: ManagedMark;
  readonly isBusy: boolean;
  readonly buttonRef: React.RefObject<HTMLButtonElement | null>;
  readonly onDelete: () => void;
}): React.JSX.Element {
  const isInUse = markDeletion(mark).kind === "inUse";
  return (
    <button
      ref={buttonRef}
      type="button"
      className="training-marks-icon-button training-marks-delete"
      aria-label={translate("training.marks.delete", { name: mark.name })}
      aria-disabled={isInUse ? "true" : undefined}
      title={isInUse ? translate("training.marks.inUse") : undefined}
      disabled={isBusy}
      onClick={isInUse ? undefined : onDelete}
    >
      <Trash aria-hidden="true" />
    </button>
  );
}

function DeleteConfirm({
  translate,
  mark,
  isBusy,
  actions,
}: {
  readonly translate: Translator;
  readonly mark: ManagedMark;
  readonly isBusy: boolean;
  readonly actions: MarkRowActions;
}): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="training-plan-confirm training-marks-confirm"
      role="group"
      aria-label={translate("training.marks.delete", { name: mark.name })}
    >
      <p>
        {translate("training.marks.confirmDelete", {
          count: mark.membersRecorded,
          name: mark.name,
        })}
      </p>
      <div className="training-plan-confirm-actions">
        <button
          ref={cancelRef}
          type="button"
          className="training-plan-action"
          onClick={actions.cancelDelete}
        >
          {translate("training.marks.cancel")}
        </button>
        <button
          type="button"
          className="training-plan-danger"
          disabled={isBusy}
          onClick={actions.confirmDelete}
        >
          {translate("training.marks.deleteMark")}
        </button>
      </div>
    </div>
  );
}

export function PlannerMarkRow({
  translate,
  mark,
  marks,
  mode,
  isBusy,
  focusRequest,
  actions,
}: {
  readonly translate: Translator;
  readonly mark: ManagedMark;
  /** Todas, para decir un nombre repetido al renombrar. */
  readonly marks: readonly ManagedMark[];
  readonly mode: MarkRowMode;
  readonly isBusy: boolean;
  /** Sólo el de esta fila, o nulo. */
  readonly focusRequest: MarkFocusRequest | null;
  readonly actions: MarkRowActions;
}): React.JSX.Element {
  const renameRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusRequest === null) {
      return;
    }
    const target = focusRequest.control === "rename" ? renameRef : deleteRef;
    target.current?.focus();
  }, [focusRequest]);

  if (mode === "renaming") {
    return (
      <li className="training-marks-row">
        <RenameForm
          translate={translate}
          mark={mark}
          marks={marks}
          isBusy={isBusy}
          actions={actions}
        />
      </li>
    );
  }
  return (
    <li className="training-marks-row">
      <div className="training-marks-row-main">
        <div className="training-marks-text">
          <span className="training-marks-name">{mark.name}</span>
          <span className="training-marks-usage">
            {markUsage(translate, mark)}
          </span>
        </div>
        <div className="training-marks-actions">
          <button
            ref={renameRef}
            type="button"
            className="training-marks-icon-button"
            aria-label={translate("training.marks.rename", { name: mark.name })}
            disabled={isBusy}
            onClick={actions.startRename}
          >
            <PencilSimple aria-hidden="true" />
          </button>
          <DeleteButton
            translate={translate}
            mark={mark}
            isBusy={isBusy}
            buttonRef={deleteRef}
            onDelete={actions.startDelete}
          />
        </div>
      </div>
      {mode === "confirming" ? (
        <DeleteConfirm
          translate={translate}
          mark={mark}
          isBusy={isBusy}
          actions={actions}
        />
      ) : null}
    </li>
  );
}
