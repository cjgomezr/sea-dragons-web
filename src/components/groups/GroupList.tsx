"use client";

import { useState } from "react";
import type { Group } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";
import { type GroupActionResult, GroupNameForm } from "./GroupNameForm";
import { usePendingAction } from "./use-pending-action";

/**
 * La lista de grupos del club con su conteo, y lo que se hace con ella: crear
 * uno, renombrarlo, borrarlo y abrirlo para ver sus socios (RF-2 a RF-5 del
 * PRD de E4).
 *
 * Quién decide de verdad es el servidor. Aquí sólo se manda la acción y se
 * espera: mientras una está en vuelo ninguna otra sale, así que un doble clic
 * no puede mandar dos, y nada entra ni sale de la lista sin que el servidor lo
 * haya confirmado.
 */

/** Qué está abierto en una fila, además del grupo: renombrarlo pide un campo
 * y borrarlo pide confirmación, y las dos cosas viven dentro de su fila. */
type RowEditor = {
  readonly groupId: string;
  readonly kind: "rename" | "delete";
};

type PendingGroupAction =
  | { readonly kind: "create" }
  | { readonly kind: "rename"; readonly groupId: string }
  | { readonly kind: "delete"; readonly groupId: string };

function DeleteConfirmation({
  translate,
  group,
  isDisabled,
  isDeleting,
  onConfirm,
  onCancel,
}: {
  translate: Translator;
  group: Group;
  isDisabled: boolean;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <div className="groups-confirm">
      <p className="groups-question">
        {translate("groups.deleteQuestion", {
          name: group.name,
          count: group.memberCount,
        })}
      </p>
      <div className="groups-actions">
        <button
          type="button"
          className="groups-danger"
          disabled={isDisabled}
          onClick={onConfirm}
        >
          {translate(isDeleting ? "groups.deleting" : "groups.deleteSubmit")}
        </button>
        <button
          type="button"
          className="admin-secondary"
          disabled={isDisabled}
          onClick={onCancel}
        >
          {translate("groups.cancel")}
        </button>
      </div>
    </div>
  );
}

function GroupRow({
  translate,
  group,
  isOpen,
  editor,
  pending,
  onOpen,
  onEdit,
  onRename,
  onDelete,
}: {
  translate: Translator;
  group: Group;
  isOpen: boolean;
  /** El editor abierto en ESTA fila, si lo hay. */
  editor: RowEditor["kind"] | null;
  pending: PendingGroupAction | null;
  onOpen: () => void;
  onEdit: (editor: RowEditor | null) => void;
  onRename: (name: string) => Promise<GroupActionResult>;
  onDelete: () => void;
}): React.JSX.Element {
  const isDisabled = pending !== null;
  const isTargetRow =
    pending !== null &&
    pending.kind !== "create" &&
    pending.groupId === group.id;
  return (
    <li className="groups-item" aria-label={group.name}>
      <div className="groups-item-head">
        <button
          type="button"
          className="groups-open"
          aria-expanded={isOpen}
          disabled={isDisabled}
          onClick={onOpen}
        >
          {group.name}
        </button>
        <span className="groups-count">
          {translate("groups.memberCount", { count: group.memberCount })}
        </span>
        <button
          type="button"
          className="admin-secondary"
          aria-label={translate("groups.renameLabel", { name: group.name })}
          disabled={isDisabled}
          onClick={() => onEdit({ groupId: group.id, kind: "rename" })}
        >
          {translate("groups.rename")}
        </button>
        <button
          type="button"
          className="admin-secondary"
          aria-label={translate("groups.deleteLabel", { name: group.name })}
          disabled={isDisabled}
          onClick={() => onEdit({ groupId: group.id, kind: "delete" })}
        >
          {translate("groups.delete")}
        </button>
      </div>
      {editor === "rename" ? (
        <GroupNameForm
          translate={translate}
          labelText={translate("groups.renameField", { name: group.name })}
          submitText={translate("groups.renameSubmit")}
          savingText={translate("groups.renameSaving")}
          initialName={group.name}
          isDisabled={isDisabled}
          isSaving={isTargetRow && pending?.kind === "rename"}
          onSubmit={onRename}
          onCancel={() => onEdit(null)}
        />
      ) : null}
      {editor === "delete" ? (
        <DeleteConfirmation
          translate={translate}
          group={group}
          isDisabled={isDisabled}
          isDeleting={isTargetRow && pending?.kind === "delete"}
          onConfirm={onDelete}
          onCancel={() => onEdit(null)}
        />
      ) : null}
    </li>
  );
}

export function GroupList({
  translate,
  groups,
  notice,
  openGroupId,
  onOpen,
  onCreate,
  onRename,
  onDelete,
}: {
  translate: Translator;
  groups: readonly Group[];
  /** El aviso de la última acción que no salió, ya en el idioma de la
   * pantalla. */
  notice: string | null;
  openGroupId: string | null;
  onOpen: (group: Group) => void;
  onCreate: (name: string) => Promise<GroupActionResult>;
  onRename: (group: Group, name: string) => Promise<GroupActionResult>;
  onDelete: (group: Group) => Promise<GroupActionResult>;
}): React.JSX.Element {
  const [editor, setEditor] = useState<RowEditor | null>(null);
  const { pending, run } = usePendingAction<PendingGroupAction>();

  async function create(name: string): Promise<GroupActionResult> {
    return (await run({ kind: "create" }, () => onCreate(name))) ?? "failed";
  }

  /** El editor se cierra sólo cuando el servidor confirmó: si dijo que no, el
   * nombre escrito sigue ahí para corregirlo o volver a mandarlo. */
  async function rename(
    group: Group,
    name: string,
  ): Promise<GroupActionResult> {
    const result = await run({ kind: "rename", groupId: group.id }, () =>
      onRename(group, name),
    );
    if (result === "done") {
      setEditor(null);
    }
    return result ?? "failed";
  }

  function remove(group: Group): void {
    void run({ kind: "delete", groupId: group.id }, async () => {
      if ((await onDelete(group)) === "done") {
        setEditor(null);
      }
    });
  }

  return (
    <section className="admin-section" aria-labelledby="grupos-del-club">
      <h2 id="grupos-del-club">{translate("groups.list.title")}</h2>
      <GroupNameForm
        translate={translate}
        labelText={translate("groups.create.label")}
        submitText={translate("groups.create.submit")}
        savingText={translate("groups.create.saving")}
        initialName=""
        isDisabled={pending !== null}
        isSaving={pending?.kind === "create"}
        onSubmit={create}
      />
      {notice === null ? null : (
        <p className="auth-error" role="alert">
          {notice}
        </p>
      )}
      {groups.length === 0 ? (
        <p className="admin-empty">{translate("groups.list.empty")}</p>
      ) : (
        <ul className="groups-items">
          {groups.map((group) => (
            <GroupRow
              key={group.id}
              translate={translate}
              group={group}
              isOpen={group.id === openGroupId}
              editor={editor?.groupId === group.id ? editor.kind : null}
              pending={pending}
              onOpen={() => onOpen(group)}
              onEdit={setEditor}
              onRename={(name) => rename(group, name)}
              onDelete={() => remove(group)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
