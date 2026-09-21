"use client";

import { useCallback, useEffect, useState } from "react";
import type { PendingRoleRequest } from "@/lib/auth/club-administration";
import type { RoleRequestDecision } from "@/lib/auth/role-request-decision";
import type { Role } from "@/lib/auth/roles";
import type { Translator } from "@/lib/i18n/translator";
import type { AdministrationNoticeState } from "./AdministrationNotice";
import { PendingRequestsTray } from "./PendingRequestsTray";
import {
  type PendingRequestsLoad,
  describeAdministrationFailure,
  isRequestSettled,
  loadPendingRequests,
  submitRoleRequestDecision,
} from "./role-administration-client";

/**
 * La bandeja de solicitudes de rol dentro del directorio (#240), mudada tal
 * cual desde la pantalla de administración de E3 (#212).
 *
 * El directorio sólo la monta cuando su lista llega marcada `admin`, así que
 * quien la ve es quien puede decidir. Aun así no es ella la que protege nada:
 * el endpoint de la bandeja y el de decidir comprueban la capacidad por su
 * cuenta.
 *
 * Carga aparte de la lista: si la bandeja falla, la lista sigue a la vista, y
 * volver a intentarlo sólo repite lo que falló.
 */

type PanelState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly requests: readonly PendingRoleRequest[];
    };

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

function asPanelState(outcome: PendingRequestsLoad): PanelState {
  return outcome.kind === "loaded"
    ? { kind: "ready", requests: outcome.requests }
    : { kind: "failed" };
}

function decidedNotice(
  translate: Translator,
  request: PendingRoleRequest,
  decision: RoleRequestDecision,
): AdministrationNoticeState {
  return {
    kind: "success",
    message:
      decision === "approved"
        ? translate("admin.requests.approved", {
            name: request.fullName,
            role: translate(`role.${request.requestedRole}`),
          })
        : translate("admin.requests.rejected", { name: request.fullName }),
  };
}

export function RoleRequestsPanel({
  translate,
  onRoleGranted,
}: {
  translate: Translator;
  /** Aprobar concede exactamente el rol que se pidió: la lista de miembros
   * lo enseña en cuanto el servidor lo confirma, sin volver a leerla. */
  onRoleGranted: (userId: string, role: Role) => void;
}): React.JSX.Element {
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [notice, setNotice] = useState<AdministrationNoticeState>(null);

  // El estado se toca cuando la API contesta, en la continuación, y no en el
  // cuerpo del efecto: montar la bandeja no dispara un pintado en cascada, y
  // `loading` ya es el estado con el que nace.
  const applyLoad = useCallback((outcome: PendingRequestsLoad): void => {
    setState(asPanelState(outcome));
  }, []);

  useEffect(() => {
    void loadPendingRequests().then(applyLoad);
  }, [applyLoad]);

  function retryLoad(): void {
    setState({ kind: "loading" });
    setNotice(null);
    void loadPendingRequests().then(applyLoad);
  }

  function removeRequest(settled: PendingRoleRequest): void {
    setState((current) =>
      current.kind === "ready"
        ? {
            ...current,
            requests: current.requests.filter(
              (request) => request.id !== settled.id,
            ),
          }
        : current,
    );
  }

  async function decide(
    request: PendingRoleRequest,
    decision: RoleRequestDecision,
  ): Promise<void> {
    const outcome = await submitRoleRequestDecision(request.id, decision);
    if (outcome.kind === "failed") {
      setNotice({
        kind: "error",
        message: describeAdministrationFailure(translate, "decision", outcome),
      });
      // Una que el servidor da por resuelta no sigue esperando respuesta.
      if (isRequestSettled(outcome.failure)) {
        removeRequest(request);
      }
      return;
    }
    removeRequest(request);
    if (decision === "approved") {
      onRoleGranted(request.userId, request.requestedRole);
    }
    setNotice(decidedNotice(translate, request, decision));
  }

  return (
    <section className="admin-section" aria-labelledby="solicitudes-pendientes">
      <h2 id="solicitudes-pendientes">{translate("admin.requests.title")}</h2>
      {state.kind === "loading" ? (
        <p className="admin-empty">{translate("admin.loading")}</p>
      ) : null}
      {state.kind === "failed" ? (
        <LoadFailure translate={translate} onRetry={retryLoad} />
      ) : null}
      {state.kind === "ready" ? (
        <PendingRequestsTray
          translate={translate}
          requests={state.requests}
          notice={notice}
          onDecide={decide}
        />
      ) : null}
    </section>
  );
}
