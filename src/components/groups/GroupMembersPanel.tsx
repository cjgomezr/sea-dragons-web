"use client";

import { useEffect, useState } from "react";
import type { EmailRecipient } from "@/components/directory/DirectoryEmailComposer";
import type { GroupRosterMember } from "@/lib/groups/group-members";
import type { GroupOverview } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";
import { compareNames } from "@/lib/text/name-order";
import { GroupAudienceColumn } from "./GroupAudienceColumn";
import type { GroupActionResult } from "./GroupNameForm";
import { GroupMemberList } from "./GroupMemberList";
import { GroupPanelHeader } from "./GroupPanelHeader";
import type { GroupAction } from "./group-action";
import {
  type GroupRoster,
  type GroupRosterLoad,
  type GroupsFailure,
  assignMember,
  describeGroupsFailure,
  isGroupGone,
  loadGroupRoster,
  removeMember,
} from "./groups-client";
import type { PendingAction } from "./use-pending-action";

/**
 * El panel del grupo elegido, a la derecha de la lista (#828, RF-3 de E32):
 * la cabecera con el resumen, renombrar y borrar, la columna de miembros y,
 * desde #830, la de "Audiencia de" y Escribir a todos.
 *
 * El panel pide sus dos listas al abrirse y las mantiene él. Lo que la lista
 * de la izquierda enseña de este grupo (su conteo y sus avatares) se lo dice a
 * quien lo dibuja, para que no tenga que volver a pedirla.
 */

type RosterState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  /** El servidor respondió que el grupo ya no existe. Se guarda como estado en
   * vez de avisar al padre desde la carga: avisarle es lo que lo desmonta, y
   * eso no se hace desde dentro de la petición. */
  | { readonly kind: "gone" }
  | ({ readonly kind: "ready" } & GroupRoster);

function readRoster(outcome: GroupRosterLoad): RosterState {
  if (outcome.kind === "loaded") {
    return {
      kind: "ready",
      members: outcome.members,
      candidates: outcome.candidates,
    };
  }
  return isGroupGone(outcome) ? { kind: "gone" } : { kind: "failed" };
}

function byName(
  members: readonly GroupRosterMember[],
): readonly GroupRosterMember[] {
  return [...members].sort((one, other) =>
    compareNames(one.fullName, other.fullName),
  );
}

/** A quién escribe "Escribir a todos": los activos, no los pendientes de
 * activar (D7). `null` mientras no se sabe quiénes son. */
function emailRecipientsOf(
  state: RosterState,
): readonly EmailRecipient[] | null {
  if (state.kind !== "ready") {
    return null;
  }
  return state.members
    .filter((member) => !member.isPendingActivation)
    .map(({ id, fullName }) => ({ userId: id, fullName }));
}

function countNotActivated(state: RosterState): number {
  return state.kind === "ready"
    ? state.members.filter((member) => member.isPendingActivation).length
    : 0;
}

export function GroupMembersPanel({
  translate,
  group,
  pendingAction,
  onMembersChange,
  onGroupGone,
  onRename,
  onDelete,
  onNotice,
  onWriteToAll,
}: {
  translate: Translator;
  group: GroupOverview;
  /** La única acción en vuelo de toda la pantalla. */
  pendingAction: PendingAction<GroupAction>;
  onMembersChange: (members: readonly GroupRosterMember[]) => void;
  /** El servidor dice que ese grupo ya no está: quien dibuja el panel lo saca
   * de la lista y vuelve a "Elige un grupo". */
  onGroupGone: () => void;
  onRename: (name: string) => Promise<GroupActionResult>;
  onDelete: () => void;
  onNotice: (notice: string) => void;
  /** Abre el redactor del Directorio; `null` si quien mira no puede (D6). */
  onWriteToAll: ((recipients: readonly EmailRecipient[]) => void) | null;
}): React.JSX.Element {
  const [state, setState] = useState<RosterState>({ kind: "loading" });
  // Se guarda el fallo y no la frase: el aviso que ya está a la vista cambia
  // de idioma con el interruptor (E17).
  const [failure, setFailure] = useState<GroupsFailure | null>(null);
  const { pending, run } = pendingAction;

  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    void loadGroupRoster(group.id).then((outcome) =>
      setState(readRoster(outcome)),
    );
  }, [group.id, reloads]);

  useEffect(() => {
    if (state.kind === "gone") {
      onGroupGone();
    }
  }, [state.kind, onGroupGone]);

  function retryLoad(): void {
    setState({ kind: "loading" });
    setFailure(null);
    setReloads((count) => count + 1);
  }

  /** Un fallo que deja el grupo fuera de uso vuelve a la lista; el resto sólo
   * se cuenta, y lo que se intentaba no se da por hecho.
   *
   * Aquí sí se avisa al padre en el acto, sin pasar por el estado `gone`: esto
   * sale de un clic y no de la carga, así que el panel ya está pintado y
   * desmontarlo no interrumpe ningún efecto a medias. */
  function reportFailure(outcome: GroupsFailure): void {
    if (isGroupGone(outcome)) {
      onGroupGone();
      return;
    }
    setFailure(outcome);
  }

  function applyRoster(roster: GroupRoster): void {
    setState({ kind: "ready", ...roster });
    setFailure(null);
    onMembersChange(roster.members);
  }

  /** La respuesta trae el socio a secas; su posición y su foto son las que
   * ya enseñaba el selector. */
  function add(roster: GroupRoster, candidate: GroupRosterMember): void {
    void run({ kind: "assign" }, async () => {
      const outcome = await assignMember(group.id, candidate.id);
      if (outcome.kind === "failed") {
        reportFailure(outcome);
        return;
      }
      applyRoster({
        members: byName([
          ...roster.members,
          { ...candidate, ...outcome.member },
        ]),
        candidates: roster.candidates.filter(
          (other) => other.id !== candidate.id,
        ),
      });
      onNotice(
        translate("groups.members.added", {
          name: candidate.fullName,
          group: group.name,
        }),
      );
    });
  }

  function remove(roster: GroupRoster, member: GroupRosterMember): void {
    void run({ kind: "remove", userId: member.id }, async () => {
      const outcome = await removeMember(group.id, member.id);
      if (outcome.kind === "failed") {
        reportFailure(outcome);
        return;
      }
      applyRoster({
        members: roster.members.filter((other) => other.id !== member.id),
        candidates: byName([...roster.candidates, member]),
      });
      onNotice(
        translate("groups.members.removed", {
          name: member.fullName,
          group: group.name,
        }),
      );
    });
  }

  const isDisabled = pending !== null;

  return (
    <section className="groups-panel" aria-label={group.name}>
      <GroupPanelHeader
        translate={translate}
        group={group}
        notActivatedCount={countNotActivated(state)}
        writeToAll={
          onWriteToAll === null
            ? null
            : { recipients: emailRecipientsOf(state), onOpen: onWriteToAll }
        }
        isDisabled={isDisabled}
        isDeleting={pending?.kind === "delete"}
        onRename={onRename}
        onDelete={onDelete}
      />
      {failure === null ? null : (
        <p className="auth-error groups-panel-error" role="alert">
          {describeGroupsFailure(translate, failure)}
        </p>
      )}
      <div className="groups-panel-body">
        <div className="groups-panel-members">
          {state.kind === "loading" ? (
            <p className="groups-members-empty">
              {translate("groups.members.loading")}
            </p>
          ) : null}
          {state.kind === "failed" ? (
            <div className="admin-load-failure groups-panel-error">
              <p className="auth-error" role="alert">
                {translate("groups.members.loadFailed")}
              </p>
              <button type="button" className="auth-submit" onClick={retryLoad}>
                {translate("groups.retry")}
              </button>
            </div>
          ) : null}
          {state.kind === "ready" ? (
            <GroupMemberList
              translate={translate}
              groupName={group.name}
              roster={state}
              isDisabled={isDisabled}
              isAdding={pending?.kind === "assign"}
              onAdd={(candidate) => add(state, candidate)}
              onRemove={(member) => remove(state, member)}
            />
          ) : null}
        </div>
        <GroupAudienceColumn
          translate={translate}
          groupId={group.id}
          onGroupGone={onGroupGone}
        />
      </div>
    </section>
  );
}
