"use client";

import { useCallback, useEffect, useState } from "react";
import type { PendingRoleRequest } from "@/lib/auth/club-administration";
import type { RoleRequestDecision } from "@/lib/auth/role-request-decision";
import type { Role } from "@/lib/auth/roles";
import type { Translator } from "@/lib/i18n/translator";
import type { AdministrationNoticeState } from "./AdministrationNotice";
import {
  type PendingRequestsLoad,
  describeAdministrationFailure,
  isRequestSettled,
  loadPendingRequests,
  submitRoleRequestDecision,
} from "./role-administration-client";

/**
 * Las solicitudes de rol pendientes del club (#240) y lo que se decide sobre
 * ellas. Vivían dentro de `RoleRequestsPanel`; desde #548 la cabecera del
 * directorio también cuenta cuántas quedan, así que el estado sube a la
 * pantalla y la bandeja sólo lo pinta.
 *
 * Sólo carga cuando `isEnabled`: la pantalla lo enciende cuando su lista
 * llega marcada `admin`. A cualquier otro rol el endpoint le respondería 403.
 */

export type PendingRequestsState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly requests: readonly PendingRoleRequest[];
    };

export type PendingRoleRequests = {
  readonly state: PendingRequestsState;
  readonly notice: AdministrationNoticeState;
  readonly decide: (
    request: PendingRoleRequest,
    decision: RoleRequestDecision,
  ) => Promise<void>;
  readonly retry: () => void;
};

function asRequestsState(outcome: PendingRequestsLoad): PendingRequestsState {
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

export function usePendingRoleRequests({
  isEnabled,
  translate,
  onRoleGranted,
}: {
  readonly isEnabled: boolean;
  readonly translate: Translator;
  /** Aprobar concede exactamente el rol que se pidió: la lista de miembros
   * lo enseña en cuanto el servidor lo confirma, sin volver a leerla. */
  readonly onRoleGranted: (userId: string, role: Role) => void;
}): PendingRoleRequests {
  const [state, setState] = useState<PendingRequestsState>({
    kind: "loading",
  });
  const [notice, setNotice] = useState<AdministrationNoticeState>(null);

  // El estado se toca cuando la API contesta, en la continuación, y no en el
  // cuerpo del efecto: encender la carga no dispara un pintado en cascada, y
  // `loading` ya es el estado con el que nace.
  const applyLoad = useCallback((outcome: PendingRequestsLoad): void => {
    setState(asRequestsState(outcome));
  }, []);

  useEffect(() => {
    if (!isEnabled) {
      return;
    }
    void loadPendingRequests().then(applyLoad);
  }, [isEnabled, applyLoad]);

  function retry(): void {
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

  return { state, notice, decide, retry };
}
