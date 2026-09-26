"use client";

import { useState } from "react";
import { AttachmentIcon } from "@/components/NavIcons";
import { formatFileSize } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { NewsAttachmentSummary } from "@/lib/news/news-posts";
import {
  type NewsFailure,
  describeNewsFailure,
  requestNewsAttachment,
} from "./news-client";
import { startDownload } from "./start-download";

/** Lo que salió mal con la última descarga pedida. */
type DownloadNotice =
  | { readonly kind: "unavailable"; readonly fileName: string }
  | { readonly kind: "failed"; readonly failure: NewsFailure };

const LIST_TITLE_ID = "publicacion-adjuntos";

/**
 * Los adjuntos de una publicación abierta (#329), con su nombre y su tamaño.
 * Cada uno es un botón y no un enlace: la dirección firmada caduca en
 * minutos (#328), así que se pide al pulsar y el navegador va a ella.
 */
export function NewsAttachmentList({
  translate,
  postId,
  attachments,
}: {
  readonly translate: Translator;
  readonly postId: string;
  readonly attachments: readonly NewsAttachmentSummary[];
}): React.JSX.Element {
  const [notice, setNotice] = useState<DownloadNotice | null>(null);
  // El adjunto cuya dirección se está pidiendo. Se desactiva sólo ese botón:
  // otro toque en él no pide otra dirección ni navega dos veces.
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function download(attachmentId: string): Promise<void> {
    setNotice(null);
    setPendingId(attachmentId);
    const outcome = await requestNewsAttachment(postId, attachmentId);
    setPendingId(null);
    if (outcome.kind === "failed") {
      setNotice({ kind: "failed", failure: outcome });
      return;
    }
    if (outcome.download.status === "unavailable") {
      setNotice({
        kind: "unavailable",
        fileName: outcome.download.fileName,
      });
      return;
    }
    startDownload(outcome.download.url);
  }

  return (
    <section className="news-post-attachments" aria-labelledby={LIST_TITLE_ID}>
      <h2 id={LIST_TITLE_ID}>{translate("news.post.attachments")}</h2>
      <ul aria-labelledby={LIST_TITLE_ID}>
        {attachments.map((attachment) => (
          <li key={attachment.id}>
            <button
              type="button"
              className="news-attachment"
              onClick={() => void download(attachment.id)}
              disabled={pendingId === attachment.id}
            >
              <AttachmentIcon />
              <span className="visually-hidden">
                {translate("news.post.download")}
              </span>{" "}
              <span className="news-attachment-name">
                {attachment.fileName}
              </span>{" "}
              <span className="news-attachment-size">
                {formatFileSize(translate.locale, attachment.sizeBytes)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {notice === null ? null : (
        <p className="auth-error" role="alert">
          {notice.kind === "unavailable"
            ? translate("news.post.unavailable", { name: notice.fileName })
            : describeNewsFailure(
                translate,
                notice.failure,
                "news.post.error.unexpected",
              )}
        </p>
      )}
    </section>
  );
}
