"use client";

import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { GROUP_NAME_MAX_LENGTH, type GroupOverview } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";
import type { GroupActionResult } from "./GroupNameForm";
import { describeDeletion, describeSummary } from "./group-texts";

/**
 * La cabecera del panel de un grupo (#828, RF-3 de E32): su nombre, el
 * resumen y los botones de icono. Renombrar convierte el título en un campo;
 * borrar abre debajo el aviso de D11, que dice lo que de verdad pasa.
 *
 * Al cerrar el campo o el aviso el foco vuelve al botón que los abrió, para
 * que quien va con teclado no tenga que buscar dónde se quedó.
 */

type HeaderMode = "viewing" | "renaming" | "confirmingDelete";

function RenameForm({
  translate,
  group,
  isDisabled,
  onSubmit,
  onCancel,
}: {
  translate: Translator;
  group: GroupOverview;
  isDisabled: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
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
    <form className="groups-rename" onSubmit={submit}>
      <input
        ref={fieldRef}
        type="text"
        className="groups-rename-field"
        value={name}
        maxLength={GROUP_NAME_MAX_LENGTH}
        aria-label={translate("groups.renameField", { name: group.name })}
        disabled={isDisabled}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <button
        type="submit"
        className="groups-icon-button"
        aria-label={translate("groups.renameSubmit")}
        disabled={isDisabled || name.trim() === ""}
      >
        <Icon glyph={Check} weight="bold" />
      </button>
      <button
        type="button"
        className="groups-icon-button"
        aria-label={translate("groups.renameCancel")}
        disabled={isDisabled}
        onClick={onCancel}
      >
        <Icon glyph={X} weight="bold" />
      </button>
    </form>
  );
}

function DeleteWarning({
  translate,
  group,
  isDisabled,
  isDeleting,
  onConfirm,
  onCancel,
}: {
  translate: Translator;
  group: GroupOverview;
  isDisabled: boolean;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="groups-delete-warning"
      role="group"
      aria-labelledby={titleId}
    >
      <p id={titleId} className="groups-delete-title">
        {translate("groups.deleteTitle", { name: group.name })}
      </p>
      <p className="groups-delete-text">{describeDeletion(translate, group)}</p>
      <div className="groups-delete-actions">
        <button
          ref={cancelRef}
          type="button"
          className="groups-text-button"
          disabled={isDisabled}
          onClick={onCancel}
        >
          {translate("groups.cancel")}
        </button>
        <button
          type="button"
          className="groups-danger"
          disabled={isDisabled}
          onClick={onConfirm}
        >
          {translate(isDeleting ? "groups.deleting" : "groups.deleteSubmit")}
        </button>
      </div>
    </div>
  );
}

export function GroupPanelHeader({
  translate,
  group,
  notActivatedCount,
  isDisabled,
  isDeleting,
  onRename,
  onDelete,
}: {
  translate: Translator;
  group: GroupOverview;
  notActivatedCount: number;
  /** Hay una acción en vuelo en la pantalla. */
  isDisabled: boolean;
  /** La que está en vuelo es el borrado de este grupo. */
  isDeleting: boolean;
  onRename: (name: string) => Promise<GroupActionResult>;
  onDelete: () => void;
}): React.JSX.Element {
  const [mode, setMode] = useState<HeaderMode>("viewing");
  const renameRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const focusAfterCloseRef =
    useRef<React.RefObject<HTMLButtonElement | null> | null>(null);

  // El foco vuelve en cuanto el botón está y se puede enfocar: mientras se
  // renombra no se pinta, y tras guardar sigue desactivado hasta que la acción
  // en vuelo termina de soltarse.
  useEffect(() => {
    const target = focusAfterCloseRef.current?.current ?? null;
    if (target !== null && !isDisabled) {
      target.focus();
      focusAfterCloseRef.current = null;
    }
  });

  function closeInto(button: React.RefObject<HTMLButtonElement | null>): void {
    setMode("viewing");
    focusAfterCloseRef.current = button;
  }

  /** El campo se cierra sólo cuando el servidor confirmó: si dijo que no, el
   * nombre escrito sigue ahí para corregirlo o volver a mandarlo. */
  async function rename(name: string): Promise<void> {
    if ((await onRename(name)) === "done") {
      closeInto(renameRef);
    }
  }

  return (
    <header className="groups-panel-head">
      <div className="groups-panel-title">
        {mode === "renaming" ? (
          <RenameForm
            translate={translate}
            group={group}
            isDisabled={isDisabled}
            onSubmit={(name) => void rename(name)}
            onCancel={() => closeInto(renameRef)}
          />
        ) : (
          <h2>{group.name}</h2>
        )}
        <p className="groups-panel-summary">
          {describeSummary(translate, group, notActivatedCount)}
        </p>
      </div>
      {/* Mientras se renombra sólo quedan ✓ y ×: la papelera al lado del
          campo tiraba el nombre escrito con un mal toque. */}
      {mode === "renaming" ? null : (
        <div className="groups-panel-actions">
          <button
            ref={renameRef}
            type="button"
            className="groups-icon-button"
            aria-label={translate("groups.renameLabel", { name: group.name })}
            disabled={isDisabled}
            onClick={() => setMode("renaming")}
          >
            <Icon glyph={PencilSimple} />
          </button>
          <button
            ref={deleteRef}
            type="button"
            className="groups-icon-button groups-icon-button-danger"
            aria-label={translate("groups.deleteLabel", { name: group.name })}
            aria-expanded={mode === "confirmingDelete"}
            disabled={isDisabled}
            onClick={() => setMode("confirmingDelete")}
          >
            <Icon glyph={Trash} />
          </button>
        </div>
      )}
      {mode === "confirmingDelete" ? (
        <DeleteWarning
          translate={translate}
          group={group}
          isDisabled={isDisabled}
          isDeleting={isDeleting}
          onConfirm={onDelete}
          onCancel={() => closeInto(deleteRef)}
        />
      ) : null}
    </header>
  );
}
