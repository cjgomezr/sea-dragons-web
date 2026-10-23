"use client";

import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { useId } from "react";
import { Icon } from "@/components/Icon";
import {
  DIRECTORY_EMAIL_QUOTA,
  type DirectoryEmailResult,
} from "@/lib/directory/directory-email-rules";
import type { Translator } from "@/lib/i18n/translator";

/**
 * El correo ya enviado (#859, RF-5 del PRD de E33): cuántos salieron, los
 * correos que quedan hoy, a quiénes no llegó si falló alguno (#501), y
 * Escribir otro o Cerrar.
 */
export function DirectoryEmailSent({
  translate,
  result,
  onWriteAnother,
  onClose,
}: {
  readonly translate: Translator;
  readonly result: DirectoryEmailResult;
  readonly onWriteAnother: () => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const failedId = useId();
  return (
    <div className="directory-email-sent">
      <div className="directory-email-sent-status" role="status">
        <span className="directory-email-sent-icon" aria-hidden="true">
          <Icon glyph={CheckCircle} />
        </span>
        <p className="directory-email-sent-title">
          {translate("directory.email.result.sent", {
            count: result.sentCount,
          })}
        </p>
        <p>
          {translate("directory.email.result.replies")}{" "}
          {translate("directory.email.quota.left", {
            remaining: result.remaining,
            limit: DIRECTORY_EMAIL_QUOTA,
          })}
        </p>
        {result.failed.length === 0 ? null : (
          <>
            <p id={failedId}>{translate("directory.email.result.failed")}</p>
            <ul aria-labelledby={failedId}>
              {result.failed.map((recipient) => (
                <li key={recipient.userId}>{recipient.fullName}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="directory-email-sent-actions">
        <button type="button" className="auth-submit" onClick={onWriteAnother}>
          {translate("directory.email.result.writeAnother")}
        </button>
        <button type="button" className="admin-secondary" onClick={onClose}>
          {translate("directory.email.close")}
        </button>
      </div>
    </div>
  );
}
