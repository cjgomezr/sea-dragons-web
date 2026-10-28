"use client";

import { LockSimple } from "@phosphor-icons/react/dist/ssr/LockSimple";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import type { ManagedMark } from "@/lib/training/club-marks";
import { markDeletion } from "@/lib/training/mark-planner-view";
import { PlannerMarkNameForm } from "./PlannerMarkNameForm";
import {
  type MarkFocusRequest,
  type MarkRowActions,
  type MarkRowMode,
  PlannerMarkRow,
} from "./PlannerMarkRow";
import { markErrorMessage } from "./planner-marks-format";
import type { MarkList } from "./planner-marks-client";
import { MARK_IN_USE_REASON, type PlannerMarks } from "./use-planner-marks";

/**
 * Planificar → Marcas (#911, RF-11 y D11 del PRD de E35; §5.1 "Tab Marks" y
 * §5.2 del handoff): las marcas que los socios pueden registrar, con cuánto
 * se usan, renombrar y borrar en la fila, y la fila de añadir. De los
 * valores de los socios sólo se ven cuentas: ni cuánto ni de quién.
 *
 * Sólo una fila está abierta a la vez, renombrando o confirmando el borrado.
 * Al cerrarla, el foco vuelve al botón que la abrió.
 */

/** La fila abierta y en qué. */
type OpenRow = {
  readonly markId: string;
  readonly mode: Exclude<MarkRowMode, "view">;
};

function AddMarkForm({
  translate,
  marks,
  planner,
  fieldRef,
}: {
  readonly translate: Translator;
  readonly marks: MarkList;
  readonly planner: PlannerMarks;
  readonly fieldRef: React.RefObject<HTMLInputElement | null>;
}): React.JSX.Element {
  return (
    <PlannerMarkNameForm
      translate={translate}
      className="training-marks-add"
      fieldLabel={translate("training.marks.newMark")}
      placeholder={translate("training.marks.newMarkPlaceholder")}
      initialName=""
      marks={marks}
      fieldRef={fieldRef}
      isBusy={planner.isBusy}
      onSubmit={planner.create}
    >
      {(canSubmit) => (
        <button
          type="submit"
          className="training-plan-action training-marks-add-button"
          disabled={planner.isBusy || !canSubmit}
        >
          {translate("training.marks.add")}
        </button>
      )}
    </PlannerMarkNameForm>
  );
}

function MarksMessages({
  translate,
  planner,
}: {
  readonly translate: Translator;
  readonly planner: PlannerMarks;
}): React.JSX.Element {
  return (
    <>
      <p className="training-plan-notice" role="status">
        {planner.notice}
      </p>
      {planner.error === null ? null : (
        <p className="auth-error" role="alert">
          {markErrorMessage(translate, planner.error)}
        </p>
      )}
    </>
  );
}

function MarkRows({
  translate,
  marks,
  planner,
  onDeleted,
}: {
  readonly translate: Translator;
  readonly marks: MarkList;
  readonly planner: PlannerMarks;
  /** La fila se fue: el foco no tiene dónde volver en ella. */
  readonly onDeleted: () => void;
}): React.JSX.Element {
  const [openRow, setOpenRow] = useState<OpenRow | null>(null);
  const [focusRequest, setFocusRequest] = useState<MarkFocusRequest | null>(
    null,
  );

  function close(markId: string, control: MarkFocusRequest["control"]): void {
    setOpenRow(null);
    setFocusRequest({ markId, control });
  }

  async function remove(mark: ManagedMark, confirm: boolean): Promise<void> {
    const result = await planner.remove(mark, confirm);
    if (result.kind === "done") {
      setOpenRow(null);
      onDeleted();
      return;
    }
    // Alguien la puso en una rutina entretanto: confirmar ya no sirve.
    if (result.reason === MARK_IN_USE_REASON) {
      close(mark.id, "delete");
    }
  }

  function actionsFor(mark: ManagedMark): MarkRowActions {
    return {
      startRename: () => setOpenRow({ markId: mark.id, mode: "renaming" }),
      cancelRename: () => close(mark.id, "rename"),
      rename: async (name) => {
        if (name === mark.name) {
          close(mark.id, "rename");
          return { kind: "done" };
        }
        const result = await planner.rename(mark, name);
        if (result.kind === "done") {
          close(mark.id, "rename");
        }
        return result;
      },
      startDelete: () => {
        if (markDeletion(mark).kind === "confirm") {
          setOpenRow({ markId: mark.id, mode: "confirming" });
          return;
        }
        void remove(mark, false);
      },
      cancelDelete: () => close(mark.id, "delete"),
      confirmDelete: () => void remove(mark, true),
    };
  }

  return (
    <ul
      className="training-marks-list"
      aria-label={translate("training.marks.list")}
    >
      {marks.map((mark) => (
        <PlannerMarkRow
          key={mark.id}
          translate={translate}
          mark={mark}
          marks={marks}
          mode={openRow?.markId === mark.id ? openRow.mode : "view"}
          isBusy={planner.isBusy}
          focusRequest={focusRequest?.markId === mark.id ? focusRequest : null}
          actions={actionsFor(mark)}
        />
      ))}
    </ul>
  );
}

function MarksContent({
  translate,
  planner,
  marks,
}: {
  readonly translate: Translator;
  readonly planner: PlannerMarks;
  readonly marks: MarkList;
}): React.JSX.Element {
  const addFieldRef = useRef<HTMLInputElement>(null);
  return (
    <div className="training-marks">
      <p className="training-marks-lead">{translate("training.marks.lead")}</p>
      <MarksMessages translate={translate} planner={planner} />
      {marks.length === 0 ? null : (
        <MarkRows
          translate={translate}
          marks={marks}
          planner={planner}
          onDeleted={() => addFieldRef.current?.focus()}
        />
      )}
      <AddMarkForm
        translate={translate}
        marks={marks}
        planner={planner}
        fieldRef={addFieldRef}
      />
      <p className="training-marks-footer">
        <Icon glyph={LockSimple} />
        {translate("training.marks.footer")}
      </p>
    </div>
  );
}

export function PlannerMarksTab({
  translate,
  planner,
}: {
  readonly translate: Translator;
  readonly planner: PlannerMarks;
}): React.JSX.Element {
  const { state } = planner;
  if (state.kind === "loading") {
    return <p className="admin-empty">{translate("training.marks.loading")}</p>;
  }
  if (state.kind === "failed") {
    return (
      <div className="admin-load-failure">
        <p className="auth-error" role="alert">
          {translate("training.marks.failed")}
        </p>
        <button type="button" className="auth-submit" onClick={planner.retry}>
          {translate("training.manage.retry")}
        </button>
      </div>
    );
  }
  return (
    <MarksContent translate={translate} planner={planner} marks={state.marks} />
  );
}
