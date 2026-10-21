"use client";

import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { UserSwitch } from "@phosphor-icons/react/dist/ssr/UserSwitch";
import { useState } from "react";
import { useIsPhone } from "@/components/use-is-phone";
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
 * En el móvil (#777), mientras se puede pedir, la tarjeta es una fila de
 * 56 px, "Solicitar un cambio de rol", que abre el mismo panel debajo.
 *
 * Es de cliente por el botón, que abre el panel sin recargar.
 */

const PANEL_ID = "rol-solicitud";

/** La fila del móvil y, al pulsarla, el panel debajo. */
function PhoneRoleRow({
  label,
  isOpen,
  onToggle,
  panel,
}: {
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  panel: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="profile-role-phone">
      <button
        type="button"
        className="profile-role-row"
        aria-expanded={isOpen}
        aria-controls={isOpen ? PANEL_ID : undefined}
        onClick={onToggle}
      >
        <UserSwitch aria-hidden="true" focusable="false" weight="regular" />
        <span className="profile-role-row-label">{label}</span>
        <CaretRight aria-hidden="true" focusable="false" weight="regular" />
      </button>
      {isOpen ? panel : null}
    </div>
  );
}

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
  const isPhone = useIsPhone();
  const panel = (
    <div id={PANEL_ID} className="profile-role-panel">
      <RoleRequestPanel
        locale={locale}
        role={role}
        latestRequest={latestRequest}
        onCreated={() => setHasRequested(true)}
      />
    </div>
  );

  // Con el valor de la página y no con `canRequest`: tras enviar la
  // solicitud, la fila se queda y su panel, montado, dice que está pendiente.
  const isRequestable =
    roleRequestAvailability(role, latestRequest).kind === "available";
  if (isPhone && isRequestable) {
    return (
      <PhoneRoleRow
        label={translate("account.role.requestChange")}
        isOpen={isOpen}
        onToggle={() => setIsOpen((current) => !current)}
        panel={panel}
      />
    );
  }

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
            className="admin-secondary profile-role-request"
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
      {isPanelShown ? panel : null}
    </SideCard>
  );
}
