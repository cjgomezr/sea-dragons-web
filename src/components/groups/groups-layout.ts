import type { GroupsFailure } from "./groups-client";

/** Grupos tiene dos disposiciones (D13 de E32): el maestro–detalle desde
 * 1024 px y, por debajo, el flujo del móvil (#831), con la lista y la
 * pantalla del grupo una tras otra. */
export type GroupsLayout = "desktop" | "compact";

/** El id de la fila de un grupo en la lista: al volver de su pantalla en el
 * móvil, el foco vuelve a ella. */
export function groupRowId(groupId: string): string {
  return `group-row-${groupId}`;
}

/** Lo que el panel del grupo necesita en cada disposición. En el móvil es una
 * pantalla: lleva volver a la lista, y su hoja ⋯ dice dentro el fallo de lo
 * que se mandó desde ella. */
export type GroupPanelLayout =
  | { readonly kind: "desktop" }
  | {
      readonly kind: "compact";
      readonly failure: GroupsFailure | null;
      readonly onBack: () => void;
    };
