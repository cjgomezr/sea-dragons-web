"use client";

import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { useId } from "react";
import { Icon } from "@/components/Icon";
import type { DirectoryEmailQuota } from "@/lib/directory/directory-email-rules";
import type { Translator } from "@/lib/i18n/translator";
import { type QuotaState, isQuotaLow } from "./use-directory-email-quota";

/**
 * El pie del redactor (#859, RF-5 y D9 del PRD de E33): a la izquierda los
 * correos que quedan hoy con su barra y, si los hay, cuántos errores
 * arreglar; a la derecha Cancelar y Enviar.
 */

/** La frase y una barra que la dibuja. La barra es un `meter` que toma la
 * frase como nombre, así que un lector de pantalla la lee una sola vez. */
export function QuotaMeter({
  translate,
  quota,
}: {
  readonly translate: Translator;
  readonly quota: DirectoryEmailQuota;
}): React.JSX.Element {
  const labelId = useId();
  return (
    <div className="directory-email-quota">
      <span id={labelId}>
        {translate("directory.email.quota.left", {
          remaining: quota.remaining,
          limit: quota.limit,
        })}
      </span>
      <div
        className="directory-email-quota-bar"
        role="meter"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={quota.limit}
        aria-valuenow={quota.remaining}
        data-level={isQuotaLow(quota.remaining) ? "low" : undefined}
      >
        <span style={{ flexGrow: quota.remaining }} />
        <span style={{ flexGrow: quota.limit - quota.remaining }} />
      </div>
    </div>
  );
}

function QuotaStatus({
  translate,
  quota,
}: {
  readonly translate: Translator;
  readonly quota: QuotaState;
}): React.JSX.Element {
  switch (quota.kind) {
    case "loading":
      return (
        <p className="directory-email-quota">
          {translate("directory.email.quota.loading")}
        </p>
      );
    case "failed":
      return (
        <p className="directory-email-quota">
          {translate("directory.email.quota.unknown")}
        </p>
      );
    case "loaded":
      return <QuotaMeter translate={translate} quota={quota.quota} />;
  }
}

export function DirectoryEmailFooter({
  translate,
  quota,
  problemCount,
  recipientCount,
  canSend,
  onCancel,
}: {
  readonly translate: Translator;
  readonly quota: QuotaState;
  /** Cuántos campos hay que arreglar; 0 antes de intentar enviar. */
  readonly problemCount: number;
  readonly recipientCount: number;
  readonly canSend: boolean;
  readonly onCancel: () => void;
}): React.JSX.Element {
  return (
    <div className="directory-email-footer">
      <div className="directory-email-footer-status">
        <QuotaStatus translate={translate} quota={quota} />
        {problemCount === 0 ? null : (
          <p className="directory-email-problems">
            <Icon glyph={WarningCircle} />
            {translate("directory.email.errorSummary", {
              count: problemCount,
            })}
          </p>
        )}
      </div>
      <div className="directory-email-footer-actions">
        <button type="button" className="admin-secondary" onClick={onCancel}>
          {translate("directory.email.cancel")}
        </button>
        <button type="submit" className="auth-submit" disabled={!canSend}>
          <Icon glyph={PaperPlaneTilt} />
          {translate("directory.email.send", { count: recipientCount })}
        </button>
      </div>
    </div>
  );
}
