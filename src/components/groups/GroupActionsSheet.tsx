"use client";

import { DotsThree } from "@phosphor-icons/react/dist/ssr/DotsThree";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { useEffect, useRef, useState } from "react";
import { BottomSheet } from "@/components/directory/BottomSheet";
import { Icon } from "@/components/Icon";
import { GROUP_NAME_MAX_LENGTH, type GroupOverview } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";
import type { GroupActionResult } from "./GroupNameForm";
import { DeleteWarning } from "./GroupPanelHeader";
import { type GroupsFailure, describeGroupsFailure } from "./groups-client";

/**
 * El ⋯ de la pantalla del grupo en el móvil (#831, RF-7 de E32) y la hoja que
 * sube: "Renombrar grupo" y, tras una línea, "Borrar grupo" en peligro.
 * Renombrar cambia la hoja por un campo con Guardar; borrar, por el aviso de
 * D11, el mismo del escritorio. La hoja retiene el foco hasta cerrarse y, al
 * cerrarse por donde sea, el foco vuelve al ⋯.
 *
 * Si el servidor dice que no, la hoja sigue abierta y lo dice dentro: lo que
 * queda detrás está inerte mientras ella esté abierta.
 */

type SheetStep = "menu" | "renaming" | "confirmingDelete";

type SheetActions = {
  readonly translate: Translator;
  readonly group: GroupOverview;
  /** El último fallo de la pantalla; la hoja sólo lo enseña si fue suyo. */
  readonly failure: GroupsFailure | null;
  /** Hay una acción en vuelo en la pantalla. */
  readonly isDisabled: boolean;
  /** La que está en vuelo es el borrado de este grupo. */
  readonly isDeleting: boolean;
  readonly onRename: (name: string) => Promise<GroupActionResult>;
  readonly onDelete: () => Promise<GroupActionResult>;
};

function SheetMenu({
  translate,
  isDisabled,
  onRename,
  onDelete,
}: {
  translate: Translator;
  isDisabled: boolean;
  onRename: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <>
      <button
        type="button"
        className="news-sheet-action"
        disabled={isDisabled}
        onClick={onRename}
      >
        <Icon glyph={PencilSimple} />
        {translate("groups.phone.rename")}
      </button>
      <hr className="groups-sheet-rule" />
      <button
        type="button"
        className="news-sheet-action news-sheet-action-danger"
        disabled={isDisabled}
        onClick={onDelete}
      >
        <Icon glyph={Trash} />
        {translate("groups.phone.delete")}
      </button>
    </>
  );
}

function SheetRenameForm({
  translate,
  group,
  isDisabled,
  onSubmit,
}: {
  translate: Translator;
  group: GroupOverview;
  isDisabled: boolean;
  onSubmit: (name: string) => void;
}): React.JSX.Element {
  const [name, setName] = useState(group.name);
  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, []);

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (name.trim() !== "") {
      onSubmit(name.trim());
    }
  }

  return (
    <form className="groups-sheet-rename" onSubmit={submit}>
      <input
        ref={fieldRef}
        type="text"
        className="groups-rename-field"
        value={name}
        maxLength={GROUP_NAME_MAX_LENGTH}
        aria-label={translate("groups.renameField", { name: group.name })}
        disabled={isDisabled}
        onChange={(event) => setName(event.target.value)}
      />
      <button
        type="submit"
        className="groups-create-submit"
        disabled={isDisabled || name.trim() === ""}
      >
        {translate("groups.phone.renameSave")}
      </button>
    </form>
  );
}

function SheetContent({
  actions,
  close,
}: {
  actions: SheetActions;
  close: () => void;
}): React.JSX.Element {
  const { translate, group, failure, isDisabled } = actions;
  const [step, setStep] = useState<SheetStep>("menu");
  // Un fallo de antes de abrir la hoja no es de ella: sólo se enseña el de
  // lo que se mandó desde este paso.
  const [hasFailed, setHasFailed] = useState(false);
  const stepRef = useRef<HTMLDivElement>(null);
  const hasChangedStep = useRef(false);

  // Volver a las acciones quita el botón que tenía el foco: pasa al paso.
  // Los otros dos pasos ponen el foco en su campo o en Cancelar.
  useEffect(() => {
    if (hasChangedStep.current && step === "menu") {
      stepRef.current?.focus();
    }
  }, [step]);

  function goTo(next: SheetStep): void {
    hasChangedStep.current = true;
    setHasFailed(false);
    setStep(next);
  }

  async function rename(name: string): Promise<void> {
    if ((await actions.onRename(name)) === "done") {
      close();
      return;
    }
    setHasFailed(true);
  }

  /** Si sale bien, el grupo desaparece y la hoja con él. */
  async function remove(): Promise<void> {
    if ((await actions.onDelete()) === "failed") {
      setHasFailed(true);
    }
  }

  return (
    <div ref={stepRef} className="news-sheet-step" tabIndex={-1}>
      {step === "menu" ? (
        <SheetMenu
          translate={translate}
          isDisabled={isDisabled}
          onRename={() => goTo("renaming")}
          onDelete={() => goTo("confirmingDelete")}
        />
      ) : null}
      {step === "renaming" ? (
        <SheetRenameForm
          translate={translate}
          group={group}
          isDisabled={isDisabled}
          onSubmit={(name) => void rename(name)}
        />
      ) : null}
      {step === "confirmingDelete" ? (
        <DeleteWarning
          translate={translate}
          group={group}
          confirmLabel={translate("groups.phone.deleteConfirm")}
          isDisabled={isDisabled}
          isDeleting={actions.isDeleting}
          onConfirm={() => void remove()}
          onCancel={() => goTo("menu")}
        />
      ) : null}
      {hasFailed && failure !== null ? (
        <p className="auth-error" role="alert">
          {describeGroupsFailure(translate, failure)}
        </p>
      ) : null}
    </div>
  );
}

export function GroupActionsSheet(actions: SheetActions): React.JSX.Element {
  const { translate, group } = actions;
  const [isOpen, setIsOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const label = translate("groups.phone.more", { name: group.name });

  function closeSheet(): void {
    setIsOpen(false);
    openerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className="groups-bar-button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
      >
        <Icon glyph={DotsThree} weight="bold" />
      </button>
      {isOpen ? (
        <BottomSheet
          title={(titleId) => (
            <h2 id={titleId} className="visually-hidden">
              {translate("groups.phone.sheetTitle", { name: group.name })}
            </h2>
          )}
          gripLabel={translate("groups.phone.sheetClose")}
          onClosed={closeSheet}
        >
          {(close) => <SheetContent actions={actions} close={close} />}
        </BottomSheet>
      ) : null}
    </>
  );
}
