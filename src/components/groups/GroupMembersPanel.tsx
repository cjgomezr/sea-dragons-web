"use client";

import { useEffect, useId, useState } from "react";
import { memberInitials } from "@/lib/auth/member-initials";
import type { GroupMember } from "@/lib/groups/group-members";
import type { Group } from "@/lib/groups/groups";
import { compareNames } from "@/lib/groups/name-order";
import type { Translator } from "@/lib/i18n/translator";
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
import { usePendingAction } from "./use-pending-action";

/**
 * Los socios de un grupo abierto y el selector con los que todavía puede
 * recibir (RF-6 y RF-7 del PRD de E4). La fila de socio es la de
 * docs/mockups/directory-light.png reducida a lo que se puede enseñar a quien
 * gestiona grupos: iniciales y nombre, sin correo ni nada más.
 *
 * El panel pide sus dos listas al abrirse y las mantiene él: el conteo de la
 * fila de arriba se lo dice a quien lo dibuja, para que la lista de grupos no
 * tenga que volver a pedirla.
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

type PendingMemberAction =
  | { readonly kind: "assign" }
  | { readonly kind: "remove"; readonly userId: string };

function byName(members: readonly GroupMember[]): readonly GroupMember[] {
  return [...members].sort((one, other) =>
    compareNames(one.fullName, other.fullName),
  );
}

function MemberRow({
  translate,
  member,
  isDisabled,
  isRemoving,
  onRemove,
}: {
  translate: Translator;
  member: GroupMember;
  isDisabled: boolean;
  isRemoving: boolean;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <li className="admin-member">
      <span className="admin-member-avatar" aria-hidden="true">
        {memberInitials(member.fullName)}
      </span>
      <div className="admin-member-identity">
        <span className="admin-member-name">{member.fullName}</span>
      </div>
      <button
        type="button"
        className="admin-secondary"
        aria-label={translate("groups.members.removeLabel", {
          name: member.fullName,
        })}
        disabled={isDisabled}
        onClick={onRemove}
      >
        {translate(
          isRemoving ? "groups.members.removing" : "groups.members.remove",
        )}
      </button>
    </li>
  );
}

function CandidatePicker({
  translate,
  candidates,
  chosen,
  isDisabled,
  isAdding,
  onChoose,
  onAdd,
}: {
  translate: Translator;
  candidates: readonly GroupMember[];
  chosen: GroupMember;
  isDisabled: boolean;
  isAdding: boolean;
  onChoose: (userId: string) => void;
  onAdd: () => void;
}): React.JSX.Element {
  const fieldId = useId();
  return (
    <div className="groups-add">
      <div className="auth-field">
        <label htmlFor={fieldId}>{translate("groups.members.addLabel")}</label>
        <select
          id={fieldId}
          value={chosen.id}
          disabled={isDisabled}
          onChange={(event) => onChoose(event.target.value)}
        >
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.fullName}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="auth-submit"
        disabled={isDisabled}
        onClick={onAdd}
      >
        {translate(isAdding ? "groups.members.adding" : "groups.members.add")}
      </button>
    </div>
  );
}

export function GroupMembersPanel({
  translate,
  group,
  onMemberCountChange,
  onGroupGone,
  onClose,
}: {
  translate: Translator;
  group: Group;
  onMemberCountChange: (memberCount: number) => void;
  /** El servidor dice que ese grupo ya no está: quien dibuja el panel lo saca
   * de la lista y lo cierra. */
  onGroupGone: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const [state, setState] = useState<RosterState>({ kind: "loading" });
  // Se guarda el fallo y no la frase: el aviso que ya está a la vista cambia
  // de idioma con el interruptor (E17).
  const [failure, setFailure] = useState<GroupsFailure | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const { pending, run } = usePendingAction<PendingMemberAction>();

  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    void loadGroupRoster(group.id).then((outcome) =>
      setState(readRoster(outcome)),
    );
  }, [group.id, reloads]);

  // Un grupo que ya no está se lo cuenta el panel a quien lo dibuja, que es
  // quien lo saca de la lista y lo cierra.
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

  /** Un fallo que deja el grupo fuera de uso cierra el panel; el resto sólo se
   * cuenta, y lo que se intentaba no se da por hecho.
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
    onMemberCountChange(roster.members.length);
  }

  function add(roster: GroupRoster, candidate: GroupMember): void {
    void run({ kind: "assign" }, async () => {
      const outcome = await assignMember(group.id, candidate.id);
      if (outcome.kind === "failed") {
        reportFailure(outcome);
        return;
      }
      applyRoster({
        members: byName([...roster.members, outcome.member]),
        candidates: roster.candidates.filter(
          (other) => other.id !== candidate.id,
        ),
      });
    });
  }

  function remove(roster: GroupRoster, member: GroupMember): void {
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
    });
  }

  const title = translate("groups.members.title", { name: group.name });
  const isDisabled = pending !== null;
  /** Quien esté elegido, o el primero de la lista: una opción que acaba de
   * salir del selector no puede seguir siendo la elegida. */
  const chosen =
    state.kind === "ready"
      ? (state.candidates.find((candidate) => candidate.id === chosenId) ??
        state.candidates[0])
      : undefined;

  return (
    <section className="admin-section groups-detail" aria-label={title}>
      <div className="groups-detail-head">
        <h2>{title}</h2>
        <button type="button" className="admin-secondary" onClick={onClose}>
          {translate("groups.members.close")}
        </button>
      </div>
      {state.kind === "loading" ? (
        <p className="admin-empty">{translate("groups.members.loading")}</p>
      ) : null}
      {state.kind === "failed" ? (
        <div className="admin-load-failure">
          <p className="auth-error" role="alert">
            {translate("groups.members.loadFailed")}
          </p>
          <button type="button" className="auth-submit" onClick={retryLoad}>
            {translate("groups.retry")}
          </button>
        </div>
      ) : null}
      {failure === null ? null : (
        <p className="auth-error" role="alert">
          {describeGroupsFailure(translate, failure)}
        </p>
      )}
      {state.kind === "ready" ? (
        <>
          {chosen === undefined ? (
            <p className="admin-empty">
              {translate("groups.members.noCandidates")}
            </p>
          ) : (
            <CandidatePicker
              translate={translate}
              candidates={state.candidates}
              chosen={chosen}
              isDisabled={isDisabled}
              isAdding={pending?.kind === "assign"}
              onChoose={setChosenId}
              onAdd={() => add(state, chosen)}
            />
          )}
          {state.members.length === 0 ? (
            <p className="admin-empty">{translate("groups.members.empty")}</p>
          ) : (
            <ul className="admin-members">
              {state.members.map((member) => (
                <MemberRow
                  key={member.id}
                  translate={translate}
                  member={member}
                  isDisabled={isDisabled}
                  isRemoving={
                    pending?.kind === "remove" && pending.userId === member.id
                  }
                  onRemove={() => remove(state, member)}
                />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
