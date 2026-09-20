"use client";

import { useId, useState } from "react";
import { GROUP_NAME_MAX_LENGTH } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";

/**
 * El formulario de un nombre de grupo: el mismo para crear uno nuevo y para
 * renombrar el que ya existe, que es literalmente el mismo campo con otro
 * rótulo. El tope de caracteres es el del `check` de la base, así que el
 * campo no deja escribir un nombre que el servidor va a rechazar.
 */

/** Qué pasó con el nombre que se mandó. `done` vacía el campo (al crear) o
 * cierra el editor (al renombrar); `failed` lo deja todo puesto, para que
 * reintentar sea un clic. */
export type GroupActionResult = "done" | "failed";

export function GroupNameForm({
  translate,
  labelText,
  submitText,
  savingText,
  initialName,
  isDisabled,
  isSaving,
  onSubmit,
  onCancel,
}: {
  translate: Translator;
  labelText: string;
  submitText: string;
  savingText: string;
  initialName: string;
  /** Hay una acción en vuelo, sea esta o cualquier otra de la pantalla. */
  isDisabled: boolean;
  /** La que está en vuelo es justo la de este formulario. */
  isSaving: boolean;
  onSubmit: (name: string) => Promise<GroupActionResult>;
  onCancel?: () => void;
}): React.JSX.Element {
  const fieldId = useId();
  const [name, setName] = useState(initialName);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if ((await onSubmit(name)) === "done") {
      setName(initialName);
    }
  }

  return (
    <form className="groups-name-form" onSubmit={(event) => void submit(event)}>
      <div className="auth-field">
        <label htmlFor={fieldId}>{labelText}</label>
        <input
          id={fieldId}
          type="text"
          value={name}
          maxLength={GROUP_NAME_MAX_LENGTH}
          disabled={isDisabled}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="groups-actions">
        <button
          type="submit"
          className="auth-submit"
          disabled={isDisabled || name.trim() === ""}
        >
          {isSaving ? savingText : submitText}
        </button>
        {onCancel === undefined ? null : (
          <button
            type="button"
            className="admin-secondary"
            disabled={isDisabled}
            onClick={onCancel}
          >
            {translate("groups.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
