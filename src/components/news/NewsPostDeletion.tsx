"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { NEWS_PATH } from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import { deleteNewsPost } from "./news-manage-client";
import { rememberDeletedNotice } from "./news-published-notice";

/**
 * Borrar para siempre una publicación retirada (#958), lo que comparten la
 * línea del autor en escritorio y la hoja ⋯ del móvil. La confirmación va en
 * línea y en color de peligro, como la de borrar un ciclo (#935): el foco
 * entra en Cancel, y Cancel o Escape la cierran. Al borrar se vuelve al
 * feed, que lo anuncia; si falla, la publicación sigue y se dice.
 */

export function DeleteConfirmation({
  translate,
  title,
  isSending,
  onConfirm,
  onCancel,
}: {
  readonly translate: Translator;
  readonly title: string;
  readonly isSending: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const questionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="groups-confirm news-post-confirm news-post-delete-confirm"
      role="group"
      aria-labelledby={questionId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onCancel();
        }
      }}
    >
      <p id={questionId} className="groups-question">
        {translate("news.post.deleteQuestion", { title })}
      </p>
      <div className="groups-actions">
        <button
          ref={cancelRef}
          type="button"
          className="admin-secondary"
          disabled={isSending}
          onClick={onCancel}
        >
          {translate("news.post.cancel")}
        </button>
        <button
          type="button"
          className="groups-danger"
          disabled={isSending}
          onClick={onConfirm}
        >
          {translate(
            isSending ? "news.post.deleting" : "news.post.deleteConfirm",
          )}
        </button>
      </div>
    </div>
  );
}

export type NewsPostDeletionState = {
  readonly isDeleting: boolean;
  readonly hasFailed: boolean;
  /** Borra y vuelve al feed. Devuelve si se borró. */
  readonly remove: () => Promise<boolean>;
  /** Quita el error del intento anterior, al volver a abrir la
   * confirmación. */
  readonly dismissFailure: () => void;
};

export function useNewsPostDeletion(postId: string): NewsPostDeletionState {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  // Un doble clic llega antes de que los botones se pinten desactivados.
  const isDeletingRef = useRef(false);

  async function remove(): Promise<boolean> {
    if (isDeletingRef.current) {
      return false;
    }
    isDeletingRef.current = true;
    setIsDeleting(true);
    setHasFailed(false);
    const outcome = await deleteNewsPost(postId);
    isDeletingRef.current = false;
    setIsDeleting(false);
    if (outcome.kind === "failed") {
      setHasFailed(true);
      return false;
    }
    rememberDeletedNotice();
    router.push(NEWS_PATH);
    return true;
  }

  return {
    isDeleting,
    hasFailed,
    remove,
    dismissFailure: () => setHasFailed(false),
  };
}
