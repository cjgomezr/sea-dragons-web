import { type NewsPinDuration, newsPinEndDate } from "./news-pin-duration";
import type { NewsPinChange } from "./news-pins";

/**
 * La caja de fijar del formulario (#599, RF-8 del PRD de E22), sin pantalla
 * delante. Tiene tres estados y no un booleano con una duración opcional:
 * apagada, encendida con el fijado que la publicación ya traía, o encendida
 * con una duración elegida aquí. Distinguir los dos últimos es lo que deja
 * guardar una edición sin tocar el fijado (#592: sin `pin`, no cambia).
 */

export type NewsPinChoice =
  | { readonly kind: "off" }
  | { readonly kind: "current"; readonly until: string | null }
  | { readonly kind: "chosen"; readonly duration: NewsPinDuration };

/** La que propone el diseño al encender la caja. */
export const DEFAULT_NEWS_PIN_DURATION: NewsPinDuration = "twoWeeks";

export const NEWS_PIN_OFF: NewsPinChoice = { kind: "off" };

/** El fijado vigente de la publicación, o ninguno si es nueva. */
export type NewsPinState = {
  readonly isPinned: boolean;
  readonly pinnedUntil: string | null;
};

export function initialNewsPinChoice(state: NewsPinState): NewsPinChoice {
  return state.isPinned
    ? { kind: "current", until: state.pinnedUntil }
    : NEWS_PIN_OFF;
}

/** Al volver a encenderla recupera el fijado que traía, si lo tenía. */
export function toggleNewsPinChoice(
  choice: NewsPinChoice,
  initial: NewsPinChoice,
): NewsPinChoice {
  if (choice.kind !== "off") {
    return NEWS_PIN_OFF;
  }
  return initial.kind === "off"
    ? { kind: "chosen", duration: DEFAULT_NEWS_PIN_DURATION }
    : initial;
}

/** La duración marcada. Un fijado heredado con fecha no coincide con
 * ninguna: se contó desde otro día. */
export function selectedNewsPinDuration(
  choice: NewsPinChoice,
): NewsPinDuration | null {
  if (choice.kind === "chosen") {
    return choice.duration;
  }
  return choice.kind === "current" && choice.until === null
    ? "untilUnpinned"
    : null;
}

/** Hasta cuándo quedaría fijada (nula: hasta que la desfijen). */
export function newsPinChoiceEnd(
  choice: Exclude<NewsPinChoice, { readonly kind: "off" }>,
  now: Date,
): string | null {
  return choice.kind === "current"
    ? choice.until
    : newsPinEndDate(choice.duration, now);
}

/** Lo que publicar o editar hacen con el fijado. Apagar la caja de una que
 * no estaba fijada no es desfijar: no hay nada que mandar. */
export function newsPinChangeOf(
  choice: NewsPinChoice,
  context: { readonly wasPinned: boolean; readonly now: Date },
): NewsPinChange {
  switch (choice.kind) {
    case "off":
      return context.wasPinned ? { kind: "unpin" } : { kind: "keep" };
    case "current":
      return { kind: "keep" };
    case "chosen":
      return {
        kind: "pin",
        until: newsPinEndDate(choice.duration, context.now),
      };
  }
}
