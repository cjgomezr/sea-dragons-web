"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  ClubMember,
  PendingRoleRequest,
} from "@/lib/auth/club-administration";
import type { RoleRequestDecision } from "@/lib/auth/role-request-decision";
import type { Role } from "@/lib/auth/roles";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import type { AdministrationNoticeState } from "./AdministrationNotice";
import { type MemberRoleSaveResult, MemberRoleList } from "./MemberRoleList";
import { PendingRequestsTray } from "./PendingRequestsTray";
import {
  type AdministrationData,
  type AdministrationAction,
  type AdministrationFailure,
  type AdministrationLoad,
  describeAdministrationFailure,
  isChangeRefused,
  isRequestSettled,
  loadAdministration,
  submitMemberRole,
  submitRoleRequestDecision,
} from "./administration-client";

/**
 * La pantalla mínima de administración (#212, RF-8 del PRD de E3): la bandeja
 * de solicitudes pendientes y la lista de socios con su rol. Sólo la alcanza
 * un Admin, y quien lo comprueba es la frontera, no esta pantalla.
 *
 * Es de cliente porque su razón de ser es cambiar sin recargar: decidir una
 * solicitud la saca de la bandeja y actualiza el rol en la lista de al lado.
 * Lee y escribe por la API v1, nunca contra la base: la aplicación nativa de
 * Release 2 usará esos mismos endpoints (CON-002). El idioma llega como prop
 * porque el traductor no puede cruzar del servidor al navegador.
 */

type ScreenState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | ({ readonly kind: "ready" } & AdministrationData);

type Notices = {
  readonly tray: AdministrationNoticeState;
  readonly members: AdministrationNoticeState;
};

const NO_NOTICES: Notices = { tray: null, members: null };

function LoadFailure({
  translate,
  onRetry,
}: {
  translate: Translator;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="admin-load-failure">
      <p className="auth-error" role="alert">
        {translate("admin.loadFailed")}
      </p>
      <button type="button" className="auth-submit" onClick={onRetry}>
        {translate("admin.retry")}
      </button>
    </div>
  );
}

/** El rol que queda tras una decisión: aprobar concede exactamente el rol que
 * se pidió, y rechazar no toca ninguno. */
function roleAfterDecision(
  request: PendingRoleRequest,
  decision: RoleRequestDecision,
): Role | null {
  return decision === "approved" ? request.requestedRole : null;
}

function withRole(
  members: readonly ClubMember[],
  userId: string,
  role: Role,
): readonly ClubMember[] {
  return members.map((member) =>
    member.userId === userId ? { ...member, role } : member,
  );
}

export function AdministrationScreen({
  locale,
}: {
  locale: Locale;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const [notices, setNotices] = useState<Notices>(NO_NOTICES);

  // El estado se toca cuando la API contesta, en la continuación, y no en el
  // cuerpo del efecto: montar la pantalla no dispara un pintado en cascada, y
  // `loading` ya es el estado con el que nace.
  const applyLoad = useCallback((outcome: AdministrationLoad): void => {
    setState(
      outcome.kind === "loaded"
        ? { kind: "ready", ...outcome.data }
        : { kind: "failed" },
    );
  }, []);

  useEffect(() => {
    void loadAdministration().then(applyLoad);
  }, [applyLoad]);

  function retryLoad(): void {
    setState({ kind: "loading" });
    setNotices(NO_NOTICES);
    void loadAdministration().then(applyLoad);
  }

  function noticeFor(
    action: AdministrationAction,
    failure: AdministrationFailure,
  ): AdministrationNoticeState {
    return {
      kind: "error",
      message: describeAdministrationFailure(translate, action, failure),
    };
  }

  /** Aplica lo que el servidor confirmó: la solicitud sale de la bandeja y, si
   * se aprobó, el socio aparece ya con su rol nuevo. */
  function settleRequest(
    settled: PendingRoleRequest,
    grantedRole: Role | null,
  ): void {
    setState((current) =>
      current.kind !== "ready"
        ? current
        : {
            ...current,
            requests: current.requests.filter(
              (request) => request.id !== settled.id,
            ),
            members:
              grantedRole === null
                ? current.members
                : withRole(current.members, settled.userId, grantedRole),
          },
    );
  }

  async function decide(
    request: PendingRoleRequest,
    decision: RoleRequestDecision,
  ): Promise<void> {
    const outcome = await submitRoleRequestDecision(request.id, decision);
    if (outcome.kind === "failed") {
      setNotices({ tray: noticeFor("decision", outcome), members: null });
      // Una que el servidor da por resuelta no sigue esperando respuesta.
      if (isRequestSettled(outcome.failure)) {
        settleRequest(request, null);
      }
      return;
    }
    settleRequest(request, roleAfterDecision(request, decision));
    setNotices({
      tray: {
        kind: "success",
        message:
          decision === "approved"
            ? translate("admin.requests.approved", {
                name: request.fullName,
                role: translate(`role.${request.requestedRole}`),
              })
            : translate("admin.requests.rejected", { name: request.fullName }),
      },
      members: null,
    });
  }

  async function saveRole(
    member: ClubMember,
    role: Role,
  ): Promise<MemberRoleSaveResult> {
    const outcome = await submitMemberRole(member.userId, role);
    if (outcome.kind === "failed") {
      setNotices({ tray: null, members: noticeFor("roleChange", outcome) });
      return isChangeRefused(outcome.failure) ? "settled" : "retryable";
    }
    setState((current) =>
      current.kind === "ready"
        ? {
            ...current,
            members: withRole(current.members, member.userId, outcome.role),
          }
        : current,
    );
    setNotices({
      tray: null,
      members: {
        kind: "success",
        message: translate("admin.members.saved", {
          name: member.fullName,
          role: translate(`role.${outcome.role}`),
        }),
      },
    });
    return "settled";
  }

  return (
    <div className="admin">
      <h1>{translate("admin.title")}</h1>
      <p className="app-lead">{translate("admin.lead")}</p>
      {state.kind === "loading" ? (
        <p className="admin-empty">{translate("admin.loading")}</p>
      ) : null}
      {state.kind === "failed" ? (
        <LoadFailure translate={translate} onRetry={retryLoad} />
      ) : null}
      {state.kind === "ready" ? (
        <>
          <PendingRequestsTray
            translate={translate}
            requests={state.requests}
            notice={notices.tray}
            onDecide={decide}
          />
          <MemberRoleList
            translate={translate}
            members={state.members}
            notice={notices.members}
            onSave={saveRole}
          />
        </>
      ) : null}
    </div>
  );
}
