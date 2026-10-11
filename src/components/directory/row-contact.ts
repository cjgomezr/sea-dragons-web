import type {
  EmergencyContactView,
  MemberContactView,
} from "@/lib/directory/directory";

/**
 * El contacto de un socio en el directorio (#499, RF-3 del PRD de E19). Qué
 * trae lo decide el servidor según quien mira: Admin y Committee reciben el
 * correo, el teléfono y el contacto de emergencia; el Coach, sólo el de
 * emergencia, que es lo que necesita en la piscina. La lista no lo pinta
 * (#571): lo enseñan la ficha rápida y las acciones al deslizar la fila.
 */

/** Lo que una fila sabe del contacto, ya reducido a lo que su vista trae. */
export type RowContact =
  | { readonly kind: "none" }
  | ({ readonly kind: "emergency" } & EmergencyContactView)
  | ({ readonly kind: "full" } & MemberContactView);

/** El número tal como se marca: sin espacios, guiones ni paréntesis, con el
 * `+` del prefijo si lo trae. Se escribió así a propósito (#496): sólo se
 * limpia para el enlace. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
