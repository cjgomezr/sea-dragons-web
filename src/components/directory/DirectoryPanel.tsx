"use client";

import { SidebarSimple } from "@phosphor-icons/react/dist/ssr/SidebarSimple";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { Icon } from "@/components/Icon";
import type { Role } from "@/lib/auth/roles";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import { MemberQuickCard } from "./MemberQuickCard";
import type { SelectedMember } from "./selected-member";
import type { PendingRoleRequests } from "./use-pending-role-requests";

/**
 * El panel lateral del directorio (#550, RF-5 del PRD de E21): la columna de
 * 340px a la derecha de la lista, con la ficha rápida del socio que se
 * eligió. Sin nadie elegido, hasta que llegue el resumen del club (ticket 5
 * de E21), sólo dice cómo llenarlo.
 *
 * Esc lo cierra desde cualquier punto de dentro, igual que su ✕; la pantalla
 * devuelve entonces el foco a la fila. Por debajo de 768px no hay panel: la
 * hoja de estilos lo esconde, y el móvil tendrá su ficha que sube.
 */

export const DIRECTORY_PANEL_ID = "directorio-panel";

export function PanelToggle({
  translate,
  isOpen,
  onToggle,
}: {
  translate: Translator;
  isOpen: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const label = translate("directory.panel.toggle");
  return (
    <button
      type="button"
      className="directory-icon-button directory-panel-toggle"
      aria-label={label}
      title={label}
      aria-expanded={isOpen}
      // Cerrado, el panel no está en la página: no hay a qué apuntar.
      aria-controls={isOpen ? DIRECTORY_PANEL_ID : undefined}
      onClick={onToggle}
    >
      <Icon glyph={SidebarSimple} />
    </button>
  );
}

function EmptyPanel({
  translate,
  onClose,
}: {
  translate: Translator;
  onClose: () => void;
}): React.JSX.Element {
  const closeLabel = translate("directory.panel.close");
  return (
    <div className="directory-card-header">
      <p className="directory-panel-hint">
        {translate("directory.panel.hint")}
      </p>
      <button
        type="button"
        className="directory-card-close"
        aria-label={closeLabel}
        title={closeLabel}
        onClick={onClose}
      >
        <Icon glyph={X} />
      </button>
    </div>
  );
}

export function DirectoryPanel({
  translate,
  locale,
  selected,
  pendingRequests,
  onClose,
  onRoleChanged,
}: {
  translate: Translator;
  locale: Locale;
  /** `null` con el panel abierto y nadie elegido. */
  selected: SelectedMember | null;
  pendingRequests: PendingRoleRequests | null;
  onClose: () => void;
  onRoleChanged: (userId: string, role: Role) => void;
}): React.JSX.Element {
  return (
    <section
      id={DIRECTORY_PANEL_ID}
      className="directory-panel"
      aria-label={
        selected === null
          ? translate("directory.panel.label")
          : translate("directory.panel.memberLabel", {
              name: selected.member.fullName,
            })
      }
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {selected === null ? (
        <EmptyPanel translate={translate} onClose={onClose} />
      ) : (
        <MemberQuickCard
          // Otro socio empieza de cero: sin esto, la franja de un rol a medio
          // elegir pasaría de una ficha a la siguiente.
          key={selected.member.userId}
          translate={translate}
          locale={locale}
          selected={selected}
          pendingRequests={pendingRequests}
          onClose={onClose}
          onRoleChanged={onRoleChanged}
        />
      )}
    </section>
  );
}
