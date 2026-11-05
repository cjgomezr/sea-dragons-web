import type { TrainingCycleRecord } from "./training-plan";

/**
 * Qué ciclos activos ve cada uno y cuál se abre al entrar (#979, D4, D5 y D6
 * del PRD de E38). La misma regla vive en la base (`0096`); aquí la aplica el
 * servidor, que lee con la llave de servicio para enseñar la cabecera a quien
 * no está al día.
 */

/** Quien planifica ve todos (D5); un socio, los de todo el club y los de sus
 * grupos (D4). */
export type CycleViewer =
  | { readonly kind: "planner" }
  | { readonly kind: "member"; readonly groupIds: readonly string[] };

function includesAnyGroup(
  cycle: TrainingCycleRecord,
  groupIds: readonly string[],
): boolean {
  return (
    cycle.audience.kind === "groups" &&
    cycle.audience.groups.some((group) => groupIds.includes(group.id))
  );
}

function isVisibleTo(cycle: TrainingCycleRecord, viewer: CycleViewer): boolean {
  if (viewer.kind === "planner" || cycle.audience.kind === "club") {
    return true;
  }
  return includesAnyGroup(cycle, viewer.groupIds);
}

function byName(a: TrainingCycleRecord, b: TrainingCycleRecord): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** Los que ve, por nombre: así los lista el selector del #981. */
export function cyclesVisibleTo(
  cycles: readonly TrainingCycleRecord[],
  viewer: CycleViewer,
): readonly TrainingCycleRecord[] {
  return cycles.filter((cycle) => isVisibleTo(cycle, viewer)).sort(byName);
}

/** Lo que pesa cada ciclo al elegir el de entrada: los de sus grupos, luego
 * el de todo el club, y al final los demás que vea quien planifica. */
const OWN_GROUP_RANK = 0;
const CLUB_RANK = 1;
const OTHER_RANK = 2;

function rankOf(
  cycle: TrainingCycleRecord,
  groupIds: readonly string[],
): number {
  if (includesAnyGroup(cycle, groupIds)) {
    return OWN_GROUP_RANK;
  }
  return cycle.audience.kind === "club" ? CLUB_RANK : OTHER_RANK;
}

/** El que se abre sin `?cycle` (D6), entre los que ya ve; el desempate es
 * el nombre. Nulo si no ve ninguno. */
export function defaultCycleOf(
  visible: readonly TrainingCycleRecord[],
  groupIds: readonly string[],
): TrainingCycleRecord | null {
  const ranked = [...visible].sort(
    (a, b) => rankOf(a, groupIds) - rankOf(b, groupIds) || byName(a, b),
  );
  return ranked[0] ?? null;
}
