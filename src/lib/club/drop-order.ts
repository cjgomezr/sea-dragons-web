/**
 * El orden que deja soltar una fila arrastrada por el asa (#725, RF-8 del
 * PRD de E26). Lo usan las posiciones y los packs: las primeras se
 * identifican por su id y los segundos por su número de sesiones.
 */

export type DropLineEdge = "before" | "after";

/** La lista con `activeId` en el puesto de `overId`, o nulo si soltarla ahí
 * no cambia nada: el mismo sitio, fuera de la lista o algo que no es de
 * ella. */
export function orderAfterDrop<Id>(
  order: readonly Id[],
  activeId: Id,
  overId: Id | null,
): readonly Id[] | null {
  const from = order.indexOf(activeId);
  const to = overId === null ? -1 : order.indexOf(overId);
  if (from === -1 || to === -1 || from === to) {
    return null;
  }
  const reordered = order.filter((id) => id !== activeId);
  reordered.splice(to, 0, activeId);
  return reordered;
}

/** Dónde va la línea que marca el destino en la fila `overId`: arriba si la
 * arrastrada sube, abajo si baja, y ninguna sobre su propio puesto. */
export function dropLineEdge<Id>(
  order: readonly Id[],
  activeId: Id,
  overId: Id,
): DropLineEdge | null {
  const from = order.indexOf(activeId);
  const to = order.indexOf(overId);
  if (from === -1 || to === -1 || from === to) {
    return null;
  }
  return to < from ? "before" : "after";
}
