"use client";

import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cycleFocus } from "@/components/focus-cycle";
import { Icon } from "@/components/Icon";
import { MemberAvatar } from "@/components/MemberAvatar";
import type { Translator } from "@/lib/i18n/translator";
import { matchesNameSearch } from "@/lib/text/name-search";
import type { GroupActionResult } from "./GroupNameForm";
import { describeCandidate } from "./group-texts";
import type { RosterCandidate } from "./groups-client";
import type { GroupsLayout } from "./groups-layout";

/**
 * El selector de "Añadir miembros" (#829, RF-4 de E32): buscar entre quienes
 * no están en el grupo, marcar a varios y mandarlos en un solo POST (D3).
 *
 * Lo marcado se guarda por id y sobrevive a la búsqueda: quien busca a Bea
 * después de marcar a Ana sigue llevándose a las dos.
 *
 * En escritorio va en línea, debajo de la barra. En el móvil (#832) es una
 * ventana a pantalla completa con la misma lógica: Cancelar y "Añadir a
 * {grupo}" arriba, y el botón de añadir fijo abajo.
 */

const CANDIDATE_AVATAR_SIZE: Readonly<Record<GroupsLayout, number>> = {
  desktop: 28,
  compact: 36,
};

function CandidateRow({
  translate,
  layout,
  candidate,
  isChosen,
  isDisabled,
  onToggle,
}: {
  translate: Translator;
  layout: GroupsLayout;
  candidate: RosterCandidate;
  isChosen: boolean;
  isDisabled: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const rowId = useId();
  const nameId = `${rowId}-name`;
  const detailId = `${rowId}-detail`;
  const detail = describeCandidate(translate, candidate);
  return (
    <li>
      <label className="groups-picker-row">
        <input
          type="checkbox"
          checked={isChosen}
          disabled={isDisabled}
          aria-labelledby={nameId}
          aria-describedby={detail === "" ? undefined : detailId}
          onChange={onToggle}
        />
        <MemberAvatar
          className="groups-picker-avatar"
          fullName={candidate.fullName}
          photoUrl={candidate.photoUrl}
          size={CANDIDATE_AVATAR_SIZE[layout]}
        />
        <span id={nameId} className="groups-picker-name">
          {candidate.fullName}
        </span>
        {detail === "" ? null : (
          <span id={detailId} className="groups-picker-detail">
            {detail}
          </span>
        )}
      </label>
    </li>
  );
}

function CandidateList({
  translate,
  layout,
  candidates,
  chosenIds,
  isDisabled,
  onToggle,
}: {
  translate: Translator;
  layout: GroupsLayout;
  candidates: readonly RosterCandidate[];
  chosenIds: readonly string[];
  isDisabled: boolean;
  onToggle: (candidate: RosterCandidate) => void;
}): React.JSX.Element {
  if (candidates.length === 0) {
    return (
      <p className="groups-picker-empty">
        {translate("groups.picker.noMatch")}
      </p>
    );
  }
  return (
    <ul className="groups-picker-list">
      {candidates.map((candidate) => (
        <CandidateRow
          key={candidate.id}
          translate={translate}
          layout={layout}
          candidate={candidate}
          isChosen={chosenIds.includes(candidate.id)}
          isDisabled={isDisabled}
          onToggle={() => onToggle(candidate)}
        />
      ))}
    </ul>
  );
}

function PickerSearch({
  translate,
  search,
  onSearch,
}: {
  translate: Translator;
  search: string;
  onSearch: (search: string) => void;
}): React.JSX.Element {
  const label = translate("groups.picker.search");
  const fieldRef = useRef<HTMLInputElement>(null);

  // Quien abre el selector viene a buscar a alguien.
  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  return (
    <label className="groups-search groups-picker-search">
      <Icon glyph={MagnifyingGlass} />
      <input
        ref={fieldRef}
        type="search"
        value={search}
        placeholder={label}
        aria-label={label}
        onChange={(event) => onSearch(event.target.value)}
      />
    </label>
  );
}

function toggled(ids: readonly string[], id: string): readonly string[] {
  return ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
}

/** La búsqueda y las filas, o "todo el club está ya" si no queda nadie. */
function PickerBody({
  translate,
  layout,
  candidates,
  chosenIds,
  isDisabled,
  onChosenIdsChange,
}: {
  translate: Translator;
  layout: GroupsLayout;
  candidates: readonly RosterCandidate[];
  chosenIds: readonly string[];
  isDisabled: boolean;
  onChosenIdsChange: (ids: readonly string[]) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  if (candidates.length === 0) {
    return (
      <p className="groups-picker-empty">
        {translate("groups.picker.everyoneIn")}
      </p>
    );
  }
  return (
    <>
      <PickerSearch
        translate={translate}
        search={search}
        onSearch={setSearch}
      />
      <CandidateList
        translate={translate}
        layout={layout}
        candidates={candidates.filter((candidate) =>
          matchesNameSearch(candidate.fullName, search),
        )}
        chosenIds={chosenIds}
        isDisabled={isDisabled}
        onToggle={(candidate) =>
          onChosenIdsChange(toggled(chosenIds, candidate.id))
        }
      />
    </>
  );
}

/** Lo que las dos formas del selector pintan igual. */
type PickerView = {
  readonly translate: Translator;
  readonly groupName: string;
  readonly candidates: readonly RosterCandidate[];
  readonly chosenCount: number;
  readonly body: React.ReactNode;
  /** Hay una acción en vuelo en la pantalla. */
  readonly isDisabled: boolean;
  readonly isAdding: boolean;
  readonly onSubmit: () => Promise<GroupActionResult>;
  /** Ya cerrado: quien lo abrió lo desmonta y recoge el foco. */
  readonly onClose: () => void;
};

function SubmitButton({
  view,
  onClick,
}: {
  view: PickerView;
  onClick: () => void;
}): React.JSX.Element {
  const { translate, chosenCount } = view;
  return (
    <button
      type="button"
      className="auth-submit groups-picker-submit"
      disabled={view.isDisabled || chosenCount === 0}
      onClick={onClick}
    >
      {view.isAdding
        ? translate("groups.picker.adding")
        : translate("groups.picker.submit", { count: chosenCount })}
    </button>
  );
}

function InlinePicker({ view }: { view: PickerView }): React.JSX.Element {
  const { translate, candidates, chosenCount } = view;

  async function submit(): Promise<void> {
    if ((await view.onSubmit()) === "done") {
      view.onClose();
    }
  }

  return (
    <div
      role="group"
      aria-label={translate("groups.picker.label", { group: view.groupName })}
      className="groups-picker"
    >
      {view.body}
      <div className="groups-picker-footer">
        {candidates.length === 0 ? null : (
          <p className="groups-picker-count">
            {chosenCount > 0
              ? translate("groups.picker.selected", { count: chosenCount })
              : translate("groups.picker.outside", {
                  count: candidates.length,
                })}
          </p>
        )}
        <button
          type="button"
          className="groups-text-button"
          disabled={view.isDisabled}
          onClick={view.onClose}
        >
          {translate("groups.cancel")}
        </button>
        <SubmitButton view={view} onClick={() => void submit()} />
      </div>
    </div>
  );
}

/** El selector del móvil: un `<dialog>` modal que ocupa la pantalla. Se
 * cierra con `close`, y no desmontándolo, para que el foco vuelva a "Añadir
 * miembros" cuando lo de detrás ya no está inerte. Si el alta falla sigue
 * abierto y lo dice dentro, porque la pantalla del grupo queda tapada. */
function PhonePicker({
  view,
  failureMessage,
}: {
  view: PickerView;
  /** El último fallo de la pantalla; sólo se enseña si fue del alta. */
  failureMessage: string | null;
}): React.JSX.Element {
  const { translate } = view;
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [hasFailed, setHasFailed] = useState(false);

  // Antes que los efectos de los hijos: la búsqueda pone el foco en sí misma
  // al montarse, y `showModal` lo movería al primer control si fuera después.
  useLayoutEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function close(): void {
    dialogRef.current?.close();
  }

  async function submit(): Promise<void> {
    setHasFailed(false);
    if ((await view.onSubmit()) === "done") {
      close();
      return;
    }
    setHasFailed(true);
  }

  return (
    <dialog
      ref={dialogRef}
      className="groups-picker-screen"
      aria-labelledby={titleId}
      onClose={view.onClose}
      // Mientras añade no se cierra con Escape: la respuesta se ve aquí.
      onCancel={(event) => {
        if (view.isDisabled) {
          event.preventDefault();
        }
      }}
      onKeyDown={(event) => cycleFocus(event, dialogRef.current)}
    >
      <div className="groups-picker-screen-bar">
        <button
          type="button"
          className="groups-text-button"
          disabled={view.isDisabled}
          onClick={close}
        >
          {translate("groups.cancel")}
        </button>
        <h2 id={titleId}>
          {translate("groups.picker.phoneTitle", { group: view.groupName })}
        </h2>
      </div>
      <div className="groups-picker-screen-body">{view.body}</div>
      {hasFailed && failureMessage !== null ? (
        <p className="auth-error groups-picker-screen-error" role="alert">
          {failureMessage}
        </p>
      ) : null}
      <div className="groups-picker-screen-footer">
        <SubmitButton view={view} onClick={() => void submit()} />
      </div>
    </dialog>
  );
}

export function GroupMemberPicker({
  translate,
  layout,
  groupName,
  candidates,
  failureMessage,
  isDisabled,
  isAdding,
  onAdd,
  onClose,
}: {
  translate: Translator;
  layout: GroupsLayout;
  groupName: string;
  candidates: readonly RosterCandidate[];
  /** El fallo que la pantalla tiene a la vista, ya en palabras. */
  failureMessage: string | null;
  /** Hay una acción en vuelo en la pantalla. */
  isDisabled: boolean;
  isAdding: boolean;
  onAdd: (chosen: readonly RosterCandidate[]) => Promise<GroupActionResult>;
  onClose: () => void;
}): React.JSX.Element {
  const [chosenIds, setChosenIds] = useState<readonly string[]>([]);
  // En el orden de la lista, y sólo quien sigue en ella.
  const chosen = candidates.filter((candidate) =>
    chosenIds.includes(candidate.id),
  );
  const view: PickerView = {
    translate,
    groupName,
    candidates,
    chosenCount: chosen.length,
    body: (
      <PickerBody
        translate={translate}
        layout={layout}
        candidates={candidates}
        chosenIds={chosenIds}
        isDisabled={isDisabled}
        onChosenIdsChange={setChosenIds}
      />
    ),
    isDisabled,
    isAdding,
    onSubmit: () => onAdd(chosen),
    onClose,
  };
  return layout === "compact" ? (
    <PhonePicker view={view} failureMessage={failureMessage} />
  ) : (
    <InlinePicker view={view} />
  );
}
