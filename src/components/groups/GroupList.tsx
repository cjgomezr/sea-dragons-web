"use client";

import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { useId } from "react";
import { Icon } from "@/components/Icon";
import { MemberAvatar } from "@/components/MemberAvatar";
import type { GroupOverview } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";
import { describeSummary, describeUsage } from "./group-texts";
import { type GroupsLayout, groupRowId } from "./groups-layout";

/**
 * La lista compacta de los grupos del club, a la izquierda del panel (#828,
 * RF-2 de E32): crear arriba y, debajo, una fila por grupo con su uso, tres
 * avatares y su conteo. Pulsar una fila la elige; pulsarla otra vez la suelta.
 *
 * La fila es un solo botón. Su nombre accesible es el del grupo y lo demás va
 * en su descripción, para que quien navega con lector oiga primero qué grupo
 * es y luego cómo está.
 *
 * En el móvil (#831) la fila lleva debajo del nombre "{n} miembros · {uso}",
 * los avatares y una flecha, porque pulsarla abre la pantalla del grupo.
 */

const AVATAR_SIZE: Readonly<Record<GroupsLayout, number>> = {
  desktop: 24,
  compact: 26,
};

function RowAvatars({
  group,
  layout,
}: {
  group: GroupOverview;
  layout: GroupsLayout;
}): React.JSX.Element {
  return (
    <span className="groups-row-avatars" aria-hidden="true">
      {group.previewMembers.map((member) => (
        <MemberAvatar
          key={member.id}
          className="groups-row-avatar"
          fullName={member.fullName}
          photoUrl={member.photoUrl}
          size={AVATAR_SIZE[layout]}
        />
      ))}
    </span>
  );
}

/** La fila del móvil: el conteo va con su palabra en la línea de debajo, así
 * que la descripción es esa línea entera. */
function CompactGroupRow({
  translate,
  group,
  isDisabled,
  onSelect,
}: {
  translate: Translator;
  group: GroupOverview;
  isDisabled: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const id = useId();
  const nameId = `${id}-name`;
  const detailId = `${id}-detail`;
  return (
    <li>
      <button
        id={groupRowId(group.id)}
        type="button"
        className="groups-row"
        aria-labelledby={nameId}
        aria-describedby={detailId}
        disabled={isDisabled}
        onClick={onSelect}
      >
        <span className="groups-row-identity">
          <span id={nameId} className="groups-row-name">
            {group.name}
          </span>
          {/* Sin nadie sin activar a la vista, el resumen del grupo es justo
              "{n} miembros · {uso}". */}
          <span id={detailId} className="groups-row-usage">
            {describeSummary(translate, group, 0)}
          </span>
        </span>
        <RowAvatars group={group} layout="compact" />
        <span className="groups-row-caret">
          <Icon glyph={CaretRight} />
        </span>
      </button>
    </li>
  );
}

function GroupRow({
  translate,
  group,
  isSelected,
  isDisabled,
  onSelect,
}: {
  translate: Translator;
  group: GroupOverview;
  isSelected: boolean;
  isDisabled: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const id = useId();
  const nameId = `${id}-name`;
  const usageId = `${id}-usage`;
  const countId = `${id}-count`;
  return (
    <li>
      <button
        type="button"
        className="groups-row"
        aria-labelledby={nameId}
        aria-describedby={`${usageId} ${countId}`}
        aria-current={isSelected ? "true" : undefined}
        disabled={isDisabled}
        onClick={onSelect}
      >
        <span className="groups-row-identity">
          <span id={nameId} className="groups-row-name">
            {group.name}
          </span>
          <span id={usageId} className="groups-row-usage">
            {describeUsage(translate, group.usage)}
          </span>
        </span>
        <RowAvatars group={group} layout="desktop" />
        <span className="groups-row-count" aria-hidden="true">
          {group.memberCount}
        </span>
        {/* El número suelto no dice nada a un lector: la descripción lo
            lleva con su palabra. El separador cose la frase con el uso. */}
        <span id={countId} className="visually-hidden">
          {`· ${translate("groups.memberCount", { count: group.memberCount })}`}
        </span>
      </button>
    </li>
  );
}

export function GroupList({
  translate,
  layout,
  groups,
  selectedGroupId,
  isDisabled,
  onSelect,
}: {
  translate: Translator;
  layout: GroupsLayout;
  groups: readonly GroupOverview[];
  selectedGroupId: string | null;
  /** Hay una acción en vuelo: elegir otro grupo la dejaría sin su panel. */
  isDisabled: boolean;
  onSelect: (group: GroupOverview) => void;
}): React.JSX.Element {
  if (groups.length === 0) {
    return (
      <p className="groups-list-empty">{translate("groups.list.empty")}</p>
    );
  }
  if (layout === "compact") {
    return (
      <ul className="groups-list groups-list-items">
        {groups.map((group) => (
          <CompactGroupRow
            key={group.id}
            translate={translate}
            group={group}
            isDisabled={isDisabled}
            onSelect={() => onSelect(group)}
          />
        ))}
      </ul>
    );
  }
  return (
    <div className="groups-list">
      <div className="groups-list-head">
        <span>{translate("groups.list.count", { count: groups.length })}</span>
        <span>{translate("groups.list.members")}</span>
      </div>
      <ul className="groups-list-items">
        {groups.map((group) => (
          <GroupRow
            key={group.id}
            translate={translate}
            group={group}
            isSelected={group.id === selectedGroupId}
            isDisabled={isDisabled}
            onSelect={() => onSelect(group)}
          />
        ))}
      </ul>
    </div>
  );
}
