"use client";

import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { EnvelopeSimple } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { UserPlus } from "@phosphor-icons/react/dist/ssr/UserPlus";
import { Icon } from "@/components/Icon";
import type {
  DirectoryListing,
  DirectoryMember,
  DirectoryQuery,
} from "@/lib/directory/directory";
import type { Translator } from "@/lib/i18n/translator";
import type { EmailRecipient } from "./DirectoryEmailComposer";
import { DirectoryExportButton } from "./DirectoryExportButton";
import { DirectoryMoreActions } from "./DirectoryMoreActions";
import {
  canExportListing,
  canWriteEmails,
  emailRecipientsOf,
} from "./listing-permissions";
import type { PendingRequestsState } from "./use-pending-role-requests";

/**
 * La cabecera del directorio (#548, RF-2 del PRD de E21): el título, cuántos
 * socios enseña la lista de cuántos tiene el club y, a un Admin, cómo van las
 * solicitudes de rol. A la derecha, los botones de solo icono de escribir un
 * correo (#501), exportar a CSV (#500) e invitar (#243, que desde #862 abre su
 * panel bajo la cabecera), cada uno sólo para
 * quien hoy puede usarlo. En el móvil (#553) el correo y el CSV van juntos
 * en el menú "⋯", y la hoja de estilos esconde el total y la línea de las
 * solicitudes: de ellas avisa la lista.
 *
 * Quién puede qué lo dice la marca que el servidor pone a la lista, nunca un
 * rol que la pantalla lea por su cuenta; y el servidor lo vuelve a mirar al
 * enviar, exportar o dar de alta.
 *
 * Con socios marcados (#552), el correo y el CSV de escritorio actúan sólo
 * sobre ellos, igual que los de la barra de los marcados. El menú del móvil
 * no tiene casillas y sigue con la lista entera.
 */

const EMAIL_EMPTY_REASON_ID = "correo-directorio-sin-socios";

/** El botón de invitar, al que vuelve el foco al cerrar su panel (#862). */
export const INVITE_TOGGLE_ID = "directorio-invitar";

/** La lista que se ve y la consulta que la trajo: exportar (#500) tiene que
 * dar la que se ve, no la que piden ya los controles. */
export type ListedDirectory = {
  readonly listing: DirectoryListing;
  readonly listedQuery: DirectoryQuery;
};

function WriteEmailButton({
  translate,
  recipients,
  onOpen,
}: {
  translate: Translator;
  recipients: readonly EmailRecipient[];
  onOpen: (recipients: readonly EmailRecipient[]) => void;
}): React.JSX.Element {
  const isEmpty = recipients.length === 0;
  const label = translate("directory.email.open");
  return (
    <div className="directory-email-open">
      <button
        type="button"
        className="directory-icon-button"
        aria-label={label}
        title={label}
        disabled={isEmpty}
        aria-describedby={isEmpty ? EMAIL_EMPTY_REASON_ID : undefined}
        onClick={() => onOpen(recipients)}
      >
        <Icon glyph={EnvelopeSimple} />
      </button>
      {isEmpty ? (
        <p className="visually-hidden" id={EMAIL_EMPTY_REASON_ID}>
          {translate("directory.email.emptyReason")}
        </p>
      ) : null}
    </div>
  );
}

/** Abre y cierra el panel de invitar bajo la cabecera (#862). */
function InviteToggle({
  translate,
  isOpen,
  onToggle,
}: {
  translate: Translator;
  isOpen: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const label = translate("directory.addMember");
  return (
    <button
      type="button"
      id={INVITE_TOGGLE_ID}
      className="directory-icon-button directory-icon-button-primary"
      aria-label={label}
      aria-expanded={isOpen}
      title={label}
      onClick={onToggle}
    >
      <Icon glyph={UserPlus} />
    </button>
  );
}

/** Lo que el botón de invitar necesita de la pantalla. */
type InviteControl = {
  readonly isOpen: boolean;
  readonly onToggle: () => void;
};

/** Lo que la línea de las solicitudes necesita de la pantalla. */
export type RequestsLine = {
  readonly state: PendingRequestsState;
  /** Abre el panel en el resumen del club, donde se deciden (#551). */
  readonly onReview: () => void;
  readonly onRetry: () => void;
};

/** Que las solicitudes no cargaron, con cómo volver a pedirlas. La lista
 * sigue a la vista: carga aparte. */
function RequestsLoadFailure({
  translate,
  onRetry,
}: {
  translate: Translator;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="directory-requests-failed">
      <p role="alert">{translate("admin.loadFailed")}</p>
      <button type="button" className="directory-link-button" onClick={onRetry}>
        {translate("admin.retry")}
      </button>
    </div>
  );
}

/** "No hay solicitudes pendientes", o la píldora que abre el resumen del
 * panel, donde se deciden. Mientras cargan no dice nada; si no cargaron, lo
 * dice aquí, que es lo único del escritorio que las nombra sin abrir el
 * panel. */
function RequestsStatus({
  translate,
  requests,
}: {
  translate: Translator;
  requests: RequestsLine;
}): React.JSX.Element | null {
  const { state } = requests;
  if (state.kind === "failed") {
    return (
      <RequestsLoadFailure translate={translate} onRetry={requests.onRetry} />
    );
  }
  if (state.kind !== "ready") {
    return null;
  }
  const count = state.requests.length;
  if (count === 0) {
    return (
      <p className="directory-requests-none">
        <Icon glyph={CheckCircle} weight="fill" />
        {translate("directory.requests.none")}
      </p>
    );
  }
  return (
    <button
      type="button"
      className="directory-requests-pill"
      onClick={requests.onReview}
    >
      {translate("directory.requests.waiting", { count })}
      <Icon glyph={ArrowRight} />
    </button>
  );
}

function HeaderActions({
  translate,
  listed,
  checkedMembers,
  invite,
  onOpenEmail,
}: {
  translate: Translator;
  listed: ListedDirectory;
  checkedMembers: readonly DirectoryMember[];
  invite: InviteControl;
  onOpenEmail: (recipients: readonly EmailRecipient[]) => void;
}): React.JSX.Element {
  const { listing, listedQuery } = listed;
  const canEmail = canWriteEmails(listing);
  const canExport = canExportListing(listing);
  const hasChecked = checkedMembers.length > 0;
  return (
    <div className="directory-actions">
      {canEmail || canExport ? (
        <DirectoryMoreActions
          translate={translate}
          memberCount={listing.members.length}
          emailRecipients={canEmail ? emailRecipientsOf(listing.members) : null}
          exportQuery={canExport ? listedQuery : null}
          onOpenEmail={onOpenEmail}
        />
      ) : null}
      {canEmail ? (
        <WriteEmailButton
          translate={translate}
          recipients={emailRecipientsOf(
            hasChecked ? checkedMembers : listing.members,
          )}
          onOpen={onOpenEmail}
        />
      ) : null}
      {canExport ? (
        <DirectoryExportButton
          translate={translate}
          query={listedQuery}
          selectedUserIds={
            hasChecked ? checkedMembers.map((member) => member.userId) : null
          }
          isEmpty={listing.members.length === 0}
        />
      ) : null}
      {/* Sólo quien recibe la lista de Admin puede dar de alta (#243). */}
      {listing.kind === "admin" ? (
        <InviteToggle
          translate={translate}
          isOpen={invite.isOpen}
          onToggle={invite.onToggle}
        />
      ) : null}
    </div>
  );
}

export function DirectoryHeader({
  translate,
  listed,
  requests,
  titleRef,
  checkedMembers,
  isInviteOpen,
  onOpenEmail,
  onToggleInvite,
}: {
  translate: Translator;
  /** `null` mientras la lista no ha llegado, o si falló. */
  listed: ListedDirectory | null;
  /** `null` para quien no es Admin: no tiene solicitudes que decidir. */
  requests: RequestsLine | null;
  /** El foco vuelve al título al salir de la pantalla de solicitudes del
   * móvil sin ninguna pendiente (#553). */
  titleRef: React.Ref<HTMLHeadingElement>;
  /** Los socios marcados en la lista (#552); vacío sin ninguno. */
  checkedMembers: readonly DirectoryMember[];
  /** El panel de invitar está abierto (#862). */
  isInviteOpen: boolean;
  onOpenEmail: (recipients: readonly EmailRecipient[]) => void;
  onToggleInvite: () => void;
}): React.JSX.Element {
  return (
    <header className="directory-header">
      <div className="directory-heading">
        <div className="directory-title">
          <h1 ref={titleRef} tabIndex={-1}>
            {translate("directory.title")}
          </h1>
          {listed === null ? null : (
            <p className="directory-total">
              {translate("directory.count", {
                shown: listed.listing.members.length,
                count: listed.listing.total,
              })}
            </p>
          )}
        </div>
        {requests === null ? null : (
          <RequestsStatus translate={translate} requests={requests} />
        )}
      </div>
      {listed === null ? null : (
        <HeaderActions
          translate={translate}
          listed={listed}
          checkedMembers={checkedMembers}
          invite={{ isOpen: isInviteOpen, onToggle: onToggleInvite }}
          onOpenEmail={onOpenEmail}
        />
      )}
    </header>
  );
}
