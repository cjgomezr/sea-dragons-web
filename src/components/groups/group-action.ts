/** La acción de la pantalla Grupos que está en vuelo. Es una sola para toda
 * la pantalla (D1 de E32): mientras se quita un socio no se crea ni se borra
 * nada, y un doble clic no manda dos. */
export type GroupAction =
  | { readonly kind: "create" }
  | { readonly kind: "rename" }
  | { readonly kind: "delete" }
  | { readonly kind: "assign" }
  | { readonly kind: "remove"; readonly userId: string };
