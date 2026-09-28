"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { loadGroups } from "@/components/groups/groups-client";
import type { Group } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";
import type { CreatedSummary } from "./event-create-client";
import { EventForm } from "./EventForm";

/**
 * El diálogo para crear un evento o una serie (#313, RF-9 del PRD de E7),
 * abierto con "+ Evento". Es un `<dialog>` modal: el navegador pone el rol,
 * la capa y deja inerte lo de detrás, como en el visor de la foto (#355).
 *
 * No se cierra al pulsar fuera: es un formulario, y un clic perdido no debe
 * tirar lo escrito. Escape y "Cancelar" sí lo cierran, salvo mientras guarda,
 * para no dar por cancelado algo que el servidor puede estar creando.
 *
 * Los grupos de la audiencia se leen del endpoint de E4, que alcanzan Admin y
 * Committee (`manageGroups`), así que son los vigentes del club.
 */

type GroupsState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly groups: readonly Group[] };

function useClubGroups(): {
  readonly groups: GroupsState;
  readonly retry: () => void;
} {
  const [groups, setGroups] = useState<GroupsState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    let isCurrent = true;
    void loadGroups().then((loaded) => {
      if (isCurrent) {
        setGroups(
          loaded.kind === "loaded"
            ? { kind: "ready", groups: loaded.groups }
            : { kind: "failed" },
        );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [reloads]);
  const retry = useCallback(() => {
    setGroups({ kind: "loading" });
    setReloads((count) => count + 1);
  }, []);
  return { groups, retry };
}

function GroupsFailure({
  translate,
  onRetry,
}: {
  readonly translate: Translator;
  readonly onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="admin-load-failure">
      <p className="auth-error" role="alert">
        {translate("calendar.form.loadFailed")}
      </p>
      <button type="button" className="auth-submit" onClick={onRetry}>
        {translate("calendar.form.retry")}
      </button>
    </div>
  );
}

export function EventDialog({
  translate,
  onCreated,
  onClosed,
}: {
  readonly translate: Translator;
  readonly onCreated: (summary: CreatedSummary) => void;
  /** Ya cerrado: quien lo abrió recupera el foco y lo desmonta. */
  readonly onClosed: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isSendingRef = useRef(false);
  const { groups, retry } = useClubGroups();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Todo cierre pasa por aquí, y el evento `close` del diálogo avisa.
  const close = useCallback(() => {
    if (!isSendingRef.current) {
      dialogRef.current?.close();
    }
  }, []);

  function handleCreated(summary: CreatedSummary): void {
    onCreated(summary);
    dialogRef.current?.close();
  }

  return (
    <dialog
      ref={dialogRef}
      className="event-dialog"
      aria-labelledby={titleId}
      onClose={onClosed}
      // El Escape del navegador llega como `cancel`; jsdom sólo manda la
      // tecla. Los dos pasan por `close`, que respeta el guardado en curso.
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className="event-dialog-panel">
        <div className="event-dialog-header">
          <h2 id={titleId} className="event-dialog-title">
            {translate("calendar.form.title")}
          </h2>
          <button
            type="button"
            className="photo-viewer-close"
            aria-label={translate("calendar.form.close")}
            onClick={close}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="event-dialog-body">
          {groups.kind === "loading" ? (
            <p className="admin-empty">{translate("calendar.form.loading")}</p>
          ) : null}
          {groups.kind === "failed" ? (
            <GroupsFailure translate={translate} onRetry={retry} />
          ) : null}
          {groups.kind === "ready" ? (
            <EventForm
              translate={translate}
              clubGroups={groups.groups}
              onCreated={handleCreated}
              onCancel={close}
              onSendingChange={(isSending) => {
                isSendingRef.current = isSending;
              }}
            />
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
