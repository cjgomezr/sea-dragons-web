"use client";

import { Archive } from "@phosphor-icons/react/dist/ssr/Archive";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { Copy } from "@phosphor-icons/react/dist/ssr/Copy";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import type {
  ConflictingCycle,
  ManagedCycle,
} from "@/lib/training/club-cycles";
import { PlannerInlineConfirm } from "./PlannerInlineConfirm";
import { conflictsConfirmText, reactivateConfirmText } from "./planner-format";
import type { PlannerCycles } from "./use-planner-cycles";

/**
 * Lo que se le hace a un ciclo entero (#906, RF-7): Make active a lo que no
 * está activo, Duplicate a cualquiera, Archive a lo que no está archivado y
 * Delete a lo que no está activo (#935), que lo siguen los socios. Delete
 * abre debajo de las acciones una confirmación en color de peligro, como la
 * de borrar una marca. Make active sobre un archivado (#952) abre otra igual
 * pero sin ese color, porque no borra nada; un borrador se activa sin
 * preguntar. Si activar choca con otros activos (#980, D3 de E38), la API
 * responde cuáles y otra confirmación los nombra antes de archivarlos. En el
 * móvil Archive y Delete son solo el icono, con su nombre para quien no lo
 * ve.
 */

type CyclePlanner = Pick<
  PlannerCycles,
  "activate" | "duplicate" | "archive" | "remove" | "isBusy"
>;

type OpenConfirm =
  | { readonly kind: "none" }
  | { readonly kind: "delete" }
  | { readonly kind: "reactivate" }
  | {
      readonly kind: "conflicts";
      readonly conflicts: readonly ConflictingCycle[];
    };

const CLOSED: OpenConfirm = { kind: "none" };

const ACTIVATE_CONFIRM_CLASS =
  "training-plan-action training-plan-action-activate";

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
  opened,
  onClose,
  onActivate,
}: {
  readonly translate: Translator;
  readonly cycle: ManagedCycle;
  readonly planner: CyclePlanner;
  readonly opened: Exclude<OpenConfirm, { readonly kind: "none" }>;
  readonly onClose: () => void;
  /** Vuelve a pedir activar; confirmado, archiva lo que choca. */
  readonly onActivate: (confirmConflicts: boolean) => void;
}): React.JSX.Element {
  async function confirmDelete(): Promise<void> {
    await planner.remove(cycle);
    // Si se borró, este ciclo ya no se pinta y no hay a dónde volver.
    onClose();
  }

  const shared = {
    translate,
    isBusy: planner.isBusy,
    onCancel: onClose,
  };
  switch (opened.kind) {
    case "delete":
      return (
        <PlannerInlineConfirm
          {...shared}
          text={confirmText(translate, cycle)}
          classNames={{
            box: "training-plan-cycle-delete",
            confirm: "training-plan-danger",
          }}
          confirmLabel={translate("training.manage.deleteCycle")}
          onConfirm={() => void confirmDelete()}
        />
      );
    case "reactivate":
      return (
        <PlannerInlineConfirm
          {...shared}
          text={reactivateConfirmText(translate, { cycle, now: new Date() })}
          classNames={{
            box: "training-plan-cycle-reactivate",
            confirm: ACTIVATE_CONFIRM_CLASS,
          }}
          confirmLabel={translate("training.manage.makeActive")}
          onConfirm={() => onActivate(false)}
        />
      );
    case "conflicts":
      return (
        <PlannerInlineConfirm
          {...shared}
          text={conflictsConfirmText(translate, opened.conflicts)}
          classNames={{
            box: "training-plan-cycle-conflicts",
            confirm: ACTIVATE_CONFIRM_CLASS,
          }}
          confirmLabel={translate("training.manage.makeActive")}
          onConfirm={() => onActivate(true)}
        />
      );
  }
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
  const [opened, setOpened] = useState<OpenConfirm>(CLOSED);
  const activateRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);

  function closeConfirm(): void {
    const returnTo = opened.kind === "delete" ? deleteRef : activateRef;
    setOpened(CLOSED);
    returnTo.current?.focus();
  }

  async function requestActivation(confirmConflicts: boolean): Promise<void> {
    const result = await planner.activate(cycle, confirmConflicts);
    if (result.kind === "conflicts") {
      setOpened({ kind: "conflicts", conflicts: result.conflicts });
    }
  }

  function activate(): void {
    if (cycle.status === "archived") {
      setOpened({ kind: "reactivate" });
      return;
    }
    void requestActivation(false);
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
          onDelete={() => setOpened({ kind: "delete" })}
        />
        {children}
      </div>
      {opened.kind === "none" ? null : (
        <OpenedConfirm
          translate={translate}
          cycle={cycle}
          planner={planner}
          opened={opened}
          onClose={closeConfirm}
          onActivate={(confirmConflicts) => {
            closeConfirm();
            void requestActivation(confirmConflicts);
          }}
        />
      )}
    </>
  );
}
