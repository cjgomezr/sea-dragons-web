import { useRef, useState } from "react";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import {
  type NewsPinDuration,
  newsPinEndDate,
} from "@/lib/news/news-pin-duration";
import { type PinAction, pinNewsPost, unpinNewsPost } from "./news-pin-client";

/**
 * Fijar y desfijar desde el feed (#595): qué tira está abierta, qué se está
 * guardando y qué falló. Solo cabe una tira abierta: abrir otra cierra la
 * anterior. Si fijar falla, la tira sigue abierta para volver a elegir.
 */

export type NewsPinning =
  | { readonly kind: "idle" }
  | { readonly kind: "choosing"; readonly postId: string }
  | {
      readonly kind: "saving";
      readonly postId: string;
      readonly action: PinAction;
    }
  | {
      readonly kind: "failed";
      readonly postId: string;
      readonly action: PinAction;
      readonly failure: ApiRequestFailure;
    };

/** Lo que una fila o la destacada necesitan saber de su publicación. */
export type PostPinning = {
  readonly isStripOpen: boolean;
  readonly isSaving: boolean;
  readonly failure: {
    readonly action: PinAction;
    readonly failure: ApiRequestFailure;
  } | null;
};

const IDLE: NewsPinning = { kind: "idle" };

export function pinningOf(pinning: NewsPinning, postId: string): PostPinning {
  if (pinning.kind === "idle" || pinning.postId !== postId) {
    return { isStripOpen: false, isSaving: false, failure: null };
  }
  const isPinStep = pinning.kind === "choosing" || pinning.action === "pin";
  return {
    isStripOpen: isPinStep,
    isSaving: pinning.kind === "saving",
    failure: pinning.kind === "failed" ? pinning : null,
  };
}

export function useNewsPinning({
  onPinned,
  onUnpinned,
}: {
  readonly onPinned: (postId: string, pinnedUntil: string | null) => void;
  readonly onUnpinned: () => void;
}): {
  readonly pinning: NewsPinning;
  readonly toggleStrip: (postId: string) => void;
  readonly closeStrip: () => void;
  readonly pin: (postId: string, duration: NewsPinDuration) => Promise<void>;
  readonly unpin: (postId: string) => Promise<void>;
} {
  const [pinning, setPinning] = useState<NewsPinning>(IDLE);
  // Un doble clic llega antes de que la pantalla se vuelva a pintar con los
  // botones desactivados: esto es lo que deja salir una sola petición.
  const isSaving = useRef(false);

  function toggleStrip(postId: string): void {
    setPinning((current) =>
      pinningOf(current, postId).isStripOpen
        ? IDLE
        : { kind: "choosing", postId },
    );
  }

  async function save(
    postId: string,
    action: PinAction,
    send: () => Promise<ApiRequestFailure | null>,
  ): Promise<void> {
    if (isSaving.current) {
      return;
    }
    isSaving.current = true;
    setPinning({ kind: "saving", postId, action });
    const failure = await send();
    isSaving.current = false;
    const settled: NewsPinning =
      failure === null ? IDLE : { kind: "failed", postId, action, failure };
    // Si mientras tanto se cerró la tira o se abrió la de otra fila, eso manda.
    setPinning((current) =>
      current.kind === "saving" && current.postId === postId
        ? settled
        : current,
    );
  }

  return {
    pinning,
    toggleStrip,
    closeStrip: () => setPinning(IDLE),
    pin: (postId, duration) =>
      save(postId, "pin", async () => {
        const outcome = await pinNewsPost(
          postId,
          newsPinEndDate(duration, new Date()),
        );
        if (outcome.kind === "failed") {
          return outcome;
        }
        onPinned(postId, outcome.pinnedUntil);
        return null;
      }),
    unpin: (postId) =>
      save(postId, "unpin", async () => {
        const outcome = await unpinNewsPost(postId);
        if (outcome.kind === "failed") {
          return outcome;
        }
        onUnpinned();
        return null;
      }),
  };
}
