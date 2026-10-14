import { useState } from "react";
import {
  type NewsPinChoice,
  type NewsPinState,
  initialNewsPinChoice,
  newsPinChangeOf,
  toggleNewsPinChoice,
} from "@/lib/news/news-pin-choice";
import type { NewsPinDuration } from "@/lib/news/news-pin-duration";
import type { NewsPinChange } from "@/lib/news/news-pins";

/**
 * El estado de la caja de fijar del formulario (#599). Lo que se manda al
 * guardar se calcula entonces, con la hora de entonces: la fecha de fin se
 * cuenta desde que se publica, no desde que se abrió el formulario.
 */

/** La publicación que se edita, o `null` si es nueva. */
export type PinnedPost = NewsPinState & { readonly id: string };

/** La fijada vigente del club, si hay. */
export type PinnedNow = { readonly id: string; readonly title: string };

export type NewsPinChoiceControls = {
  readonly choice: NewsPinChoice;
  /** La otra fijada que fijar esta reemplazaría, si la caja está encendida. */
  readonly replacedTitle: string | null;
  readonly onToggle: () => void;
  readonly onChoose: (duration: NewsPinDuration) => void;
  readonly changeAt: (now: Date) => NewsPinChange;
};

const NOT_PINNED: NewsPinState = { isPinned: false, pinnedUntil: null };

function replacedTitleOf(
  choice: NewsPinChoice,
  pinnedNow: PinnedNow | null,
  post: PinnedPost | null,
): string | null {
  if (choice.kind === "off" || pinnedNow === null) {
    return null;
  }
  return pinnedNow.id === post?.id ? null : pinnedNow.title;
}

export function useNewsPinChoice(
  post: PinnedPost | null,
  pinnedNow: PinnedNow | null,
): NewsPinChoiceControls {
  const [initial] = useState(() => initialNewsPinChoice(post ?? NOT_PINNED));
  const [choice, setChoice] = useState<NewsPinChoice>(initial);
  return {
    choice,
    replacedTitle: replacedTitleOf(choice, pinnedNow, post),
    onToggle: () =>
      setChoice((current) => toggleNewsPinChoice(current, initial)),
    onChoose: (duration) => setChoice({ kind: "chosen", duration }),
    changeAt: (now) =>
      newsPinChangeOf(choice, { wasPinned: initial.kind !== "off", now }),
  };
}
