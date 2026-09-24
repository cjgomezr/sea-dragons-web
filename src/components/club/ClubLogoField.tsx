"use client";

import { useRef, useState } from "react";
import { ClubBrandMark } from "@/components/ClubBrandMark";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import {
  CLUB_LOGO_TYPES,
  type ClubLogoIssueCode,
  validateClubLogoFile,
} from "@/lib/club/club-logo";
import type { Translator } from "@/lib/i18n/translator";
import {
  type ClubLogoChange,
  deleteClubLogo,
  describeLogoFailure,
  describeLogoHint,
  describeLogoIssue,
  uploadClubLogo,
} from "./club-logo-client";

/**
 * El logo en la configuración del club (#295, RF-4 del PRD de E18a): la
 * marca como se ve y los controles para subirla, cambiarla o quitarla. Sigue
 * a la foto de perfil (`ProfilePhoto`): avisa antes de subir lo que no vale,
 * el servidor lo vuelve a comprobar, y el logo sólo cambia en pantalla cuando
 * el servidor lo confirma. Cada cambio se guarda en el acto, sin esperar al
 * botón del formulario.
 */

const ACCEPTED_TYPES = CLUB_LOGO_TYPES.join(",");

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "uploading" }
  | { readonly kind: "removing" }
  | { readonly kind: "saved" }
  | { readonly kind: "removed" }
  | { readonly kind: "rejected"; readonly issue: ClubLogoIssueCode }
  | { readonly kind: "failed"; readonly failure: ApiRequestFailure };

function isBusy(status: Status): boolean {
  return status.kind === "uploading" || status.kind === "removing";
}

export function ClubLogoField({
  translate,
  clubName,
  initials,
  logoUrl,
  onLogoChanged,
}: {
  translate: Translator;
  clubName: string;
  initials: string;
  logoUrl: string | null;
  onLogoChanged: (logoUrl: string | null) => void;
}): React.JSX.Element {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);

  async function apply(
    pending: Status,
    request: () => Promise<ClubLogoChange>,
    done: Status,
  ): Promise<void> {
    setStatus(pending);
    const result = await request();
    if (result.kind === "failed") {
      setStatus({ kind: "failed", failure: result });
      return;
    }
    onLogoChanged(result.logoUrl);
    setStatus(done);
  }

  function choose(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    // Vaciarlo deja volver a elegir el mismo fichero después de un error.
    event.target.value = "";
    if (file === undefined) {
      return;
    }
    const issue = validateClubLogoFile(file);
    if (issue !== null) {
      setStatus({ kind: "rejected", issue });
      return;
    }
    void apply({ kind: "uploading" }, () => uploadClubLogo(file), {
      kind: "saved",
    });
  }

  function remove(): void {
    void apply({ kind: "removing" }, deleteClubLogo, { kind: "removed" });
  }

  const busy = isBusy(status);
  return (
    <div className="club-logo-field">
      <div className="club-logo-preview">
        <ClubBrandMark
          logoUrl={logoUrl}
          logoAlt={translate("club.logoAlt", { club: clubName })}
          fallback={
            <span className="auth-brand-mark" aria-hidden="true">
              {initials}
            </span>
          }
        />
        <span>
          {translate(
            logoUrl === null
              ? "clubSettings.logo.none"
              : "clubSettings.logo.present",
          )}
        </span>
      </div>
      <div className="club-logo-actions">
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_TYPES}
          aria-label={translate("clubSettings.logo.choose")}
          className="visually-hidden"
          tabIndex={-1}
          onChange={choose}
        />
        <button
          type="button"
          className="auth-secondary"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {status.kind === "uploading"
            ? translate("clubSettings.logo.uploading")
            : translate(
                logoUrl === null
                  ? "clubSettings.logo.add"
                  : "clubSettings.logo.change",
              )}
        </button>
        {logoUrl === null ? null : (
          <button
            type="button"
            className="auth-secondary"
            disabled={busy}
            onClick={remove}
          >
            {status.kind === "removing"
              ? translate("clubSettings.logo.removing")
              : translate("clubSettings.logo.remove")}
          </button>
        )}
      </div>
      <p className="auth-hint">{describeLogoHint(translate)}</p>
      <LogoStatus translate={translate} status={status} />
    </div>
  );
}

function LogoStatus({
  translate,
  status,
}: {
  translate: Translator;
  status: Status;
}): React.JSX.Element | null {
  switch (status.kind) {
    case "saved":
      return (
        <p role="status" className="auth-note">
          {translate("clubSettings.logo.saved")}
        </p>
      );
    case "removed":
      return (
        <p role="status" className="auth-note">
          {translate("clubSettings.logo.removed")}
        </p>
      );
    case "rejected":
      return (
        <p role="alert" className="auth-error">
          {describeLogoIssue(translate, status.issue)}
        </p>
      );
    case "failed":
      return (
        <p role="alert" className="auth-error">
          {describeLogoFailure(translate, status.failure)}
        </p>
      );
    default:
      return null;
  }
}
