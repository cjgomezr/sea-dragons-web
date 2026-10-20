/**
 * El foco que no sale de una ventana. Nació en la hoja de abajo (#497); la
 * ventana de editar un equipo (#760) es la segunda que lo necesita, y por
 * eso vive aquí.
 */

const FOCUSABLE_SELECTOR = "select, input, button:not(:disabled), a[href]";

export function focusableIn(panel: HTMLElement | null): readonly HTMLElement[] {
  return panel === null
    ? []
    : [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

/** Tab desde el último control vuelve al primero, y Mayúsculas+Tab desde el
 * primero va al último. El `<dialog>` modal deja inerte la página, pero no
 * impide que el foco salga a la barra del navegador. */
export function cycleFocus(
  event: React.KeyboardEvent,
  panel: HTMLElement | null,
): void {
  if (event.key !== "Tab") {
    return;
  }
  const focusable = focusableIn(panel);
  const first = focusable.at(0);
  const last = focusable.at(-1);
  const edge = event.shiftKey ? first : last;
  if (edge === undefined || document.activeElement !== edge) {
    return;
  }
  event.preventDefault();
  (event.shiftKey ? last : first)?.focus();
}
