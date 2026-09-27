"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { NEWS_EDIT_PATH } from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import type { NewsPostDetail, NewsPostStatus } from "@/lib/news/news-posts";
import { changeNewsStatus } from "./news-manage-client";

/**
 * Editar, retirar y volver a publicar desde la publicación abierta (#331).
 * Sólo se pintan si el servidor dice que quien mira puede (`canManage`); el
 * servidor lo vuelve a comprobar en cada acción.
 *
 * Retirar pide confirmación, porque afecta a lo que ya vio el club. Volver a
 * publicar no: deshace lo anterior y no avisa a nadie. Nada cambia en
 * pantalla hasta que el servidor responde.
 */

type ActionState =
  | { readonly kind: "idle" }
  | { readonly kind: "confirmingWithdrawal" }
  | { readonly kind: "sending"; readonly status: NewsPostStatus }
  | { readonly kind: "failed"; readonly status: NewsPostStatus };

const FAILURE_MESSAGES = {
  withdrawn: "news.post.error.withdraw",
  published: "news.post.error.republish",
} as const;

function WithdrawConfirmation({
  translate,
  isSending,
  onConfirm,
  onCancel,
}: {
  readonly translate: Translator;
  readonly isSending: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  return (
    <div className="groups-confirm news-post-confirm">
      <p className="groups-question">
        {translate("news.post.withdrawQuestion")}
      </p>
      <div className="groups-actions">
        <button
          type="button"
          className="groups-danger"
          disabled={isSending}
          onClick={onConfirm}
        >
          {translate(
            isSending ? "news.post.withdrawing" : "news.post.withdrawConfirm",
          )}
        </button>
        <button
          type="button"
          className="admin-secondary"
          disabled={isSending}
          onClick={onCancel}
        >
          {translate("news.post.cancel")}
        </button>
      </div>
    </div>
  );
}

export function NewsPostActions({
  translate,
  post,
  onChanged,
}: {
  readonly translate: Translator;
  readonly post: NewsPostDetail;
  readonly onChanged: (post: NewsPostDetail) => void;
}): React.JSX.Element {
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  // El estado desactiva los botones en el siguiente pintado, pero un doble
  // clic llega antes. La referencia cambia en el acto.
  const isSendingRef = useRef(false);

  async function changeStatus(status: NewsPostStatus): Promise<void> {
    if (isSendingRef.current) {
      return;
    }
    isSendingRef.current = true;
    setState({ kind: "sending", status });
    const result = await changeNewsStatus(post.id, status);
    isSendingRef.current = false;
    if (result.kind === "failed") {
      setState({ kind: "failed", status });
      return;
    }
    setState({ kind: "idle" });
    onChanged(result.post);
  }

  const isSending = state.kind === "sending";
  const isWithdrawn = post.status === "withdrawn";
  const isConfirming =
    state.kind === "confirmingWithdrawal" ||
    (isSending && state.status === "withdrawn");

  return (
    <div className="news-post-actions">
      <div className="groups-actions">
        <Link
          href={NEWS_EDIT_PATH.replace("[id]", encodeURIComponent(post.id))}
          className="admin-secondary"
        >
          {translate("news.post.edit")}
        </Link>
        {isWithdrawn ? (
          <button
            type="button"
            className="admin-secondary"
            disabled={isSending}
            onClick={() => void changeStatus("published")}
          >
            {translate(
              isSending ? "news.post.republishing" : "news.post.republish",
            )}
          </button>
        ) : (
          <button
            type="button"
            className="admin-secondary"
            disabled={isSending || isConfirming}
            aria-expanded={isConfirming}
            onClick={() => setState({ kind: "confirmingWithdrawal" })}
          >
            {translate("news.post.withdraw")}
          </button>
        )}
      </div>
      {isConfirming && !isWithdrawn ? (
        <WithdrawConfirmation
          translate={translate}
          isSending={isSending}
          onConfirm={() => void changeStatus("withdrawn")}
          onCancel={() => setState({ kind: "idle" })}
        />
      ) : null}
      {state.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {translate(FAILURE_MESSAGES[state.status])}
        </p>
      ) : null}
    </div>
  );
}
