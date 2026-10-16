import { type EventType, isEventType } from "@/lib/events/event-creation";

/**
 * Los chips de tipo de la agenda (#647, RF-6 y D8 del PRD de E24). El filtro
 * vive en la dirección, `?types=training,social`, para que recargar o volver
 * atrás deje el mismo. Sin el parámetro van todos; vacío, ninguno. Lo
 * desconocido se ignora, y si no queda nada válido van todos.
 *
 * No se lee con `readAgendaTypes` del servidor: allí vacío es "todos", y
 * aquí "ninguno" tiene que sobrevivir a una recarga.
 */

export const AGENDA_TYPES_QUERY_PARAM = "types";

/** Los chips en el orden del mockup, que también es el de la dirección. */
export const AGENDA_TYPE_CHIPS: readonly EventType[] = [
  "training",
  "competition",
  "social",
  "meeting",
];

const TYPES_SEPARATOR = ",";

/** Los tipos en el orden de los chips. */
function inChipOrder(types: ReadonlySet<EventType>): readonly EventType[] {
  return AGENDA_TYPE_CHIPS.filter((type) => types.has(type));
}

export function readAgendaTypeFilter(
  value: string | null,
): readonly EventType[] {
  if (value === null) {
    return AGENDA_TYPE_CHIPS;
  }
  if (value === "") {
    return [];
  }
  const known = new Set(value.split(TYPES_SEPARATOR).filter(isEventType));
  return known.size === 0 ? AGENDA_TYPE_CHIPS : inChipOrder(known);
}

export function toggleAgendaType(
  types: readonly EventType[],
  type: EventType,
): readonly EventType[] {
  const toggled = new Set(types);
  if (toggled.has(type)) {
    toggled.delete(type);
  } else {
    toggled.add(type);
  }
  return inChipOrder(toggled);
}

export function hasEveryAgendaType(types: readonly EventType[]): boolean {
  return types.length === AGENDA_TYPE_CHIPS.length;
}

/** La consulta de la dirección con el filtro escrito, sin tocar los demás
 * parámetros. Con todos los tipos se quita: es lo que se ve sin él. */
export function searchWithAgendaTypes(
  search: string,
  types: readonly EventType[],
): string {
  const params = new URLSearchParams(search);
  if (hasEveryAgendaType(types)) {
    params.delete(AGENDA_TYPES_QUERY_PARAM);
  } else {
    params.set(AGENDA_TYPES_QUERY_PARAM, types.join(TYPES_SEPARATOR));
  }
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

// Uno solo y no un `[]` nuevo cada vez: la vista lo tiene entre las
// dependencias de su efecto, y un array nuevo la haría pedir sin parar.
const EVERY_TYPE_REQUEST: readonly EventType[] = [];

/** Los tipos que se le piden a la API: ninguno cuando van todos, que es lo
 * que la API da por defecto. */
export function agendaRequestTypes(
  types: readonly EventType[],
): readonly EventType[] {
  return hasEveryAgendaType(types) ? EVERY_TYPE_REQUEST : types;
}
