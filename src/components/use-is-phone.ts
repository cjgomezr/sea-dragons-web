"use client";

import { useSyncExternalStore } from "react";

/**
 * Si la pantalla es la del móvil, el mismo corte que `@media (width < 768px)`
 * en la hoja de estilos. El directorio lo necesita en el código y no sólo en
 * la hoja (#554): por debajo, tocar una fila sube una hoja modal en vez de
 * abrir el panel lateral, y una hoja modal escondida con CSS seguiría dejando
 * inerte la página.
 *
 * En el servidor no hay pantalla: se pinta como escritorio, y el navegador
 * corrige al hidratar.
 */
const PHONE_QUERY = "(width < 768px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isPhoneNow(): boolean {
  return window.matchMedia(PHONE_QUERY).matches;
}

function isPhoneOnServer(): boolean {
  return false;
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, isPhoneNow, isPhoneOnServer);
}
