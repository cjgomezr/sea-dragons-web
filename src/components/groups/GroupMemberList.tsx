"use client";

import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { UserPlus } from "@phosphor-icons/react/dist/ssr/UserPlus";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { MemberAvatar } from "@/components/MemberAvatar";
import type { GroupRosterMember } from "@/lib/groups/group-members";
import type { Translator } from "@/lib/i18n/translator";
import { matchesNameSearch } from "@/lib/text/name-search";
import { GroupMemberPicker } from "./GroupMemberPicker";
import type { GroupActionResult } from "./GroupNameForm";
import type { GroupRoster, RosterCandidate } from "./groups-client";
import type { GroupsLayout } from "./groups-layout";

/**
 * La columna de miembros del panel de un grupo (#828, RF-3 de E32): buscar
 * dentro del grupo, la fila de cada miembro con su × y "Añadir miembros".
 *
 * Quitar no pide confirmación (D10): volver a añadir es fácil y el aviso dice
 * lo que pasó. "Añadir miembros" abre el selector de varios a la vez (#829).
 *
 * En el móvil (#831) "sin activar" va en la línea de la posición, en aviso, y
 * "Añadir miembros" va fijo abajo. Todavía abre el selector en línea: el de
 * pantalla completa es el ticket siguiente.
 */

const AVATAR_SIZE: Readonly<Record<GroupsLayout, number>> = {
  desktop: 32,
  compact: 38,
};

/** "posición · Sin activar", sin la parte que no haya. */
function CompactMemberDetail({
  translate,
  member,
}: {
  translate: Translator;
  member: GroupRosterMember;
}): React.JSX.Element | null {
  if (!member.isPendingActivation) {
    return member.positionName === null ? null : (
      <span className="groups-member-position">{member.positionName}</span>
    );
  }
  const notActivated = translate("groups.members.notActivated");
  return (
    <span className="groups-member-position groups-member-position-pending">
      {member.positionName === null
        ? notActivated
        : `${member.positionName} · ${notActivated}`}
    </span>
  );
}

/** La línea de debajo del nombre. En escritorio es sólo la posición: "Sin
 * activar" va en su ficha, en la columna de al lado. */
function MemberDetail({
  translate,
  layout,
  member,
}: {
  translate: Translator;
  layout: GroupsLayout;
  member: GroupRosterMember;
}): React.JSX.Element | null {
  if (layout === "compact") {
    return <CompactMemberDetail translate={translate} member={member} />;
  }
  return member.positionName === null ? null : (
    <span className="groups-member-position">{member.positionName}</span>
  );
}

function MemberRow({
  translate,
  layout,
  groupName,
  member,
  isDisabled,
  onRemove,
}: {
  translate: Translator;
  layout: GroupsLayout;
  groupName: string;
  member: GroupRosterMember;
  isDisabled: boolean;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <li className="groups-member">
      <MemberAvatar
        className="groups-member-avatar"
        fullName={member.fullName}
        photoUrl={member.photoUrl}
        size={AVATAR_SIZE[layout]}
      />
      <span className="groups-member-identity">
        <span className="groups-member-name">{member.fullName}</span>
        <MemberDetail translate={translate} layout={layout} member={member} />
      </span>
      {member.isPendingActivation && layout === "desktop" ? (
        <span className="groups-member-pill">
          {translate("groups.members.notActivated")}
        </span>
      ) : null}
      <button
        type="button"
        className="groups-member-remove"
        aria-label={translate("groups.members.removeLabel", {
          name: member.fullName,
          group: groupName,
        })}
        disabled={isDisabled}
        onClick={onRemove}
      >
        <Icon glyph={X} weight="bold" />
      </button>
    </li>
  );
}

function MembersBody({
  translate,
  layout,
  groupName,
  members,
  search,
  isDisabled,
  onRemove,
}: {
  translate: Translator;
  layout: GroupsLayout;
  groupName: string;
  members: readonly GroupRosterMember[];
  search: string;
  isDisabled: boolean;
  onRemove: (member: GroupRosterMember) => void;
}): React.JSX.Element {
  if (members.length === 0) {
    return (
      <p className="groups-members-empty">
        {translate("groups.members.empty")}
      </p>
    );
  }
  const shown = members.filter((member) =>
    matchesNameSearch(member.fullName, search),
  );
  if (shown.length === 0) {
    return (
      <p className="groups-members-empty">
        {translate("groups.members.noMatch")}
      </p>
    );
  }
  return (
    <ul className="groups-members-list">
      {shown.map((member) => (
        <MemberRow
          key={member.id}
          translate={translate}
          layout={layout}
          groupName={groupName}
          member={member}
          isDisabled={isDisabled}
          onRemove={() => onRemove(member)}
        />
      ))}
    </ul>
  );
}

export function GroupMemberList({
  translate,
  layout,
  groupName,
  roster,
  isDisabled,
  isAdding,
  isNewGroup,
  onAdd,
  onRemove,
}: {
  translate: Translator;
  layout: GroupsLayout;
  groupName: string;
  roster: GroupRoster;
  /** Hay una acción en vuelo en la pantalla. */
  isDisabled: boolean;
  isAdding: boolean;
  /** Recién creado: su selector se abre solo, porque lo siguiente es
   * llenarlo. */
  isNewGroup: boolean;
  onAdd: (chosen: readonly RosterCandidate[]) => Promise<GroupActionResult>;
  onRemove: (member: GroupRosterMember) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [isPickerOpen, setIsPickerOpen] = useState(isNewGroup);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const searchLabel = translate("groups.members.search");

  /** El selector se va con el botón que tenía el foco: lo recoge el que lo
   * abrió. */
  function closePicker(): void {
    setIsPickerOpen(false);
    toggleRef.current?.focus();
  }

  const addToggle = (
    <button
      ref={toggleRef}
      type="button"
      className="groups-add-toggle"
      aria-expanded={isPickerOpen}
      onClick={() => setIsPickerOpen((isOpen) => !isOpen)}
    >
      <Icon glyph={UserPlus} />
      {translate("groups.members.openPicker")}
    </button>
  );

  return (
    <div className="groups-members">
      <div className="groups-members-toolbar">
        <label className="groups-search">
          <Icon glyph={MagnifyingGlass} />
          <input
            type="search"
            value={search}
            placeholder={searchLabel}
            aria-label={searchLabel}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {layout === "desktop" ? addToggle : null}
      </div>
      {isPickerOpen ? (
        <GroupMemberPicker
          translate={translate}
          groupName={groupName}
          candidates={roster.candidates}
          isDisabled={isDisabled}
          isAdding={isAdding}
          onAdd={onAdd}
          onClose={closePicker}
        />
      ) : null}
      <MembersBody
        translate={translate}
        layout={layout}
        groupName={groupName}
        members={roster.members}
        search={search}
        isDisabled={isDisabled}
        onRemove={onRemove}
      />
      {layout === "compact" ? (
        <div className="groups-bottom-bar">{addToggle}</div>
      ) : null}
    </div>
  );
}
