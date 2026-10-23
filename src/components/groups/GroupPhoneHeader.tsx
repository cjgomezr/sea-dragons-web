"use client";

import { AddressBook } from "@phosphor-icons/react/dist/ssr/AddressBook";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { EnvelopeSimple } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import type { GroupOverview } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";
import { GroupActionsSheet } from "./GroupActionsSheet";
import type { GroupActionResult } from "./GroupNameForm";
import { type WriteToAll, directoryHref } from "./GroupPanelHeader";
import type { GroupsFailure } from "./groups-client";
import { describeSummary } from "./group-texts";

/**
 * La cabecera de la pantalla del grupo en el móvil (#831, RF-7 de E32): la
 * barra con volver, el nombre y ⋯; el resumen; y los dos botones de 46 px,
 * Escribir a todos (sólo para quien puede, D6) y Directorio. Renombrar y
 * borrar van en la hoja del ⋯.
 */

function EmailAllButton({
  translate,
  writeToAll,
  isDisabled,
}: {
  translate: Translator;
  writeToAll: WriteToAll;
  isDisabled: boolean;
}): React.JSX.Element {
  const { recipients, onOpen } = writeToAll;
  const hasNobody = recipients !== null && recipients.length === 0;
  return (
    <button
      type="button"
      className="groups-phone-action"
      title={hasNobody ? translate("groups.writeAll.nobody") : undefined}
      disabled={isDisabled || recipients === null || hasNobody}
      onClick={() => {
        if (recipients !== null) {
          onOpen(recipients);
        }
      }}
    >
      <Icon glyph={EnvelopeSimple} />
      {translate("groups.phone.emailAll")}
    </button>
  );
}

export function GroupPhoneHeader({
  translate,
  group,
  notActivatedCount,
  writeToAll,
  failure,
  isDisabled,
  isDeleting,
  onBack,
  onRename,
  onDelete,
}: {
  translate: Translator;
  group: GroupOverview;
  notActivatedCount: number;
  /** `null` para quien no escribe desde el Directorio: el Coach (D6). */
  writeToAll: WriteToAll | null;
  /** El último fallo de la pantalla, para que la hoja ⋯ lo diga dentro. */
  failure: GroupsFailure | null;
  isDisabled: boolean;
  isDeleting: boolean;
  onBack: () => void;
  onRename: (name: string) => Promise<GroupActionResult>;
  onDelete: () => Promise<GroupActionResult>;
}): React.JSX.Element {
  return (
    <header className="groups-phone-head">
      <div className="groups-phone-bar">
        {/* Volver con una acción en vuelo dejaría su resultado sin pantalla,
            como elegir otro grupo en escritorio. */}
        <button
          type="button"
          className="groups-bar-button"
          aria-label={translate("groups.phone.back")}
          title={translate("groups.phone.back")}
          disabled={isDisabled}
          onClick={onBack}
        >
          <Icon glyph={CaretLeft} />
        </button>
        <h2>{group.name}</h2>
        <GroupActionsSheet
          translate={translate}
          group={group}
          failure={failure}
          isDisabled={isDisabled}
          isDeleting={isDeleting}
          onRename={onRename}
          onDelete={onDelete}
        />
      </div>
      <p className="groups-panel-summary">
        {describeSummary(translate, group, notActivatedCount)}
      </p>
      <div className="groups-phone-actions">
        {writeToAll === null ? null : (
          <EmailAllButton
            translate={translate}
            writeToAll={writeToAll}
            isDisabled={isDisabled}
          />
        )}
        <Link className="groups-phone-action" href={directoryHref(group.id)}>
          <Icon glyph={AddressBook} />
          {translate("groups.phone.directory")}
        </Link>
      </div>
    </header>
  );
}
