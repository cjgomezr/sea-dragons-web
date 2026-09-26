"use client";

import { useRef } from "react";
import { AttachmentIcon } from "@/components/NavIcons";
import { formatFileSize } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import {
  describeAttachmentIssue,
  describeAttachmentsHint,
  describePublishFailure,
} from "./news-publish-client";
import type {
  AttachmentEntry,
  AttachmentNotice,
  NewsAttachments,
} from "./use-news-attachments";

/**
 * Los adjuntos del formulario de publicar (#330): el botón que los elige, la
 * lista de lo subido y de lo que se está subiendo, y por qué no valió lo que
 * no valió. Lo que se sube lo lleva `useNewsAttachments`.
 */

const LEGEND_ID = "publicar-adjuntos";
const HINT_ID = "publicar-adjuntos-pista";

/** Los que admite el servidor (#328). Sólo filtra el selector del sistema:
 * quien decide es el servidor, mirando los bytes. */
const ACCEPTED_FILES = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx";

function describeNoticeReason(
  translate: Translator,
  notice: AttachmentNotice,
): string {
  switch (notice.kind) {
    case "rejected":
      return describeAttachmentIssue(translate, notice.code);
    case "uploadFailed":
      return describePublishFailure(translate, notice.failure);
    case "removeFailed":
      return translate("news.publish.attachments.removeFailed");
  }
}

function describeNotice(
  translate: Translator,
  notice: AttachmentNotice,
): string {
  return translate("news.publish.attachments.notice", {
    name: notice.fileName,
    reason: describeNoticeReason(translate, notice),
  });
}

function AttachmentRow({
  translate,
  entry,
  onRemove,
}: {
  readonly translate: Translator;
  readonly entry: AttachmentEntry;
  readonly onRemove: (key: string) => void;
}): React.JSX.Element {
  if (entry.kind === "uploading") {
    return (
      <li className="news-attachment news-publish-attachment">
        <AttachmentIcon />
        <span className="news-attachment-name">{entry.fileName}</span>
        <span className="news-attachment-size" role="status">
          {translate("news.publish.attachments.uploading")}
        </span>
      </li>
    );
  }
  const { fileName, sizeBytes } = entry.upload;
  return (
    <li className="news-attachment news-publish-attachment">
      <AttachmentIcon />
      <span className="news-attachment-name">{fileName}</span>
      <span className="news-attachment-size">
        {formatFileSize(translate.locale, sizeBytes)}
      </span>
      <button
        type="button"
        className="admin-secondary"
        disabled={entry.isRemoving}
        onClick={() => onRemove(entry.key)}
        // Empieza por el texto visible, así que quien lo pide por voz lo
        // encuentra, y el nombre dice cuál de los adjuntos se quita.
        aria-label={translate("news.publish.attachments.removeNamed", {
          name: fileName,
        })}
      >
        {translate("news.publish.attachments.remove")}
      </button>
    </li>
  );
}

export function NewsAttachmentsField({
  translate,
  attachments,
}: {
  readonly translate: Translator;
  readonly attachments: NewsAttachments;
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);

  function choose(event: React.ChangeEvent<HTMLInputElement>): void {
    const files = [...(event.target.files ?? [])];
    // Vaciarlo deja volver a elegir el mismo archivo después de quitarlo.
    event.target.value = "";
    attachments.addFiles(files);
  }

  return (
    <fieldset
      className="member-record-groups news-publish-attachments"
      aria-describedby={HINT_ID}
    >
      <legend id={LEGEND_ID}>
        {translate("news.publish.attachments.legend")}
      </legend>
      <p className="auth-hint" id={HINT_ID}>
        {describeAttachmentsHint(translate)}
      </p>
      {attachments.entries.length === 0 ? null : (
        <ul
          className="news-publish-attachment-list"
          aria-labelledby={LEGEND_ID}
        >
          {attachments.entries.map((entry) => (
            <AttachmentRow
              key={entry.key}
              translate={translate}
              entry={entry}
              onRemove={attachments.remove}
            />
          ))}
        </ul>
      )}
      {attachments.notices.length === 0 ? null : (
        <div className="auth-error" role="alert">
          {attachments.notices.map((notice, index) => (
            // Dos archivos con el mismo nombre pueden fallar a la vez.
            <p key={`${index}-${notice.kind}-${notice.fileName}`}>
              {describeNotice(translate, notice)}
            </p>
          ))}
        </div>
      )}
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        aria-label={translate("news.publish.attachments.choose")}
        className="account-photo-input"
        tabIndex={-1}
        onChange={choose}
      />
      <button
        type="button"
        className="admin-secondary news-publish-add"
        aria-describedby={HINT_ID}
        onClick={() => input.current?.click()}
      >
        {translate("news.publish.attachments.add")}
      </button>
    </fieldset>
  );
}
