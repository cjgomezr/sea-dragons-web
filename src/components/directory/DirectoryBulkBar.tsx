"use client";

import { CaretDown } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { DownloadSimple } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { EnvelopeSimple } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { UserSwitch } from "@phosphor-icons/react/dist/ssr/UserSwitch";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { ROLES, type Role } from "@/lib/auth/roles";
import type {
  DirectoryMember,
  DirectoryQuery,
} from "@/lib/directory/directory";
import type { Translator } from "@/lib/i18n/translator";
import type { EmailRecipient } from "./DirectoryEmailComposer";
import { describeDirectoryExportFailure } from "./directory-export-client";
import { emailRecipientsOf } from "./listing-permissions";
import { useDirectoryExport } from "./use-directory-export";

/**
 * La barra de los socios marcados (#552, RF-6 del PRD de E21; "Bulk bar" de
 * `docs/design/directorio-admin/README.md`): cuántos hay, escribirles,
 * exportarlos y, al Admin, cambiarles el rol. Elegir un rol sólo abre la
 * franja que lo confirma: nada se guarda hasta "Cambiar roles".
 *
 * Cada botón sale sólo para quien puede usarlo, según la marca de la lista;
 * el servidor lo vuelve a mirar al enviar, exportar o cambiar.
 */

const ROLE_MENU_ID = "directorio-marcados-roles";
const COUNT_ID = "directorio-marcados-cuantos";

/** Lo que puede hacer con los marcados quien mira la lista. */
export type BulkPermissions = {
  readonly canEmail: boolean;
  readonly canExport: boolean;
  readonly canChangeRole: boolean;
};

function BulkIconButton({
  label,
  glyph,
  disabled = false,
  onClick,
}: {
  label: string;
  glyph: React.ComponentProps<typeof Icon>["glyph"];
  disabled?: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="directory-bulk-icon"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon glyph={glyph} />
    </button>
  );
}

/** "Cambiar rol ▾" y sus cuatro roles. Es un desplegable de botones, no un
 * menú de ARIA: se recorre con el tabulador, y Esc lo cierra. */
function RoleChooser({
  translate,
  disabled,
  onChoose,
}: {
  translate: Translator;
  disabled: boolean;
  onChoose: (role: Role) => void;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      className="directory-bulk-role"
      onKeyDown={(event) => {
        if (event.key === "Escape" && isOpen) {
          event.stopPropagation();
          setIsOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="directory-bulk-role-toggle"
        aria-expanded={isOpen}
        aria-controls={ROLE_MENU_ID}
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
      >
        <Icon glyph={UserSwitch} />
        {translate("directory.bulk.changeRole")}
        <Icon glyph={CaretDown} />
      </button>
      {isOpen ? (
        <div
          id={ROLE_MENU_ID}
          role="group"
          aria-label={translate("directory.bulk.roleMenu")}
          className="directory-bulk-menu"
        >
          {ROLES.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => {
                setIsOpen(false);
                onChoose(role);
              }}
            >
              {translate(`role.${role}`)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** "¿Cambiar {n} socios a {rol}?", con la misma franja que el cambio de uno
 * (#550). El foco va a Cancelar: lo que no se quiere es guardar sin mirar. */
function BulkConfirmStrip({
  translate,
  count,
  role,
  isSaving,
  onCancel,
  onSave,
}: {
  translate: Translator;
  count: number;
  role: Role;
  isSaving: boolean;
  onCancel: () => void;
  onSave: () => void;
}): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className="directory-confirm directory-bulk-confirm">
      <div className="directory-confirm-row">
        <p className="directory-confirm-text">
          {translate("directory.bulk.confirm", {
            count,
            role: translate(`role.${role}`),
          })}
        </p>
        <button
          ref={cancelRef}
          type="button"
          className="directory-link-button"
          disabled={isSaving}
          onClick={onCancel}
        >
          {translate("directory.bulk.cancel")}
        </button>
        <button
          type="button"
          className="auth-submit directory-confirm-save"
          disabled={isSaving}
          onClick={onSave}
        >
          {translate(
            isSaving ? "directory.bulk.saving" : "directory.bulk.save",
          )}
        </button>
      </div>
    </div>
  );
}

export function DirectoryBulkBar({
  translate,
  checkedMembers,
  listedQuery,
  permissions,
  isSavingRoles,
  onEmail,
  onChangeRoles,
  onClear,
}: {
  translate: Translator;
  /** Los marcados que están en la lista; al menos uno. */
  checkedMembers: readonly DirectoryMember[];
  /** La consulta de la lista que se ve: el CSV sale de ella, acotada. */
  listedQuery: DirectoryQuery;
  permissions: BulkPermissions;
  isSavingRoles: boolean;
  onEmail: (recipients: readonly EmailRecipient[]) => void;
  onChangeRoles: (role: Role) => Promise<void>;
  onClear: () => void;
}): React.JSX.Element {
  const [roleDraft, setRoleDraft] = useState<Role | null>(null);
  const exporter = useDirectoryExport();
  const count = checkedMembers.length;
  const recipients = emailRecipientsOf(checkedMembers);

  async function saveRoles(role: Role): Promise<void> {
    await onChangeRoles(role);
    setRoleDraft(null);
  }

  return (
    <div className="directory-bulk">
      <div
        role="group"
        aria-labelledby={COUNT_ID}
        className="directory-bulk-bar"
      >
        <p id={COUNT_ID} className="directory-bulk-count">
          {translate("directory.bulk.label", { count })}
        </p>
        <div className="directory-bulk-actions">
          {permissions.canEmail ? (
            <BulkIconButton
              label={translate("directory.bulk.email")}
              glyph={EnvelopeSimple}
              disabled={recipients.length === 0}
              onClick={() => onEmail(recipients)}
            />
          ) : null}
          {permissions.canExport ? (
            <BulkIconButton
              label={translate("directory.bulk.export")}
              glyph={DownloadSimple}
              disabled={exporter.state.kind === "exporting"}
              onClick={() =>
                void exporter.exportList(
                  listedQuery,
                  checkedMembers.map((member) => member.userId),
                )
              }
            />
          ) : null}
          {permissions.canChangeRole ? (
            <RoleChooser
              translate={translate}
              disabled={isSavingRoles}
              onChoose={setRoleDraft}
            />
          ) : null}
          <BulkIconButton
            label={translate("directory.bulk.clear")}
            glyph={X}
            disabled={isSavingRoles}
            onClick={onClear}
          />
        </div>
      </div>
      {exporter.state.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeDirectoryExportFailure(translate, exporter.state.failure)}
        </p>
      ) : null}
      {roleDraft === null ? null : (
        <BulkConfirmStrip
          translate={translate}
          count={count}
          role={roleDraft}
          isSaving={isSavingRoles}
          onCancel={() => setRoleDraft(null)}
          onSave={() => void saveRoles(roleDraft)}
        />
      )}
    </div>
  );
}
