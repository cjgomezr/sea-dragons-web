"use client";

import { useState } from "react";
import type { DirectoryMember } from "@/lib/directory/directory";

/**
 * Los socios marcados con las casillas de la lista (#552). Sólo cuentan los
 * que siguen a la vista: un filtro nuevo esconde a un marcado y la barra deja
 * de contarlo, sin que nadie tenga que acordarse de desmarcarlo.
 */

export type CheckedMembers = {
  /** Los marcados que están en la lista, en el orden de la lista. */
  readonly members: readonly DirectoryMember[];
  readonly isChecked: (userId: string) => boolean;
  readonly toggle: (userId: string) => void;
  /** Marca a todos los de la lista o, si ya lo estaban, los desmarca. */
  readonly toggleAll: () => void;
  readonly clear: () => void;
};

const NOBODY: ReadonlySet<string> = new Set();

export function useCheckedMembers(
  visibleMembers: readonly DirectoryMember[],
): CheckedMembers {
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(NOBODY);
  const members = visibleMembers.filter((member) =>
    checkedIds.has(member.userId),
  );

  function toggle(userId: string): void {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (!next.delete(userId)) {
        next.add(userId);
      }
      return next;
    });
  }

  function toggleAll(): void {
    setCheckedIds(
      members.length === visibleMembers.length
        ? NOBODY
        : new Set(visibleMembers.map((member) => member.userId)),
    );
  }

  return {
    members,
    isChecked: (userId) => checkedIds.has(userId),
    toggle,
    toggleAll,
    clear: () => setCheckedIds(NOBODY),
  };
}
