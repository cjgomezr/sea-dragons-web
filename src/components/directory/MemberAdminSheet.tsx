"use client";

import { DotsThree } from "@phosphor-icons/react/dist/ssr/DotsThree";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import { BottomSheet } from "./BottomSheet";
import {
  type AdminAction,
  type AdminMenuMember,
  AdminMenuItems,
} from "./MemberAdminMenu";

/**
 * El ⋯ del Admin en la barra de arriba de la ficha en el móvil (#777, RF-7 y
 * D14 del PRD de E30): una hoja inferior con asa, el fondo atenuado y filas
 * de 52 px, con las mismas opciones que el desplegable de escritorio
 * (`AdminMenuItems`). El foco no sale de ella mientras está abierta.
 *
 * Lo elegido corre cuando la hoja ya se cerró, con el foco antes en el ⋯:
 * el navegador avisa del cierre más tarde, y lo que la opción abra (el
 * diálogo de la exención, la franja de desactivar) tiene que quedarse con
 * el foco, como al elegir en el desplegable.
 */
export function MemberAdminSheet({
  translate,
  member,
  openerRef,
  onChoose,
}: {
  translate: Translator;
  member: AdminMenuMember;
  /** El ⋯, que la ficha también enfoca al cancelar la franja de desactivar. */
  openerRef: React.RefObject<HTMLButtonElement | null>;
  onChoose: (action: AdminAction) => void;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const chosenRef = useRef<AdminAction | null>(null);
  const label = translate("memberRecord.menu.open");

  function handleClosed(): void {
    setIsOpen(false);
    openerRef.current?.focus();
    const chosen = chosenRef.current;
    chosenRef.current = null;
    if (chosen !== null) {
      onChoose(chosen);
    }
  }

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className="profile-phone-bar-button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
      >
        <Icon glyph={DotsThree} weight="bold" />
      </button>
      {isOpen ? (
        <BottomSheet
          title={(titleId) => (
            <h2 id={titleId} className="visually-hidden">
              {label}
            </h2>
          )}
          gripLabel={translate("memberRecord.menu.close")}
          onClosed={handleClosed}
        >
          {(close) => (
            <div className="member-admin-sheet">
              <AdminMenuItems
                translate={translate}
                member={member}
                onChoose={(action) => {
                  chosenRef.current = action;
                  close();
                }}
              />
            </div>
          )}
        </BottomSheet>
      ) : null}
    </>
  );
}
