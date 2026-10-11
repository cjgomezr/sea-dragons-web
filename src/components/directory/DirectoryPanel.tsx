"use client";

import { SidebarSimple } from "@phosphor-icons/react/dist/ssr/SidebarSimple";
import { Icon } from "@/components/Icon";
import type { Role } from "@/lib/auth/roles";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import { ClubOverview, type OverviewContext } from "./ClubOverview";
import { MemberQuickCard } from "./MemberQuickCard";
import type { SelectedMember } from "./selected-member";
import type { PendingRoleRequests } from "./use-pending-role-requests";

/**
 * El panel lateral del directorio (#550, RF-5 del PRD de E21): la columna de
 * 340px a la derecha de la lista, con la ficha rápida del socio que se
 * eligió. Sin nadie elegido, al Admin le enseña el resumen del club (#551);
 * a los demás roles no se les abre sin alguien elegido (D4).
 *
 * Esc lo cierra desde cualquier punto de dentro, igual que su ✕; la pantalla
 * devuelve entonces el foco a la fila. Por debajo de 768px no hay panel: la
 * hoja de estilos lo esconde, y el móvil tendrá su ficha que sube. Entre 768
 * y 1199px se abre encima de la lista, nunca de la barra: su botón sigue a
 * la vista.
 */

export const DIRECTORY_PANEL_ID = "directorio-panel";

/** El botón de la barra: recibe el foco cuando se cierra el panel sin nadie
 * elegido, que no tiene una fila a la que volver. */
export const PANEL_TOGGLE_ID = "directorio-panel-boton";

/** Lo que el botón de la barra necesita saber del panel. Sólo lo lleva un
 * Admin: a los demás el panel se les abre al elegir a alguien (D4). */
export type PanelToggleState = {
  readonly isOpen: boolean;
  /** Las solicitudes de rol que esperan: cerrado, el botón las cuenta. */
  readonly waitingCount: number;
  readonly onToggle: () => void;
};

export function PanelToggle({
  translate,
  toggle: { isOpen, waitingCount, onToggle },
}: {
  translate: Translator;
  toggle: PanelToggleState;
}): React.JSX.Element {
  const label = translate("directory.panel.toggle");
  const hasBubble = !isOpen && waitingCount > 0;
  return (
    <button
      id={PANEL_TOGGLE_ID}
      type="button"
      className="directory-icon-button directory-panel-toggle"
      aria-label={
        hasBubble
          ? translate("directory.panel.toggleWaiting", { count: waitingCount })
          : label
      }
      title={label}
      aria-expanded={isOpen}
      // Cerrado, el panel no está en la página: no hay a qué apuntar.
      aria-controls={isOpen ? DIRECTORY_PANEL_ID : undefined}
      onClick={onToggle}
    >
      <Icon glyph={SidebarSimple} />
      {hasBubble ? (
        <span className="directory-panel-bubble" aria-hidden="true">
          {waitingCount}
        </span>
      ) : null}
    </button>
  );
}

/** Lo que enseña el panel: la ficha de quien se eligió o, sin nadie, el
 * resumen del club del Admin. */
export type PanelView =
  | { readonly kind: "member"; readonly selected: SelectedMember }
  | { readonly kind: "overview"; readonly overview: OverviewContext };

function panelLabelOf(translate: Translator, view: PanelView): string {
  return view.kind === "overview"
    ? translate("directory.panel.label")
    : translate("directory.panel.memberLabel", {
        name: view.selected.member.fullName,
      });
}

export function DirectoryPanel({
  translate,
  locale,
  view,
  pendingRequests,
  onClose,
  onRoleChanged,
}: {
  translate: Translator;
  locale: Locale;
  view: PanelView;
  /** `null` para quien no es Admin: no decide solicitudes. */
  pendingRequests: PendingRoleRequests | null;
  onClose: () => void;
  onRoleChanged: (userId: string, role: Role) => void;
}): React.JSX.Element {
  return (
    <section
      id={DIRECTORY_PANEL_ID}
      className="directory-panel"
      aria-label={panelLabelOf(translate, view)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {/* El interior es el que se queda pegado al bajar por la lista: la
          sección mide lo que la lista, para no tapar nada fuera de ella. */}
      <div className="directory-panel-inner">
        {view.kind === "overview" ? (
          <ClubOverview
            translate={translate}
            locale={locale}
            overview={view.overview}
            onClose={onClose}
          />
        ) : (
          <MemberQuickCard
            // Otro socio empieza de cero: sin esto, la franja de un rol a medio
            // elegir pasaría de una ficha a la siguiente.
            key={view.selected.member.userId}
            translate={translate}
            locale={locale}
            selected={view.selected}
            pendingRequests={pendingRequests}
            onClose={onClose}
            onRoleChanged={onRoleChanged}
          />
        )}
      </div>
    </section>
  );
}
