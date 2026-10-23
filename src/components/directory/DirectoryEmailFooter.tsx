"use client";

import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { useId } from "react";
import { Icon } from "@/components/Icon";
import type { DirectoryEmailQuota } from "@/lib/directory/directory-email-rules";
import type { Translator } from "@/lib/i18n/translator";
import type { ComposerLayout } from "./DirectoryEmailComposer";
import { type QuotaState, isQuotaLow } from "./use-directory-email-quota";

/**
 * El pie del redactor (#859, RF-5 y D9 del PRD de E33): a la izquierda los
 * correos que quedan hoy con su barra y, si los hay, cuántos errores
 * arreglar; a la derecha Cancelar y Enviar.
 *
 * En el móvil (#860) Enviar va en la barra de arriba, la cuenta de errores
 * encima de los campos y aquí sólo queda el cupo, al final del scroll.
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

/** Cuántos campos hay que arreglar. En el móvil sale encima de los campos,
 * lejos de Enviar, y por eso dice "antes de enviar". */
export function ProblemSummary({
  translate,
  layout,
  count,
}: {
  readonly translate: Translator;
  readonly layout: ComposerLayout;
  readonly count: number;
}): React.JSX.Element | null {
  if (count === 0) {
    return null;
  }
  return (
    <p className="directory-email-problems">
      <Icon glyph={WarningCircle} />
      {translate(
        layout === "phone"
          ? "directory.email.errorSummaryBeforeSend"
          : "directory.email.errorSummary",
        { count },
      )}
    </p>
  );
}

export function DirectoryEmailFooter({
  translate,
  layout,
  quota,
  problemCount,
  recipientCount,
  canSend,
  onCancel,
}: {
  readonly translate: Translator;
  readonly layout: ComposerLayout;
  readonly quota: QuotaState;
  /** Cuántos campos hay que arreglar; 0 antes de intentar enviar. */
  readonly problemCount: number;
  readonly recipientCount: number;
  readonly canSend: boolean;
  readonly onCancel: () => void;
}): React.JSX.Element {
  if (layout === "phone") {
    return (
      <div className="directory-email-footer">
        <QuotaStatus translate={translate} quota={quota} />
      </div>
    );
  }
  return (
    <div className="directory-email-footer">
      <div className="directory-email-footer-status">
        <QuotaStatus translate={translate} quota={quota} />
        <ProblemSummary
          translate={translate}
          layout={layout}
          count={problemCount}
        />
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
