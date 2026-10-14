"use client";

import { DownloadSimple } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { File as GenericFile } from "@phosphor-icons/react/dist/ssr/File";
import { FileDoc } from "@phosphor-icons/react/dist/ssr/FileDoc";
import { FileImage } from "@phosphor-icons/react/dist/ssr/FileImage";
import { FilePdf } from "@phosphor-icons/react/dist/ssr/FilePdf";
import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import { useState } from "react";
import { formatFileSize } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import {
  type NewsAttachmentKind,
  newsAttachmentKindOf,
} from "@/lib/news/news-attachment-kind";
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

const KIND_GLYPHS: Readonly<Record<NewsAttachmentKind, PhosphorGlyph>> = {
  pdf: FilePdf,
  image: FileImage,
  word: FileDoc,
  other: GenericFile,
};

const KIND_LABELS = {
  pdf: "news.post.fileKind.pdf",
  image: "news.post.fileKind.image",
  word: "news.post.fileKind.word",
  other: "news.post.fileKind.other",
} as const satisfies Record<NewsAttachmentKind, string>;

/** El icono del tipo, con su nombre: "PDF" dice algo que la extensión del
 * nombre no siempre deja claro al oído. Va el primero a la vista y el último
 * en el DOM, para que el botón se anuncie empezando por "Descargar". */
function AttachmentKindIcon({
  translate,
  contentType,
}: {
  readonly translate: Translator;
  readonly contentType: string;
}): React.JSX.Element {
  const kind = newsAttachmentKindOf(contentType);
  const Glyph = KIND_GLYPHS[kind];
  return (
    <Glyph
      className={`news-attachment-kind news-attachment-kind-${kind}`}
      role="img"
      aria-label={translate(KIND_LABELS[kind])}
    />
  );
}

/**
 * Los adjuntos de una publicación abierta (#329): tarjetas con el icono de su
 * tipo, su nombre, su tamaño y el de descargar (#596). Cada una es un botón
 * y no un enlace: la dirección firmada caduca en minutos (#328), así que se
 * pide al pulsar y el navegador va a ella.
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
              <span className="news-attachment-text">
                <span className="visually-hidden">
                  {translate("news.post.download")}
                </span>{" "}
                <span className="news-attachment-name">
                  {attachment.fileName}
                </span>{" "}
                <span className="news-attachment-size">
                  {formatFileSize(translate.locale, attachment.sizeBytes)}
                </span>
              </span>
              <AttachmentKindIcon
                translate={translate}
                contentType={attachment.contentType}
              />
              <DownloadSimple
                className="news-attachment-download"
                aria-hidden="true"
                focusable="false"
              />
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
