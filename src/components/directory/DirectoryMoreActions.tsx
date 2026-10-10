"use client";

import { DotsThreeVertical } from "@phosphor-icons/react/dist/ssr/DotsThreeVertical";
import { DownloadSimple } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { EnvelopeSimple } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { useId, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { DirectoryQuery } from "@/lib/directory/directory";
import { DIRECTORY_EMAIL_QUOTA } from "@/lib/directory/directory-email-rules";
import type { Translator } from "@/lib/i18n/translator";
import { BottomSheet } from "./BottomSheet";
import type { EmailRecipient } from "./DirectoryEmailComposer";
import { describeDirectoryExportFailure } from "./directory-export-client";
import { useDirectoryExport } from "./use-directory-export";

/**
 * El "⋯" de la cabecera del móvil (#553, RF-7 del PRD de E21): en una hoja
 * que dice cuántos miembros tiene la vista, escribir un correo (#501) y
 * exportar a CSV (#500), cada uno sólo para quien hoy puede. En escritorio
 * son los dos botones de solo icono de la cabecera, y la hoja de estilos
 * esconde este.
 */

type SheetOptionProps = {
  readonly glyph: Parameters<typeof Icon>[0]["glyph"];
  readonly title: string;
  readonly hint: string;
  /** Por qué no se puede, si no se puede: con la lista vacía. */
  readonly disabledReason: string | null;
  readonly onChoose: () => void;
};

/** Una acción de la hoja: su título es el nombre, y la línea de debajo, su
 * descripción. */
function SheetOption({
  glyph,
  title,
  hint,
  disabledReason,
  onChoose,
}: SheetOptionProps): React.JSX.Element {
  const titleId = useId();
  const hintId = useId();
  const reasonId = useId();
  return (
    <>
      <button
        type="button"
        className="directory-sheet-action"
        aria-labelledby={titleId}
        aria-describedby={
          disabledReason === null ? hintId : `${hintId} ${reasonId}`
        }
        disabled={disabledReason !== null}
        onClick={onChoose}
      >
        <span className="directory-sheet-action-icon">
          <Icon glyph={glyph} />
        </span>
        <span className="directory-sheet-action-text">
          <span id={titleId} className="directory-sheet-action-title">
            {title}
          </span>
          <span id={hintId} className="directory-sheet-action-hint">
            {hint}
          </span>
        </span>
      </button>
      {disabledReason === null ? null : (
        <p className="visually-hidden" id={reasonId}>
          {disabledReason}
        </p>
      )}
    </>
  );
}

export function DirectoryMoreActions({
  translate,
  memberCount,
  emailRecipients,
  exportQuery,
  onOpenEmail,
}: {
  translate: Translator;
  /** Cuántos miembros enseña la lista. */
  memberCount: number;
  /** A quién iría el correo, o `null` si quien mira no escribe correos. */
  emailRecipients: readonly EmailRecipient[] | null;
  /** La consulta de la lista que se ve, o `null` si quien mira no exporta. */
  exportQuery: DirectoryQuery | null;
  onOpenEmail: (recipients: readonly EmailRecipient[]) => void;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const { state: exportState, exportList } = useDirectoryExport();
  const label = translate("directory.more.open");

  function closeSheet(): void {
    setIsOpen(false);
    openerRef.current?.focus();
  }

  return (
    <div className="directory-more">
      <button
        ref={openerRef}
        type="button"
        className="directory-icon-button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
      >
        <Icon glyph={DotsThreeVertical} weight="fill" />
      </button>
      {exportState.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeDirectoryExportFailure(translate, exportState.failure)}
        </p>
      ) : null}
      {isOpen ? (
        <BottomSheet
          title={translate("directory.more.title", { count: memberCount })}
          titleClassName="directory-sheet-label"
          onClosed={closeSheet}
        >
          {(close) => (
            <>
              {emailRecipients === null ? null : (
                <SheetOption
                  glyph={EnvelopeSimple}
                  title={translate("directory.more.email")}
                  hint={translate("directory.more.emailHint", {
                    quota: DIRECTORY_EMAIL_QUOTA,
                  })}
                  disabledReason={
                    emailRecipients.length === 0
                      ? translate("directory.email.emptyReason")
                      : null
                  }
                  onChoose={() => {
                    onOpenEmail(emailRecipients);
                    close();
                  }}
                />
              )}
              {exportQuery === null ? null : (
                <SheetOption
                  glyph={DownloadSimple}
                  title={translate("directory.export.open")}
                  hint={translate("directory.more.exportHint")}
                  disabledReason={
                    memberCount === 0
                      ? translate("directory.export.emptyReason")
                      : null
                  }
                  onChoose={() => {
                    void exportList(exportQuery);
                    close();
                  }}
                />
              )}
              <button
                type="button"
                className="admin-secondary directory-sheet-cancel"
                onClick={close}
              >
                {translate("directory.more.cancel")}
              </button>
            </>
          )}
        </BottomSheet>
      ) : null}
    </div>
  );
}
