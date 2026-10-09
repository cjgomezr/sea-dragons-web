"use client";

import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { EnvelopeSimple } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { UserPlus } from "@phosphor-icons/react/dist/ssr/UserPlus";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { NEW_MEMBER_PATH } from "@/lib/auth/routes";
import type {
  DirectoryListing,
  DirectoryQuery,
} from "@/lib/directory/directory";
import type { Translator } from "@/lib/i18n/translator";
import type { EmailRecipient } from "./DirectoryEmailComposer";
import { DirectoryExportButton } from "./DirectoryExportButton";
import { ROLE_REQUESTS_HEADING_ID } from "./RoleRequestsPanel";
import type { PendingRequestsState } from "./use-pending-role-requests";

/**
 * La cabecera del directorio (#548, RF-2 del PRD de E21): el título, cuántos
 * socios enseña la lista de cuántos tiene el club y, a un Admin, cómo van las
 * solicitudes de rol. A la derecha, los botones de solo icono de escribir un
 * correo (#501), exportar a CSV (#500) e invitar (#243), cada uno sólo para
 * quien hoy puede usarlo.
 *
 * Quién puede qué lo dice la marca que el servidor pone a la lista, nunca un
 * rol que la pantalla lea por su cuenta; y el servidor lo vuelve a mirar al
 * enviar, exportar o dar de alta.
 */

const EMAIL_EMPTY_REASON_ID = "correo-directorio-sin-socios";

/** La lista que se ve y la consulta que la trajo: exportar (#500) tiene que
 * dar la que se ve, no la que piden ya los controles. */
export type ListedDirectory = {
  readonly listing: DirectoryListing;
  readonly listedQuery: DirectoryQuery;
};

/** Escriben correos quienes reciben la lista con el correo de todos (D5, D7). */
function canWriteEmails(listing: DirectoryListing): boolean {
  return listing.kind === "admin" || listing.kind === "committee";
}

/** Exporta a CSV quien ve el contacto de todos (D6, #500): hoy los mismos
 * que escriben correos, pero son dos permisos distintos. */
function canExportListing(listing: DirectoryListing): boolean {
  return listing.kind === "admin" || listing.kind === "committee";
}

/** La lista que se está viendo, sin las bajas: no van a recibirlo. El
 * servidor las vuelve a quitar al enviar, por si alguien se dio de baja
 * entre medias. */
function emailRecipientsOf(
  listing: DirectoryListing,
): readonly EmailRecipient[] {
  return listing.members
    .filter((member) => member.status !== "inactive")
    .map(({ userId, fullName }) => ({ userId, fullName }));
}

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

function InviteLink({
  translate,
}: {
  translate: Translator;
}): React.JSX.Element {
  const label = translate("directory.addMember");
  return (
    <Link
      href={NEW_MEMBER_PATH}
      className="directory-icon-button directory-icon-button-primary"
      aria-label={label}
      title={label}
    >
      <Icon glyph={UserPlus} />
    </Link>
  );
}

/** "No hay solicitudes pendientes", o la píldora que lleva a la bandeja.
 * Mientras la bandeja carga, o si no cargó, no dice nada: la bandeja ya
 * enseña su propio estado. */
function RequestsStatus({
  translate,
  requests,
}: {
  translate: Translator;
  requests: PendingRequestsState;
}): React.JSX.Element | null {
  if (requests.kind !== "ready") {
    return null;
  }
  const count = requests.requests.length;
  if (count === 0) {
    return (
      <p className="directory-requests-none">
        <Icon glyph={CheckCircle} weight="fill" />
        {translate("directory.requests.none")}
      </p>
    );
  }
  return (
    <a
      href={`#${ROLE_REQUESTS_HEADING_ID}`}
      className="directory-requests-pill"
    >
      {translate("directory.requests.waiting", { count })}
      <Icon glyph={ArrowRight} />
    </a>
  );
}

function HeaderActions({
  translate,
  listed,
  onOpenEmail,
}: {
  translate: Translator;
  listed: ListedDirectory;
  onOpenEmail: (recipients: readonly EmailRecipient[]) => void;
}): React.JSX.Element {
  const { listing, listedQuery } = listed;
  return (
    <div className="directory-actions">
      {canWriteEmails(listing) ? (
        <WriteEmailButton
          translate={translate}
          recipients={emailRecipientsOf(listing)}
          onOpen={onOpenEmail}
        />
      ) : null}
      {canExportListing(listing) ? (
        <DirectoryExportButton
          translate={translate}
          query={listedQuery}
          isEmpty={listing.members.length === 0}
        />
      ) : null}
      {/* Sólo quien recibe la lista de Admin puede dar de alta (#243). */}
      {listing.kind === "admin" ? <InviteLink translate={translate} /> : null}
    </div>
  );
}

export function DirectoryHeader({
  translate,
  listed,
  pendingRequests,
  onOpenEmail,
}: {
  translate: Translator;
  /** `null` mientras la lista no ha llegado, o si falló. */
  listed: ListedDirectory | null;
  /** `null` para quien no es Admin: no tiene solicitudes que decidir. */
  pendingRequests: PendingRequestsState | null;
  onOpenEmail: (recipients: readonly EmailRecipient[]) => void;
}): React.JSX.Element {
  return (
    <header className="directory-header">
      <div className="directory-heading">
        <div className="directory-title">
          <h1>{translate("directory.title")}</h1>
          {listed === null ? null : (
            <p className="directory-total">
              {translate("directory.count", {
                shown: listed.listing.members.length,
                count: listed.listing.total,
              })}
            </p>
          )}
        </div>
        {pendingRequests === null ? null : (
          <RequestsStatus translate={translate} requests={pendingRequests} />
        )}
      </div>
      {listed === null ? null : (
        <HeaderActions
          translate={translate}
          listed={listed}
          onOpenEmail={onOpenEmail}
        />
      )}
    </header>
  );
}
