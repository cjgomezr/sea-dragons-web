"use client";

import { useEffect } from "react";

/**
 * Salir de la configuración del club con un borrador pregunta antes (#719,
 * D11 del PRD de E26). Cerrar o recargar la pestaña lo pregunta el
 * navegador con `beforeunload`. El App Router no avisa antes de navegar,
 * así que un clic en un enlace de la app que lleva a otra página se
 * intercepta en el documento, en la fase de captura: llega antes que el
 * `Link` de Next.js, y cancelar lo deja sin efecto.
 */

function isPlainLeftClick(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/** Si el clic sigue un enlace que cambia de página en esta misma pestaña.
 * Uno a otro sitio ya lo pregunta `beforeunload`. */
function isLeavingThroughAppLink(event: MouseEvent): boolean {
  if (event.defaultPrevented || !isPlainLeftClick(event)) {
    return false;
  }
  if (!(event.target instanceof Element)) {
    return false;
  }
  const link = event.target.closest("a[href]");
  if (!(link instanceof HTMLAnchorElement)) {
    return false;
  }
  const opensElsewhere = link.target !== "" && link.target !== "_self";
  if (opensElsewhere || link.hasAttribute("download")) {
    return false;
  }
  const destination = new URL(link.href, window.location.href);
  return (
    destination.origin === window.location.origin &&
    destination.pathname !== window.location.pathname
  );
}

export function useConfirmLeaving(hasDraft: boolean, question: string): void {
  useEffect(() => {
    if (!hasDraft) {
      return;
    }
    const warnBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    const confirmLeavingLink = (event: MouseEvent): void => {
      if (!isLeavingThroughAppLink(event) || window.confirm(question)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", confirmLeavingLink, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", confirmLeavingLink, true);
    };
  }, [hasDraft, question]);
}
