"use client";

import { UserSwitch } from "@phosphor-icons/react/dist/ssr/UserSwitch";
import { useState } from "react";
import {
  type RoleRequest,
  roleRequestAvailability,
} from "@/lib/auth/role-request";
import type { Role } from "@/lib/auth/roles";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import { RoleRequestPanel } from "./RoleRequestPanel";
import { SideCard } from "./SideCard";

/**
 * El rol en la columna derecha del perfil propio (#774, D12 del PRD de E30):
 * "Rol · {rol}", a quién pedir otro y Solicitar, que abre `RoleRequestPanel`.
 * Con una solicitud pendiente, o siendo Admin, el panel dice lo suyo en lugar
 * del botón. Sólo la ve el socio: en la ficha, el rol lo cambia el Admin.
 *
 * Es de cliente por el botón, que abre el panel sin recargar.
 */

const PANEL_ID = "rol-solicitud";

export function RoleCard({
  locale,
  role,
  latestRequest,
}: {
  locale: Locale;
  role: Role;
  latestRequest: RoleRequest | null;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [isOpen, setIsOpen] = useState(false);
  const [hasRequested, setHasRequested] = useState(false);
  const canRequest =
    !hasRequested &&
    roleRequestAvailability(role, latestRequest).kind === "available";
  const isPanelShown = isOpen || !canRequest;

  return (
    <SideCard
      headingId="mi-rol"
      title={translate("account.role.title", {
        role: translate(`role.${role}`),
      })}
      action={
        canRequest ? (
          <button
            type="button"
            className="admin-secondary profile-side-card-button"
            aria-expanded={isOpen}
            aria-controls={isOpen ? PANEL_ID : undefined}
            onClick={() => setIsOpen((current) => !current)}
          >
            {translate("account.role.request")}
          </button>
        ) : null
      }
    >
      {canRequest ? (
        <p className="profile-side-card-notice">
          <UserSwitch aria-hidden="true" focusable="false" weight="regular" />
          {translate("account.role.hint")}
        </p>
      ) : null}
      {isPanelShown ? (
        <div id={PANEL_ID} className="profile-role-panel">
          <RoleRequestPanel
            locale={locale}
            role={role}
            latestRequest={latestRequest}
            onCreated={() => setHasRequested(true)}
          />
        </div>
      ) : null}
    </SideCard>
  );
}
