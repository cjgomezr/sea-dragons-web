"use client";

import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { MemberAvatar } from "@/components/MemberAvatar";
import type { Translator } from "@/lib/i18n/translator";
import { matchesNameSearch } from "@/lib/text/name-search";
import type { GroupActionResult } from "./GroupNameForm";
import { describeCandidate } from "./group-texts";
import type { RosterCandidate } from "./groups-client";

/**
 * El selector de "Añadir miembros" (#829, RF-4 de E32): buscar entre quienes
 * no están en el grupo, marcar a varios y mandarlos en un solo POST (D3).
 *
 * Lo marcado se guarda por id y sobrevive a la búsqueda: quien busca a Bea
 * después de marcar a Ana sigue llevándose a las dos.
 */

const CANDIDATE_AVATAR_SIZE = 28;

function CandidateRow({
  translate,
  candidate,
  isChosen,
  isDisabled,
  onToggle,
}: {
  translate: Translator;
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
          size={CANDIDATE_AVATAR_SIZE}
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
  candidates,
  chosenIds,
  isDisabled,
  onToggle,
}: {
  translate: Translator;
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

export function GroupMemberPicker({
  translate,
  groupName,
  candidates,
  isDisabled,
  isAdding,
  onAdd,
  onClose,
}: {
  translate: Translator;
  groupName: string;
  candidates: readonly RosterCandidate[];
  /** Hay una acción en vuelo en la pantalla. */
  isDisabled: boolean;
  isAdding: boolean;
  onAdd: (chosen: readonly RosterCandidate[]) => Promise<GroupActionResult>;
  onClose: () => void;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [chosenIds, setChosenIds] = useState<readonly string[]>([]);
  // En el orden de la lista, y sólo quien sigue en ella.
  const chosen = candidates.filter((candidate) =>
    chosenIds.includes(candidate.id),
  );
  const shown = candidates.filter((candidate) =>
    matchesNameSearch(candidate.fullName, search),
  );

  async function submit(): Promise<void> {
    if ((await onAdd(chosen)) === "done") {
      onClose();
    }
  }

  return (
    <div
      role="group"
      aria-label={translate("groups.picker.label", { group: groupName })}
      className="groups-picker"
    >
      {candidates.length === 0 ? (
        <p className="groups-picker-empty">
          {translate("groups.picker.everyoneIn")}
        </p>
      ) : (
        <>
          <PickerSearch
            translate={translate}
            search={search}
            onSearch={setSearch}
          />
          <CandidateList
            translate={translate}
            candidates={shown}
            chosenIds={chosenIds}
            isDisabled={isDisabled}
            onToggle={(candidate) =>
              setChosenIds((ids) => toggled(ids, candidate.id))
            }
          />
        </>
      )}
      <div className="groups-picker-footer">
        {candidates.length === 0 ? null : (
          <p className="groups-picker-count">
            {chosen.length > 0
              ? translate("groups.picker.selected", { count: chosen.length })
              : translate("groups.picker.outside", {
                  count: candidates.length,
                })}
          </p>
        )}
        <button
          type="button"
          className="groups-text-button"
          disabled={isDisabled}
          onClick={onClose}
        >
          {translate("groups.cancel")}
        </button>
        <button
          type="button"
          className="auth-submit groups-picker-submit"
          disabled={isDisabled || chosen.length === 0}
          onClick={() => void submit()}
        >
          {isAdding
            ? translate("groups.picker.adding")
            : translate("groups.picker.submit", { count: chosen.length })}
        </button>
      </div>
    </div>
  );
}
