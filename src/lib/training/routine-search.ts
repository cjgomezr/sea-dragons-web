import { matchesNameSearch } from "@/lib/text/name-search";
import type { ManagedRoutine } from "./club-routines";

/** La búsqueda de Planificar → Rutinas (#945): las que se llaman como el
 * texto, sin mayúsculas ni tildes y en su orden. En blanco, todas. */
export function filterRoutinesByName(
  routines: readonly ManagedRoutine[],
  search: string,
): readonly ManagedRoutine[] {
  const text = search.trim();
  if (text === "") {
    return routines;
  }
  return routines.filter((routine) => matchesNameSearch(routine.name, text));
}
