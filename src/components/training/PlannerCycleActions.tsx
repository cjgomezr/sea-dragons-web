"use client";

import { Archive } from "@phosphor-icons/react/dist/ssr/Archive";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { Copy } from "@phosphor-icons/react/dist/ssr/Copy";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import type { ManagedCycle } from "@/lib/training/club-cycles";
import type { PlannerCycles } from "./use-planner-cycles";

/**
 * Lo que se le hace a un ciclo entero (#906, RF-7): Make active solo a un
 * borrador, Duplicate a cualquiera, Archive a lo que no está archivado y
 * Delete a lo que no está activo (#935), que lo siguen los socios. Delete
 * abre debajo de las acciones una confirmación en color de peligro, como la
 * de borrar una marca. En el móvil Archive y Delete son solo el icono, con
 * su nombre para quien no lo ve.
 */

type CyclePlanner = Pick<
  PlannerCycles,
  "activate" | "duplicate" | "archive" | "remove" | "isBusy"
>;

function confirmText(translate: Translator, cycle: ManagedCycle): string {
  return cycle.ownRoutines === 0
    ? translate("training.manage.confirmDeleteEmptyCycle", {
        name: cycle.name,
      })
    : translate("training.manage.confirmDeleteCycle", {
        name: cycle.name,
        count: cycle.ownRoutines,
      });
}

function DeleteConfirm({
  translate,
  cycle,
  isBusy,
  onCancel,
  onConfirm,
}: {
  readonly translate: Translator;
  readonly cycle: ManagedCycle;
  readonly isBusy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): React.JSX.Element {
  const textId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="training-plan-confirm training-plan-cycle-delete"
      role="group"
      aria-labelledby={textId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onCancel();
        }
      }}
    >
      <p id={textId}>{confirmText(translate, cycle)}</p>
      <div className="training-plan-confirm-actions">
        <button
          ref={cancelRef}
          type="button"
          className="training-plan-action"
          onClick={onCancel}
        >
          {translate("training.manage.cancel")}
        </button>
        <button
          type="button"
          className="training-plan-danger"
          disabled={isBusy}
          onClick={onConfirm}
        >
          {translate("training.manage.deleteCycle")}
        </button>
      </div>
    </div>
  );
}

function CycleButtons({
  translate,
  cycle,
  planner,
  isCompact,
  deleteRef,
  onDelete,
}: {
  readonly translate: Translator;
  readonly cycle: ManagedCycle;
  readonly planner: CyclePlanner;
  readonly isCompact: boolean;
  readonly deleteRef: React.RefObject<HTMLButtonElement | null>;
  readonly onDelete: () => void;
}): React.JSX.Element {
  const archiveLabel = translate("training.manage.archive");
  return (
    <>
      {cycle.status === "draft" ? (
        <button
          type="button"
          className="training-plan-action training-plan-action-activate"
          disabled={planner.isBusy}
          onClick={() => planner.activate(cycle)}
        >
          <Icon glyph={CheckCircle} />
          {translate("training.manage.makeActive")}
        </button>
      ) : null}
      <button
        type="button"
        className="training-plan-action"
        disabled={planner.isBusy}
        onClick={() => planner.duplicate(cycle)}
      >
        <Icon glyph={Copy} />
        {translate("training.manage.duplicate")}
      </button>
      {cycle.status === "archived" ? null : (
        <button
          type="button"
          className="training-plan-action training-plan-action-archive"
          disabled={planner.isBusy}
          aria-label={isCompact ? archiveLabel : undefined}
          onClick={() => planner.archive(cycle)}
        >
          <Icon glyph={Archive} />
          {isCompact ? null : archiveLabel}
        </button>
      )}
      {cycle.status === "active" ? null : (
        <button
          ref={deleteRef}
          type="button"
          className="training-plan-action training-plan-action-delete"
          disabled={planner.isBusy}
          aria-label={
            isCompact ? translate("training.manage.deleteCycle") : undefined
          }
          onClick={onDelete}
        >
          <Icon glyph={Trash} />
          {isCompact ? null : translate("training.manage.delete")}
        </button>
      )}
    </>
  );
}

export function PlannerCycleActions({
  translate,
  cycle,
  planner,
  isCompact,
  className,
  children,
}: {
  readonly translate: Translator;
  readonly cycle: ManagedCycle;
  readonly planner: CyclePlanner;
  /** En el móvil, Archive y Delete van como icono. */
  readonly isCompact: boolean;
  /** La de la fila de acciones, que cambia entre el escritorio y el móvil. */
  readonly className: string;
  /** Lo que va al final de la fila, como + en el móvil. */
  readonly children?: React.ReactNode;
}): React.JSX.Element {
  const [isConfirming, setIsConfirming] = useState(false);
  const deleteRef = useRef<HTMLButtonElement>(null);

  function closeConfirm(): void {
    setIsConfirming(false);
    deleteRef.current?.focus();
  }

  async function confirmDelete(): Promise<void> {
    await planner.remove(cycle);
    // Si se borró, este ciclo ya no se pinta y no hay a dónde volver.
    closeConfirm();
  }

  return (
    <>
      <div className={className}>
        <CycleButtons
          translate={translate}
          cycle={cycle}
          planner={planner}
          isCompact={isCompact}
          deleteRef={deleteRef}
          onDelete={() => setIsConfirming(true)}
        />
        {children}
      </div>
      {isConfirming ? (
        <DeleteConfirm
          translate={translate}
          cycle={cycle}
          isBusy={planner.isBusy}
          onCancel={closeConfirm}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </>
  );
}
