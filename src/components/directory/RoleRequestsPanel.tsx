"use client";

import type { Translator } from "@/lib/i18n/translator";
import { PendingRequestsTray } from "./PendingRequestsTray";
import type { PendingRoleRequests } from "./use-pending-role-requests";

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
 * volver a intentarlo sólo repite lo que falló. Desde #548 la carga y las
 * decisiones viven en `usePendingRoleRequests`, que la pantalla comparte con
 * la cabecera; aquí sólo se pintan.
 */

/** El destino del enlace "{n} solicitudes esperando" de la cabecera. */
export const ROLE_REQUESTS_HEADING_ID = "solicitudes-pendientes";

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

export function RoleRequestsPanel({
  translate,
  pendingRequests,
}: {
  translate: Translator;
  pendingRequests: PendingRoleRequests;
}): React.JSX.Element {
  const { state, notice, decide, retry } = pendingRequests;
  return (
    <section
      className="admin-section"
      aria-labelledby={ROLE_REQUESTS_HEADING_ID}
    >
      <h2 id={ROLE_REQUESTS_HEADING_ID}>{translate("admin.requests.title")}</h2>
      {state.kind === "loading" ? (
        <p className="admin-empty">{translate("admin.loading")}</p>
      ) : null}
      {state.kind === "failed" ? (
        <LoadFailure translate={translate} onRetry={retry} />
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
