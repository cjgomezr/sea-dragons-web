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

/** Evaluaciones usa el diseño del móvil también en la tableta (D12 de E31):
 * la lista con la ficha al lado sólo cabe desde 1024 px. */
const BELOW_DESKTOP_QUERY = "(width < 1024px)";

function subscribeTo(mediaQuery: string): (onChange: () => void) => () => void {
  return (onChange) => {
    const query = window.matchMedia(mediaQuery);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  };
}

const subscribe = subscribeTo(PHONE_QUERY);
const subscribeBelowDesktop = subscribeTo(BELOW_DESKTOP_QUERY);

/** Si lo es ahora mismo, sin seguir los cambios: para quien sólo se monta
 * en el navegador y elige su forma una vez, al abrirse. */
export function isPhoneNow(): boolean {
  return window.matchMedia(PHONE_QUERY).matches;
}

function isBelowDesktopNow(): boolean {
  return window.matchMedia(BELOW_DESKTOP_QUERY).matches;
}

function isNarrowOnServer(): boolean {
  return false;
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, isPhoneNow, isNarrowOnServer);
}

/** Como `useIsPhone`, con el corte de 1024 px. */
export function useIsBelowDesktop(): boolean {
  return useSyncExternalStore(
    subscribeBelowDesktop,
    isBelowDesktopNow,
    isNarrowOnServer,
  );
}

function isUnknownOnServer(): null {
  return null;
}

/** Como `useIsPhone`, pero sin adivinar: null en el servidor y al hidratar,
 * para quien prefiere pintar los dos tamaños y que la hoja de estilos esconda
 * el que sobra hasta saberlo (#717). */
export function useIsPhoneOnceKnown(): boolean | null {
  return useSyncExternalStore(subscribe, isPhoneNow, isUnknownOnServer);
}
