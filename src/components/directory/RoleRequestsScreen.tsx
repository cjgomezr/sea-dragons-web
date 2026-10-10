"use client";

import { ArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { useEffect, useId, useRef } from "react";
import { Icon } from "@/components/Icon";
import { MemberAvatar } from "@/components/MemberAvatar";
import type { PendingRoleRequest } from "@/lib/auth/club-administration";
import type { RoleRequestDecision } from "@/lib/auth/role-request-decision";
import { formatClubDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { AdministrationNotice } from "./AdministrationNotice";
import type { PendingRoleRequests } from "./use-pending-role-requests";
import { useSingleDecision } from "./use-single-decision";

/**
 * La pantalla de solicitudes de rol del móvil (#553, RF-7 del PRD de E21):
 * la abre el aviso de encima de la lista y la tapa entera, con una flecha
 * para volver. Una tarjeta por solicitud con quién la pide, cuándo, de qué
 * rol a cuál, su motivo, y Rechazar y Aprobar.
 *
 * El estado es el mismo que pinta la bandeja de escritorio
 * (`usePendingRoleRequests`): lo que se decide aquí ya está decidido allí, y
 * el rol aprobado ya está en la fila al volver. El servidor vuelve a mirar
 * que quien decide sea Admin.
 */

/** El círculo de cada tarjeta, en píxeles; `.directory-request-avatar` dice
 * lo mismo. */
const REQUEST_AVATAR_SIZE = 44;

const TITLE_ID = "solicitudes-de-rol";

/** "Jugador → Coach", con las píldoras a la vista; un lector de pantalla
 * oye la frase entera. */
function RoleChange({
  translate,
  request,
}: {
  translate: Translator;
  request: PendingRoleRequest;
}): React.JSX.Element {
  const from = translate(`role.${request.currentRole}`);
  const to = translate(`role.${request.requestedRole}`);
  return (
    <p className="directory-request-change">
      <span className="visually-hidden">
        {translate("directory.requestsScreen.change", { from, to })}
      </span>
      <span className="directory-request-roles" aria-hidden="true">
        <span className="directory-request-role">{from}</span>
        <span className="directory-request-arrow">→</span>
        <span className="directory-request-role directory-request-role-asked">
          {to}
        </span>
      </span>
    </p>
  );
}

function RequestCard({
  translate,
  request,
  isBusy,
  onDecide,
}: {
  translate: Translator;
  request: PendingRoleRequest;
  isBusy: boolean;
  onDecide: (decision: RoleRequestDecision) => void;
}): React.JSX.Element {
  const nameId = useId();
  return (
    <li className="directory-request-card" aria-labelledby={nameId}>
      <div className="directory-request-who">
        <MemberAvatar
          className="directory-request-avatar"
          fullName={request.fullName}
          photoUrl={null}
          size={REQUEST_AVATAR_SIZE}
        />
        <div>
          <h2 id={nameId} className="directory-request-name">
            {request.fullName}
          </h2>
          <p className="directory-request-date">
            {formatClubDay(translate.locale, new Date(request.createdAt))}
          </p>
        </div>
      </div>
      <RoleChange translate={translate} request={request} />
      <div>
        <p className="directory-request-reason-label">
          {translate("directory.requestsScreen.reason")}
        </p>
        <p className="directory-request-reason">
          {request.justification ?? translate("admin.requests.noJustification")}
        </p>
      </div>
      <div className="directory-request-actions">
        <button
          type="button"
          className="admin-secondary"
          aria-label={translate("admin.requests.rejectLabel", {
            name: request.fullName,
          })}
          disabled={isBusy}
          onClick={() => onDecide("rejected")}
        >
          {translate("admin.requests.reject")}
        </button>
        <button
          type="button"
          className="auth-submit"
          aria-label={translate("admin.requests.approveLabel", {
            name: request.fullName,
          })}
          disabled={isBusy}
          onClick={() => onDecide("approved")}
        >
          {translate("admin.requests.approve")}
        </button>
      </div>
    </li>
  );
}

function AllCaughtUp({
  translate,
}: {
  translate: Translator;
}): React.JSX.Element {
  return (
    <div className="directory-requests-empty">
      <span className="directory-requests-empty-icon">
        <Icon glyph={CheckCircle} weight="fill" />
      </span>
      <p className="directory-requests-empty-title">
        {translate("directory.requestsScreen.allCaughtUp")}
      </p>
      <p className="directory-requests-empty-text">
        {translate("admin.requests.empty")}
      </p>
    </div>
  );
}

function RequestCards({
  translate,
  requests,
  onDecide,
}: {
  translate: Translator;
  requests: readonly PendingRoleRequest[];
  onDecide: PendingRoleRequests["decide"];
}): React.JSX.Element {
  const { isDeciding, decide } = useSingleDecision(onDecide);
  if (requests.length === 0) {
    return <AllCaughtUp translate={translate} />;
  }
  return (
    <ul className="directory-request-cards">
      {requests.map((request) => (
        <RequestCard
          key={request.id}
          translate={translate}
          request={request}
          isBusy={isDeciding}
          onDecide={(decision) => void decide(request, decision)}
        />
      ))}
    </ul>
  );
}

/** Cuántas esperan, bajo el título. Mientras carga, o si falló, nada. */
function RequestsCount({
  translate,
  pendingRequests,
}: {
  translate: Translator;
  pendingRequests: PendingRoleRequests;
}): React.JSX.Element | null {
  const { state } = pendingRequests;
  if (state.kind !== "ready") {
    return null;
  }
  return (
    <p className="directory-requests-count">
      {state.requests.length === 0
        ? translate("directory.requests.none")
        : translate("directory.requests.waiting", {
            count: state.requests.length,
          })}
    </p>
  );
}

function RequestsBody({
  translate,
  pendingRequests,
}: {
  translate: Translator;
  pendingRequests: PendingRoleRequests;
}): React.JSX.Element {
  const { state, decide, retry } = pendingRequests;
  switch (state.kind) {
    case "loading":
      return <p className="admin-empty">{translate("admin.loading")}</p>;
    case "failed":
      return (
        <div className="admin-load-failure">
          <p className="auth-error" role="alert">
            {translate("admin.loadFailed")}
          </p>
          <button type="button" className="auth-submit" onClick={retry}>
            {translate("admin.retry")}
          </button>
        </div>
      );
    case "ready":
      return (
        <RequestCards
          translate={translate}
          requests={state.requests}
          onDecide={decide}
        />
      );
  }
}

export function RoleRequestsScreen({
  translate,
  pendingRequests,
  onBack,
}: {
  translate: Translator;
  pendingRequests: PendingRoleRequests;
  onBack: () => void;
}): React.JSX.Element {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const backLabel = translate("directory.requestsScreen.back");

  // Quien llega con un lector de pantalla oye dónde está: la pantalla
  // entera cambió bajo su dedo.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <section className="directory-requests-screen" aria-labelledby={TITLE_ID}>
      <header className="directory-requests-header">
        <button
          type="button"
          className="directory-back"
          aria-label={backLabel}
          title={backLabel}
          onClick={onBack}
        >
          <Icon glyph={ArrowLeft} />
        </button>
        <div>
          <h1 id={TITLE_ID} ref={titleRef} tabIndex={-1}>
            {translate("directory.requestsScreen.title")}
          </h1>
          <RequestsCount
            translate={translate}
            pendingRequests={pendingRequests}
          />
        </div>
      </header>
      <AdministrationNotice notice={pendingRequests.notice} />
      <RequestsBody translate={translate} pendingRequests={pendingRequests} />
    </section>
  );
}
