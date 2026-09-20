"use client";

import { useEffect, useState } from "react";
import type { Group } from "@/lib/groups/groups";
import { compareNames } from "@/lib/groups/name-order";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { GroupList } from "./GroupList";
import { GroupMembersPanel } from "./GroupMembersPanel";
import type { GroupActionResult } from "./GroupNameForm";
import {
  GROUP_GONE,
  type GroupsFailure,
  type GroupsLoad,
  createGroup,
  deleteGroup,
  describeGroupsFailure,
  isGroupGone,
  loadGroups,
  renameGroup,
} from "./groups-client";

/**
 * La pantalla Grupos (#228, RF-2 a RF-7 del PRD de E4): los grupos del club
 * con su conteo, y quién está en el que se abra. Sólo la alcanzan Admin, Coach
 * y Committee, y quien lo comprueba es la frontera, no esta pantalla.
 *
 * Es de cliente porque su razón de ser es cambiar sin recargar: crear un grupo
 * lo pone en la lista y meter un socio sube el conteo de su fila. Lee y
 * escribe por la API v1, nunca contra la base, porque la aplicación nativa de
 * Release 2 usará esos mismos endpoints (CON-002). El idioma llega como prop
 * porque el traductor no puede cruzar del servidor al navegador.
 */

type ScreenState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly groups: readonly Group[] };

/** La lista se ordena aquí y no sólo en el servidor porque cambia sin volver a
 * pedirla: un grupo recién creado o renombrado tiene que caer en su sitio. */
function byName(groups: readonly Group[]): readonly Group[] {
  return [...groups].sort((one, other) => compareNames(one.name, other.name));
}

function withGroup(state: ScreenState, group: Group): ScreenState {
  if (state.kind !== "ready") {
    return state;
  }
  const others = state.groups.filter((existing) => existing.id !== group.id);
  return { kind: "ready", groups: byName([...others, group]) };
}

function withoutGroup(state: ScreenState, groupId: string): ScreenState {
  return state.kind === "ready"
    ? {
        kind: "ready",
        groups: state.groups.filter((group) => group.id !== groupId),
      }
    : state;
}

function withMemberCount(
  state: ScreenState,
  groupId: string,
  memberCount: number,
): ScreenState {
  return state.kind === "ready"
    ? {
        kind: "ready",
        groups: state.groups.map((group) =>
          group.id === groupId ? { ...group, memberCount } : group,
        ),
      }
    : state;
}

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
        {translate("groups.loadFailed")}
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
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  // Se guarda el fallo y no la frase, para que el aviso que ya está a la vista
  // cambie de idioma con el interruptor en vez de quedarse en el de antes.
  const [failure, setFailure] = useState<GroupsFailure | null>(null);

  // Volver a intentarlo cuenta como una lectura más, y por eso es el efecto
  // quien pide la lista: así el pedido vive en un solo sitio y el estado se
  // toca en la continuación, no en el cuerpo del efecto.
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    void loadGroups().then((outcome: GroupsLoad) => {
      setState(
        outcome.kind === "loaded"
          ? { kind: "ready", groups: byName(outcome.groups) }
          : { kind: "failed" },
      );
    });
  }, [reloads]);

  function retryLoad(): void {
    setState({ kind: "loading" });
    setFailure(null);
    setReloads((count) => count + 1);
  }

  /** Un grupo que el servidor ya no reconoce sale de la lista y se cierra si
   * estaba abierto: otro lo borró mientras esta pantalla lo tenía delante. */
  function forgetGroup(groupId: string): void {
    setState((current) => withoutGroup(current, groupId));
    setOpenGroupId((open) => (open === groupId ? null : open));
  }

  function reportFailure(outcome: GroupsFailure, groupId: string): "failed" {
    if (isGroupGone(outcome)) {
      forgetGroup(groupId);
    }
    setFailure(outcome);
    return "failed";
  }

  async function create(name: string): Promise<GroupActionResult> {
    const outcome = await createGroup(name);
    if (outcome.kind === "failed") {
      setFailure(outcome);
      return "failed";
    }
    setState((current) => withGroup(current, outcome.group));
    setFailure(null);
    return "done";
  }

  async function rename(
    group: Group,
    name: string,
  ): Promise<GroupActionResult> {
    const outcome = await renameGroup(group.id, name);
    if (outcome.kind === "failed") {
      return reportFailure(outcome, group.id);
    }
    setState((current) => withGroup(current, outcome.group));
    setFailure(null);
    return "done";
  }

  async function remove(group: Group): Promise<GroupActionResult> {
    const outcome = await deleteGroup(group.id);
    if (outcome.kind === "failed") {
      return reportFailure(outcome, group.id);
    }
    forgetGroup(group.id);
    setFailure(null);
    return "done";
  }

  /** Lo llama el panel cuando el servidor le dice que su grupo ya no está. */
  function forgetOpenGroup(): void {
    if (openGroupId === null) {
      return;
    }
    forgetGroup(openGroupId);
    setFailure(GROUP_GONE);
  }

  const openGroup =
    state.kind === "ready"
      ? state.groups.find((group) => group.id === openGroupId)
      : undefined;

  return (
    <div className="groups">
      <h1>{translate("groups.title")}</h1>
      <p className="app-lead">{translate("groups.lead")}</p>
      {state.kind === "loading" ? (
        <p className="admin-empty">{translate("groups.loading")}</p>
      ) : null}
      {state.kind === "failed" ? (
        <LoadFailure translate={translate} onRetry={retryLoad} />
      ) : null}
      {state.kind === "ready" ? (
        <GroupList
          translate={translate}
          groups={state.groups}
          notice={
            failure === null ? null : describeGroupsFailure(translate, failure)
          }
          openGroupId={openGroupId}
          onOpen={(group) =>
            setOpenGroupId((open) => (open === group.id ? null : group.id))
          }
          onCreate={create}
          onRename={rename}
          onDelete={remove}
        />
      ) : null}
      {openGroup === undefined ? null : (
        <GroupMembersPanel
          key={openGroup.id}
          translate={translate}
          group={openGroup}
          onMemberCountChange={(memberCount) =>
            setState((current) =>
              withMemberCount(current, openGroup.id, memberCount),
            )
          }
          onGroupGone={forgetOpenGroup}
          onClose={() => setOpenGroupId(null)}
        />
      )}
    </div>
  );
}
