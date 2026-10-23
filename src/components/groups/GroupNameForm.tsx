"use client";

import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { useId, useState } from "react";
import { Icon } from "@/components/Icon";
import { GROUP_NAME_MAX_LENGTH } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";
import { isSameName } from "@/lib/text/name-search";

/**
 * La fila de crear un grupo, encima de la lista (#828, RF-2 de E32): el campo
 * y "+ Crear", y Enter también crea. El tope de caracteres es el del `check`
 * de la base, así que el campo no deja escribir un nombre que el servidor va
 * a rechazar.
 *
 * Un nombre que ya está en la lista se avisa mientras se escribe, sin mirar
 * mayúsculas ni tildes, y no se deja mandar. Es sólo una ayuda: quien decide
 * es el índice único de la base, y su `name_taken` sigue mandando.
 */

/** Qué pasó con el nombre que se mandó. `done` vacía el campo; `failed` lo
 * deja puesto, para que reintentar sea un clic. */
export type GroupActionResult = "done" | "failed";

export function GroupCreateForm({
  translate,
  takenNames,
  isDisabled,
  isSaving,
  onSubmit,
}: {
  translate: Translator;
  /** Los nombres de los grupos que ya hay. */
  takenNames: readonly string[];
  /** Hay una acción en vuelo, sea esta o cualquier otra de la pantalla. */
  isDisabled: boolean;
  /** La que está en vuelo es justo la de crear. */
  isSaving: boolean;
  onSubmit: (name: string) => Promise<GroupActionResult>;
}): React.JSX.Element {
  const duplicateId = useId();
  const [name, setName] = useState("");
  const isTaken = takenNames.some((taken) => isSameName(taken, name));
  const canSubmit = !isDisabled && !isTaken && name.trim() !== "";

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    // Se manda recortado, que es como lo guarda el servidor: si no, un fallo
    // dejaría el campo con espacios que no cuentan.
    if ((await onSubmit(name.trim())) === "done") {
      setName("");
    }
  }

  return (
    <form className="groups-create" onSubmit={(event) => void submit(event)}>
      <div className="groups-create-row">
        <input
          type="text"
          className="groups-create-field"
          value={name}
          maxLength={GROUP_NAME_MAX_LENGTH}
          placeholder={translate("groups.create.label")}
          aria-label={translate("groups.create.label")}
          aria-invalid={isTaken}
          aria-describedby={isTaken ? duplicateId : undefined}
          disabled={isDisabled}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="submit"
          className="groups-create-submit"
          disabled={!canSubmit}
        >
          <Icon glyph={Plus} weight="bold" />
          {/* En el móvil sólo se ve el +; el texto sigue siendo su nombre. */}
          <span className="groups-create-submit-text">
            {translate(
              isSaving ? "groups.create.saving" : "groups.create.submit",
            )}
          </span>
        </button>
      </div>
      {isTaken ? (
        <p id={duplicateId} className="groups-create-error">
          {translate("groups.create.duplicate")}
        </p>
      ) : null}
    </form>
  );
}
