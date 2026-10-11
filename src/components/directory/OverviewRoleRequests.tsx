"use client";

import { useId } from "react";
import { MemberAvatar } from "@/components/MemberAvatar";
import type { PendingRoleRequest } from "@/lib/auth/club-administration";
import type { RoleRequestDecision } from "@/lib/auth/role-request-decision";
import type { DirectoryMember } from "@/lib/directory/directory";
import { formatCalendarDay } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import { RequestActions } from "./PendingRequestsTray";
import { useSingleDecision } from "./use-single-decision";

/**
 * Las solicitudes de rol del resumen del club (#551, RF-4 del PRD de E21):
 * una tarjeta por solicitud, con Aprobar y Rechazar. Deciden por el mismo
 * `usePendingRoleRequests` que la bandeja, y una sola decisión sale cada
 * vez para toda la sección, como allí.
 */

/** El círculo de la tarjeta, en píxeles; `.directory-overview-avatar` dice
 * lo mismo. */
const REQUEST_AVATAR_SIZE = 32;

type Decide = (
  request: PendingRoleRequest,
  decision: RoleRequestDecision,
) => Promise<void>;

/** El nombre lleva a la ficha rápida del socio sólo si está en la lista que
 * se ve: uno que un filtro dejó fuera no tiene ficha que abrir. */
function RequesterName({
  translate,
  request,
  isListed,
  onSelectMember,
}: {
  translate: Translator;
  request: PendingRoleRequest;
  isListed: boolean;
  onSelectMember: (userId: string) => void;
}): React.JSX.Element {
  if (!isListed) {
    return <span className="directory-overview-name">{request.fullName}</span>;
  }
  return (
    <button
      type="button"
      className="directory-overview-name directory-link-button"
      aria-label={translate("directory.overview.openMember", {
        name: request.fullName,
      })}
      onClick={() => onSelectMember(request.userId)}
    >
      {request.fullName}
    </button>
  );
}

function RequestCard({
  translate,
  locale,
  request,
  member,
  isBusy,
  onDecide,
  onSelectMember,
}: {
  translate: Translator;
  locale: Locale;
  request: PendingRoleRequest;
  /** El socio en la lista que se ve, o `undefined` si un filtro lo dejó
   * fuera. */
  member: DirectoryMember | undefined;
  isBusy: boolean;
  onDecide: (decision: RoleRequestDecision) => void;
  onSelectMember: (userId: string) => void;
}): React.JSX.Element {
  return (
    <div
      className="directory-card-request"
      role="group"
      aria-label={translate("directory.overview.requestLabel", {
        name: request.fullName,
      })}
    >
      <div className="directory-overview-requester">
        <MemberAvatar
          className="directory-overview-avatar"
          fullName={request.fullName}
          photoUrl={member === undefined ? null : member.photoUrl}
          size={REQUEST_AVATAR_SIZE}
        />
        <div className="directory-identity">
          <RequesterName
            translate={translate}
            request={request}
            isListed={member !== undefined}
            onSelectMember={onSelectMember}
          />
          <p className="directory-overview-change">
            {translate(`role.${request.currentRole}`)} →{" "}
            <strong>{translate(`role.${request.requestedRole}`)}</strong>
            {" · "}
            {formatCalendarDay(
              locale,
              clubCalendarDate(new Date(request.createdAt)),
            )}
          </p>
        </div>
      </div>
      <p className="directory-card-justification">
        {request.justification === null
          ? translate("admin.requests.noJustification")
          : translate("directory.card.justification", {
              text: request.justification,
            })}
      </p>
      <RequestActions
        translate={translate}
        request={request}
        isBusy={isBusy}
        onDecide={onDecide}
      />
    </div>
  );
}

export function OverviewRoleRequests({
  translate,
  locale,
  requests,
  members,
  onDecide,
  onSelectMember,
}: {
  translate: Translator;
  locale: Locale;
  requests: readonly PendingRoleRequest[];
  /** Los socios de la lista que se ve: de ahí salen la foto y si el nombre
   * abre su ficha. */
  members: readonly DirectoryMember[];
  onDecide: Decide;
  onSelectMember: (userId: string) => void;
}): React.JSX.Element | null {
  const headingId = useId();
  const { isDeciding, decide } = useSingleDecision(onDecide);
  if (requests.length === 0) {
    return null;
  }
  return (
    <section className="directory-overview-section" aria-labelledby={headingId}>
      <h3 id={headingId} className="directory-card-label">
        {translate("directory.overview.requests", { count: requests.length })}
      </h3>
      <ul className="directory-overview-requests">
        {requests.map((request) => (
          <li key={request.id}>
            <RequestCard
              translate={translate}
              locale={locale}
              request={request}
              member={members.find(
                (member) => member.userId === request.userId,
              )}
              isBusy={isDeciding}
              onDecide={(decision) => void decide(request, decision)}
              onSelectMember={onSelectMember}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
