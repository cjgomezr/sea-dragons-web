import { useEffect, useRef, useState } from "react";
import { formatClubShortDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import {
  type NewsPinDuration,
  newsPinEndDate,
} from "@/lib/news/news-pin-duration";
import type { NewsPostDetail, NewsPostStatus } from "@/lib/news/news-posts";
import { loadNewsFeed } from "./news-client";
import { changeNewsStatus } from "./news-manage-client";
import {
  describePinFailure,
  pinNewsPost,
  unpinNewsPost,
} from "./news-pin-client";

/**
 * Lo que hace la hoja ⋯ de la publicación en el móvil (#601): fijar,
 * desfijar, retirar y volver a publicar. Cada acción acaba en la publicación
 * que dejó el servidor y en la frase que se anuncia, o en el error que la
 * hoja enseña sin cerrarse. Nada cambia en pantalla hasta que el servidor
 * responde.
 */

export type SheetOutcome =
  | {
      readonly kind: "done";
      readonly post: NewsPostDetail;
      readonly announcement: string;
    }
  | { readonly kind: "failed"; readonly message: string };

const STATUS_ANNOUNCEMENTS = {
  withdrawn: "news.post.announce.withdrawn",
  published: "news.post.announce.published",
} as const;

const STATUS_FAILURES = {
  withdrawn: "news.post.error.withdraw",
  published: "news.post.error.republish",
} as const;

function describePinned(
  translate: Translator,
  pinnedUntil: string | null,
): string {
  if (pinnedUntil === null) {
    return translate("news.post.announce.pinned");
  }
  return translate("news.post.announce.pinnedUntil", {
    date: formatClubShortDay(translate.locale, new Date(pinnedUntil)),
  });
}

export async function pinFromSheet(
  translate: Translator,
  post: NewsPostDetail,
  duration: NewsPinDuration,
): Promise<SheetOutcome> {
  const outcome = await pinNewsPost(
    post.id,
    newsPinEndDate(duration, new Date()),
  );
  if (outcome.kind === "failed") {
    return {
      kind: "failed",
      message: describePinFailure(translate, "pin", outcome),
    };
  }
  return {
    kind: "done",
    post: { ...post, isPinned: true, pinnedUntil: outcome.pinnedUntil },
    announcement: describePinned(translate, outcome.pinnedUntil),
  };
}

export async function unpinFromSheet(
  translate: Translator,
  post: NewsPostDetail,
): Promise<SheetOutcome> {
  const outcome = await unpinNewsPost(post.id);
  if (outcome.kind === "failed") {
    return {
      kind: "failed",
      message: describePinFailure(translate, "unpin", outcome),
    };
  }
  return {
    kind: "done",
    post: { ...post, isPinned: false, pinnedUntil: null },
    announcement: translate("news.post.announce.unpinned"),
  };
}

export async function changeStatusFromSheet(
  translate: Translator,
  post: NewsPostDetail,
  status: NewsPostStatus,
): Promise<SheetOutcome> {
  const outcome = await changeNewsStatus(post.id, status);
  if (outcome.kind === "failed") {
    return { kind: "failed", message: translate(STATUS_FAILURES[status]) };
  }
  return {
    kind: "done",
    post: outcome.post,
    announcement: translate(STATUS_ANNOUNCEMENTS[status]),
  };
}

/** Manda una acción cada vez y, si sale bien, entrega el resultado y cierra
 * la hoja. Si falla, la hoja sigue abierta con el error. */
export function useSheetRequest({
  onDone,
  close,
}: {
  readonly onDone: (post: NewsPostDetail, announcement: string) => void;
  readonly close: () => void;
}): {
  readonly isSending: boolean;
  readonly failure: string | null;
  readonly run: (request: () => Promise<SheetOutcome>) => Promise<void>;
} {
  const [isSending, setIsSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Un doble toque llega antes de que la hoja se vuelva a pintar con los
  // botones desactivados: esto es lo que deja salir una sola petición.
  const isSendingRef = useRef(false);

  async function run(request: () => Promise<SheetOutcome>): Promise<void> {
    if (isSendingRef.current) {
      return;
    }
    isSendingRef.current = true;
    setIsSending(true);
    setFailure(null);
    const outcome = await request();
    isSendingRef.current = false;
    setIsSending(false);
    if (outcome.kind === "failed") {
      setFailure(outcome.message);
      return;
    }
    onDone(outcome.post, outcome.announcement);
    close();
  }

  return { isSending, failure, run };
}

/** Si fijar esta quitaría otra (D1: una sola por club), lo dice la fijada
 * del feed, que se pide una vez al abrir la hoja y sólo si quien mira puede
 * fijar y esta no lo está. Si el feed no llega, la hoja no avisa: fijar
 * sigue funcionando y el aviso es sólo una pista. */
export function useReplacesPinned(post: NewsPostDetail): boolean {
  const shouldCheck = post.canPin && !post.isPinned;
  const [replacesPinned, setReplacesPinned] = useState(false);

  useEffect(() => {
    if (!shouldCheck) {
      return;
    }
    let isCurrent = true;
    void loadNewsFeed(null).then((outcome) => {
      if (isCurrent && outcome.kind === "loaded") {
        const { pinned } = outcome.page;
        setReplacesPinned(pinned !== null && pinned.id !== post.id);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [shouldCheck, post.id]);

  return shouldCheck && replacesPinned;
}
