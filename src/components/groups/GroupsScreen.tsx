"use client";

import { useEffect, useState } from "react";
import type { GroupRosterMember } from "@/lib/groups/group-members";
import { GROUP_PREVIEW_SIZE } from "@/lib/groups/group-overview";
import type { Group, GroupOverview } from "@/lib/groups/groups";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { compareNames } from "@/lib/text/name-order";
import { GroupList } from "./GroupList";
import { GroupMembersPanel } from "./GroupMembersPanel";
import { type GroupActionResult, GroupCreateForm } from "./GroupNameForm";
import type { GroupAction } from "./group-action";
import {
  GROUP_GONE,
  type GroupsFailure,
  type GroupsLoad,
  createGroup,
  deleteGroup,
  describeGroupsFailure,
  hasActionableCause,
  isGroupGone,
  loadGroups,
  renameGroup,
} from "./groups-client";
import { useChangeNotice } from "./use-change-notice";
import { usePendingAction } from "./use-pending-action";

/**
 * La pantalla Grupos (#228, rehecha en escritorio por #828, E32): la lista
 * compacta de los grupos del club a la izquierda y el panel del elegido a la
 * derecha. Sólo la alcanzan Admin, Coach y Committee, y quien lo comprueba es
 * la frontera, no esta pantalla.
 *
 * Es de cliente porque su razón de ser es cambiar sin recargar: crear un grupo
 * lo pone en la lista y quitar un socio baja el conteo de su fila. Lee y
 * escribe por la API v1, nunca contra la base, porque la aplicación nativa de
 * Release 2 usará esos mismos endpoints (CON-002). El idioma llega como prop
 * porque el traductor no puede cruzar del servidor al navegador.
 */

type ScreenState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: GroupsFailure }
  | { readonly kind: "ready"; readonly groups: readonly GroupOverview[] };

const UNUSED: GroupOverview["usage"] = { events: 0, posts: 0 };

/** La lista se ordena aquí y no sólo en el servidor porque cambia sin volver a
 * pedirla: un grupo recién creado o renombrado tiene que caer en su sitio. */
function byName(groups: readonly GroupOverview[]): readonly GroupOverview[] {
  return [...groups].sort((one, other) => compareNames(one.name, other.name));
}

function updateGroups(
  state: ScreenState,
  update: (groups: readonly GroupOverview[]) => readonly GroupOverview[],
): ScreenState {
  return state.kind === "ready"
    ? { kind: "ready", groups: update(state.groups) }
    : state;
}

/** Crear y renombrar responden el grupo a secas: el uso y la vista previa
 * son los que ya había, o ninguno si es nuevo. */
function withSavedGroup(state: ScreenState, saved: Group): ScreenState {
  return updateGroups(state, (groups) => {
    const existing = groups.find((group) => group.id === saved.id);
    const others = groups.filter((group) => group.id !== saved.id);
    const merged: GroupOverview = {
      usage: UNUSED,
      previewMembers: [],
      ...existing,
      ...saved,
    };
    return byName([...others, merged]);
  });
}

function withoutGroup(state: ScreenState, groupId: string): ScreenState {
  return updateGroups(state, (groups) =>
    groups.filter((group) => group.id !== groupId),
  );
}

/** El conteo y los avatares de la fila, con la misma regla que el servidor:
 * quien no activó su cuenta está en el grupo, pero no cuenta ni sale. */
function withMembers(
  state: ScreenState,
  groupId: string,
  members: readonly GroupRosterMember[],
): ScreenState {
  const active = members
    .filter((member) => !member.isPendingActivation)
    .sort((one, other) => compareNames(one.fullName, other.fullName));
  const previewMembers = active
    .slice(0, GROUP_PREVIEW_SIZE)
    .map(({ id, fullName, photoUrl }) => ({ id, fullName, photoUrl }));
  return updateGroups(state, (groups) =>
    groups.map((group) =>
      group.id === groupId
        ? { ...group, memberCount: active.length, previewMembers }
        : group,
    ),
  );
}

/** Una causa que se arregla de otra forma se dice tal cual: quien perdió la
 * sesión tiene que volver a entrar, y reintentar no le sirve de nada. */
function LoadFailure({
  translate,
  failure,
  onRetry,
}: {
  translate: Translator;
  failure: GroupsFailure;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="admin-load-failure">
      <p className="auth-error" role="alert">
        {hasActionableCause(failure)
          ? describeGroupsFailure(translate, failure)
          : translate("groups.loadFailed")}
      </p>
      <button type="button" className="auth-submit" onClick={onRetry}>
        {translate("groups.retry")}
      </button>
    </div>
  );
}

export function GroupsScreen({
  locale,
}: {
  locale: Locale;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  // Se guarda el fallo y no la frase, para que el aviso que ya está a la vista
  // cambie de idioma con el interruptor en vez de quedarse en el de antes.
  const [failure, setFailure] = useState<GroupsFailure | null>(null);
  const pendingAction = usePendingAction<GroupAction>();
  const { pending, run } = pendingAction;
  const { notice, announce } = useChangeNotice();

  // Volver a intentarlo cuenta como una lectura más, y por eso es el efecto
  // quien pide la lista: así el pedido vive en un solo sitio y el estado se
  // toca en la continuación, no en el cuerpo del efecto.
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    void loadGroups().then((outcome: GroupsLoad) => {
      setState(
        outcome.kind === "loaded"
          ? { kind: "ready", groups: byName(outcome.groups) }
          : { kind: "failed", failure: outcome },
      );
    });
  }, [reloads]);

  function retryLoad(): void {
    setState({ kind: "loading" });
    setFailure(null);
    setReloads((count) => count + 1);
  }

  /** Un grupo que el servidor ya no reconoce sale de la lista y el panel
   * vuelve a "Elige un grupo": otro lo borró mientras estaba a la vista. */
  function forgetGroup(groupId: string): void {
    setState((current) => withoutGroup(current, groupId));
    setSelectedGroupId((selected) => (selected === groupId ? null : selected));
  }

  function reportFailure(outcome: GroupsFailure, groupId: string): "failed" {
    if (isGroupGone(outcome)) {
      forgetGroup(groupId);
    }
    setFailure(outcome);
    return "failed";
  }

  async function create(name: string): Promise<GroupActionResult> {
    const result = await run({ kind: "create" }, async () => {
      const outcome = await createGroup(name);
      if (outcome.kind === "failed") {
        setFailure(outcome);
        return "failed";
      }
      setState((current) => withSavedGroup(current, outcome.group));
      setSelectedGroupId(outcome.group.id);
      setFailure(null);
      announce(translate("groups.create.done", { name: outcome.group.name }));
      return "done";
    });
    return result ?? "failed";
  }

  async function rename(
    group: GroupOverview,
    name: string,
  ): Promise<GroupActionResult> {
    const result = await run({ kind: "rename" }, async () => {
      const outcome = await renameGroup(group.id, name);
      if (outcome.kind === "failed") {
        return reportFailure(outcome, group.id);
      }
      setState((current) => withSavedGroup(current, outcome.group));
      setFailure(null);
      announce(translate("groups.renamed"));
      return "done";
    });
    return result ?? "failed";
  }

  function remove(group: GroupOverview): void {
    void run({ kind: "delete" }, async () => {
      const outcome = await deleteGroup(group.id);
      if (outcome.kind === "failed") {
        reportFailure(outcome, group.id);
        return;
      }
      forgetGroup(group.id);
      setFailure(null);
      announce(translate("groups.deleted", { name: group.name }));
    });
  }

  /** Lo llama el panel cuando el servidor le dice que su grupo ya no está. */
  function forgetSelectedGroup(): void {
    if (selectedGroupId === null) {
      return;
    }
    forgetGroup(selectedGroupId);
    setFailure(GROUP_GONE);
  }

  const groups = state.kind === "ready" ? state.groups : [];
  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  const isDisabled = pending !== null;

  return (
    <div className="groups">
      <div className="groups-head">
        <h1>{translate("groups.title")}</h1>
        <p className="app-lead">{translate("groups.lead")}</p>
      </div>
      <p className="groups-notice" role="status">
        {notice}
      </p>
      {state.kind === "loading" ? (
        <p className="admin-empty">{translate("groups.loading")}</p>
      ) : null}
      {state.kind === "failed" ? (
        <LoadFailure
          translate={translate}
          failure={state.failure}
          onRetry={retryLoad}
        />
      ) : null}
      {failure === null ? null : (
        <p className="auth-error" role="alert">
          {describeGroupsFailure(translate, failure)}
        </p>
      )}
      {state.kind === "ready" ? (
        <div className="groups-layout">
          <section className="groups-column" aria-labelledby="grupos-del-club">
            <h2 id="grupos-del-club" className="visually-hidden">
              {translate("groups.list.title")}
            </h2>
            <GroupCreateForm
              translate={translate}
              takenNames={groups.map((group) => group.name)}
              isDisabled={isDisabled}
              isSaving={pending?.kind === "create"}
              onSubmit={create}
            />
            <GroupList
              translate={translate}
              groups={groups}
              selectedGroupId={selectedGroupId}
              isDisabled={isDisabled}
              onSelect={(group) =>
                setSelectedGroupId((selected) =>
                  selected === group.id ? null : group.id,
                )
              }
            />
          </section>
          {selectedGroup === undefined ? (
            groups.length === 0 ? null : (
              <p className="groups-panel-placeholder">
                {translate("groups.panel.empty")}
              </p>
            )
          ) : (
            <GroupMembersPanel
              key={selectedGroup.id}
              translate={translate}
              group={selectedGroup}
              pendingAction={pendingAction}
              onMembersChange={(members) =>
                setState((current) =>
                  withMembers(current, selectedGroup.id, members),
                )
              }
              onGroupGone={forgetSelectedGroup}
              onRename={(name) => rename(selectedGroup, name)}
              onDelete={() => remove(selectedGroup)}
              onNotice={announce}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
