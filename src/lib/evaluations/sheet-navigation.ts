/**
 * Dónde está el jugador abierto dentro de la lista filtrada (#819, RF-3 del
 * PRD de E31): lo que dice la barra de arriba del panel ("{i} de {n} en esta
 * lista") y a quién llevan ‹ y ›, que se deshabilitan en los extremos.
 *
 * Si el abierto no pasa el filtro (se buscó otra cosa con él abierto), el
 * panel sigue con él y ‹ y › entran en la lista por sus extremos: siguiente
 * al primero, anterior al último.
 */

export type ListPosition =
  | {
      readonly kind: "listed";
      /** Desde 0. */
      readonly index: number;
      readonly count: number;
      readonly previousId: string | null;
      readonly nextId: string | null;
    }
  | {
      readonly kind: "unlisted";
      readonly previousId: string | null;
      readonly nextId: string | null;
    };

export function locateInList(
  listedIds: readonly string[],
  selectedId: string,
): ListPosition {
  const index = listedIds.indexOf(selectedId);
  if (index === -1) {
    return {
      kind: "unlisted",
      previousId: listedIds.at(-1) ?? null,
      nextId: listedIds[0] ?? null,
    };
  }
  return {
    kind: "listed",
    index,
    count: listedIds.length,
    previousId: listedIds[index - 1] ?? null,
    nextId: listedIds[index + 1] ?? null,
  };
}
