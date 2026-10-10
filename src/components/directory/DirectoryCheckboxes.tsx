"use client";

import { useEffect, useRef } from "react";
import type { Translator } from "@/lib/i18n/translator";
import type { CheckedMembers } from "./use-checked-members";

/**
 * Las casillas de la lista del directorio (#552, RF-6 del PRD de E21): una
 * por fila y, en el encabezado, la de marcar a todos los de la vista. Son
 * controles de la fila, así que pulsarlas no la selecciona ni abre el panel.
 * Las tiene sólo quien puede hacer algo con los marcados.
 */

/** Lo que una fila sabe de las casillas: `null` sin ellas. */
export type RowChecking = Pick<
  CheckedMembers,
  "isChecked" | "toggle" | "toggleAll"
> & {
  readonly checkedCount: number;
  readonly visibleCount: number;
};

export function SelectAllHeader({
  translate,
  checking,
}: {
  translate: Translator;
  checking: RowChecking;
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  const isAllChecked =
    checking.visibleCount > 0 &&
    checking.checkedCount === checking.visibleCount;
  const isPartlyChecked = checking.checkedCount > 0 && !isAllChecked;

  // `indeterminate` no tiene atributo: sólo se pone desde el DOM.
  useEffect(() => {
    if (ref.current !== null) {
      ref.current.indeterminate = isPartlyChecked;
    }
  }, [isPartlyChecked]);

  return (
    <th scope="col" className="directory-check-cell">
      <input
        ref={ref}
        type="checkbox"
        className="directory-check"
        aria-label={translate("directory.check.all")}
        checked={isAllChecked}
        onChange={checking.toggleAll}
      />
    </th>
  );
}

export function MemberCheckCell({
  translate,
  checking,
  userId,
  fullName,
}: {
  translate: Translator;
  checking: RowChecking;
  userId: string;
  fullName: string;
}): React.JSX.Element {
  return (
    <td className="directory-check-cell">
      <input
        type="checkbox"
        className="directory-check"
        aria-label={translate("directory.check.member", { name: fullName })}
        checked={checking.isChecked(userId)}
        onChange={() => checking.toggle(userId)}
      />
    </td>
  );
}
