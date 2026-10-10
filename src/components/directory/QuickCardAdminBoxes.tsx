"use client";

import { Hand } from "@phosphor-icons/react/dist/ssr/Hand";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt";
import { useId } from "react";
import { Icon } from "@/components/Icon";
import type { PendingRoleRequest } from "@/lib/auth/club-administration";
import type { RoleRequestDecision } from "@/lib/auth/role-request-decision";
import { formatCalendarDay } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import { InvitationResend } from "./InvitationResend";
import { RequestActions } from "./PendingRequestsTray";
import { useSingleDecision } from "./use-single-decision";

/**
 * Los dos recuadros de la ficha rápida que sólo ve un Admin (#550): la
 * invitación de quien todavía no entró, con su reenvío (#243), y la solicitud
 * de rol pendiente del socio, con Aprobar y Rechazar (#240). Los dos reusan
 * lo que ya hacían la ficha completa y la bandeja: el mismo endpoint, la
 * misma protección contra el doble envío.
 */

export function InvitationBox({
  translate,
  locale,
  userId,
  invitedOn,
  email,
}: {
  translate: Translator;
  locale: Locale;
  userId: string;
  invitedOn: string;
  email: string;
}): React.JSX.Element {
  return (
    <div className="directory-card-invitation">
      <p className="directory-card-box-line">
        <Icon glyph={PaperPlaneTilt} />
        {translate("directory.card.invitation", {
          date: formatCalendarDay(locale, invitedOn),
        })}
      </p>
      <InvitationResend
        translate={translate}
        userId={userId}
        isPrimary={false}
        sentText={translate("directory.card.invitationResent", { email })}
      />
    </div>
  );
}

export function RoleRequestBox({
  translate,
  locale,
  request,
  onDecide,
}: {
  translate: Translator;
  locale: Locale;
  request: PendingRoleRequest;
  onDecide: (
    request: PendingRoleRequest,
    decision: RoleRequestDecision,
  ) => Promise<void>;
}): React.JSX.Element {
  const titleId = useId();
  const { isDeciding, decide } = useSingleDecision(onDecide);
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="directory-card-request"
    >
      <h3 id={titleId} className="visually-hidden">
        {translate("directory.card.request")}
      </h3>
      <p className="directory-card-box-line">
        <Icon glyph={Hand} />
        <span>
          {translate("directory.card.requestAsked")}{" "}
          <strong>{translate(`role.${request.requestedRole}`)}</strong>
          {" · "}
          {formatCalendarDay(
            locale,
            clubCalendarDate(new Date(request.createdAt)),
          )}
        </span>
      </p>
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
        isBusy={isDeciding}
        onDecide={(decision) => void decide(request, decision)}
      />
    </div>
  );
}
