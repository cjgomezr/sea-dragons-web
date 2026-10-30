"use client";

import { Archive } from "@phosphor-icons/react/dist/ssr/Archive";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { Copy } from "@phosphor-icons/react/dist/ssr/Copy";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import type { ManagedCycle } from "@/lib/training/club-cycles";
import { reactivateConfirmText } from "./planner-format";
import type { PlannerCycles } from "./use-planner-cycles";

/**
 * Lo que se le hace a un ciclo entero (#906, RF-7): Make active a lo que no
 * está activo, Duplicate a cualquiera, Archive a lo que no está archivado y
 * Delete a lo que no está activo (#935), que lo siguen los socios. Delete
 * abre debajo de las acciones una confirmación en color de peligro, como la
 * de borrar una marca. Make active sobre un archivado (#952) abre otra igual
 * pero sin ese color, porque no borra nada; un borrador se activa sin
 * preguntar. En el móvil Archive y Delete son solo el icono, con su nombre
 * para quien no lo ve.
 */

type CyclePlanner = Pick<
  PlannerCycles,
  "activate" | "duplicate" | "archive" | "remove" | "isBusy"
>;

type OpenConfirm = "none" | "delete" | "reactivate";

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

function InlineConfirm({
  translate,
  text,
  classNames,
  confirmLabel,
  isBusy,
  onCancel,
  onConfirm,
}: {
  readonly translate: Translator;
  readonly text: string;
  /** La de la caja y la del botón que confirma. */
  readonly classNames: { readonly box: string; readonly confirm: string };
  readonly confirmLabel: string;
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
      className={`training-plan-confirm ${classNames.box}`}
      role="group"
      aria-labelledby={textId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onCancel();
        }
      }}
    >
      <p id={textId}>{text}</p>
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
          className={classNames.confirm}
          disabled={isBusy}
          onClick={onConfirm}
        >
          {confirmLabel}
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
  activateRef,
  deleteRef,
  onActivate,
  onDelete,
}: {
  readonly translate: Translator;
  readonly cycle: ManagedCycle;
  readonly planner: CyclePlanner;
  readonly isCompact: boolean;
  readonly activateRef: React.RefObject<HTMLButtonElement | null>;
  readonly deleteRef: React.RefObject<HTMLButtonElement | null>;
  readonly onActivate: () => void;
  readonly onDelete: () => void;
}): React.JSX.Element {
  const archiveLabel = translate("training.manage.archive");
  return (
    <>
      {cycle.status === "active" ? null : (
        <button
          ref={activateRef}
          type="button"
          className="training-plan-action training-plan-action-activate"
          disabled={planner.isBusy}
          onClick={onActivate}
        >
          <Icon glyph={CheckCircle} />
          {translate("training.manage.makeActive")}
        </button>
      )}
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

function OpenedConfirm({
  translate,
  cycle,
  planner,
  activeName,
  opened,
  onClose,
}: {
  readonly translate: Translator;
  readonly cycle: ManagedCycle;
  readonly planner: CyclePlanner;
  readonly activeName: string | null;
  readonly opened: Exclude<OpenConfirm, "none">;
  readonly onClose: () => void;
}): React.JSX.Element {
  async function confirmDelete(): Promise<void> {
    await planner.remove(cycle);
    // Si se borró, este ciclo ya no se pinta y no hay a dónde volver.
    onClose();
  }

  if (opened === "delete") {
    return (
      <InlineConfirm
        translate={translate}
        text={confirmText(translate, cycle)}
        classNames={{
          box: "training-plan-cycle-delete",
          confirm: "training-plan-danger",
        }}
        confirmLabel={translate("training.manage.deleteCycle")}
        isBusy={planner.isBusy}
        onCancel={onClose}
        onConfirm={() => void confirmDelete()}
      />
    );
  }
  return (
    <InlineConfirm
      translate={translate}
      text={reactivateConfirmText(translate, {
        cycle,
        activeName,
        now: new Date(),
      })}
      classNames={{
        box: "training-plan-cycle-reactivate",
        confirm: "training-plan-action training-plan-action-activate",
      }}
      confirmLabel={translate("training.manage.makeActive")}
      isBusy={planner.isBusy}
      onCancel={onClose}
      onConfirm={() => {
        onClose();
        planner.activate(cycle);
      }}
    />
  );
}

export function PlannerCycleActions({
  translate,
  cycle,
  planner,
  activeName,
  isCompact,
  className,
  children,
}: {
  readonly translate: Translator;
  readonly cycle: ManagedCycle;
  readonly planner: CyclePlanner;
  /** El ciclo activo del club, que se archiva al volver a activar éste. */
  readonly activeName: string | null;
  /** En el móvil, Archive y Delete van como icono. */
  readonly isCompact: boolean;
  /** La de la fila de acciones, que cambia entre el escritorio y el móvil. */
  readonly className: string;
  /** Lo que va al final de la fila, como + en el móvil. */
  readonly children?: React.ReactNode;
}): React.JSX.Element {
  const [opened, setOpened] = useState<OpenConfirm>("none");
  const activateRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);

  function closeConfirm(): void {
    const returnTo = opened === "delete" ? deleteRef : activateRef;
    setOpened("none");
    returnTo.current?.focus();
  }

  function activate(): void {
    if (cycle.status === "archived") {
      setOpened("reactivate");
      return;
    }
    planner.activate(cycle);
  }

  return (
    <>
      <div className={className}>
        <CycleButtons
          translate={translate}
          cycle={cycle}
          planner={planner}
          isCompact={isCompact}
          activateRef={activateRef}
          deleteRef={deleteRef}
          onActivate={activate}
          onDelete={() => setOpened("delete")}
        />
        {children}
      </div>
      {opened === "none" ? null : (
        <OpenedConfirm
          translate={translate}
          cycle={cycle}
          planner={planner}
          activeName={activeName}
          opened={opened}
          onClose={closeConfirm}
        />
      )}
    </>
  );
}
