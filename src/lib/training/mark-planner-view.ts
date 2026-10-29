import { isSameName } from "@/lib/text/name-search";
import type { ManagedMark } from "./club-marks";

/**
 * Lo que Planificar → Marcas (#911, RF-11 del PRD de E35) decide antes de
 * llamar a la API (#903), que lo vuelve a comprobar: cómo se borra una marca
 * y si un nombre ya lo tiene otra.
 */

/** Usada en una fila de rutina no se borra; sin usar y con valores, se
 * confirma diciendo sólo cuántos socios la registraron (D11). */
export type MarkDeletion =
  | { readonly kind: "inUse" }
  | { readonly kind: "immediate" }
  | { readonly kind: "confirm"; readonly membersRecorded: number };

export function markDeletion(mark: ManagedMark): MarkDeletion {
  if (mark.routineRows > 0) {
    return { kind: "inUse" };
  }
  if (mark.membersRecorded > 0) {
    return { kind: "confirm", membersRecorded: mark.membersRecorded };
  }
  return { kind: "immediate" };
}

/** Sin mayúsculas, tildes ni bordes, como la base (`0084`). La que se
 * renombra no choca consigo misma. */
export function isMarkNameTaken(
  marks: readonly ManagedMark[],
  name: string,
  renamingId?: string,
): boolean {
  return marks.some(
    (mark) => mark.id !== renamingId && isSameName(mark.name, name),
  );
}
