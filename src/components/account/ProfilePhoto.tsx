"use client";

import { useRef, useState } from "react";
import { MemberAvatar } from "@/components/MemberAvatar";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import {
  PROFILE_PHOTO_TYPES,
  type ProfilePhotoIssueCode,
  validateProfilePhotoFile,
} from "@/lib/members/profile-photo";
import {
  describePhotoFailure,
  describePhotoHint,
  describePhotoIssue,
  readPhotoIssue,
  removeOwnProfilePhoto,
  uploadProfilePhoto,
} from "./profile-photo-client";

/**
 * La foto del perfil propio (#245, FR-084): el círculo de la cabecera de
 * docs/mockups/mobile-profile-light.png y, bajo el nombre, los controles para
 * subirla, cambiarla o quitarla.
 *
 * Es de cliente por el estado del envío. Avisa antes de subir lo que no vale
 * (el servidor lo vuelve a comprobar), y sólo cambia la foto que enseña
 * cuando el servidor confirmó: si la subida se corta, sigue la anterior y se
 * ofrece reintentar con el mismo fichero.
 *
 * El nombre y el rol llegan como `children` para que la cabecera siga siendo
 * de servidor y esto sólo envuelva lo que cambia.
 */

/** El círculo de la cabecera, en píxeles; `.account-avatar` dice lo mismo. */
const HEADER_AVATAR_SIZE = 64;

const ACCEPTED_TYPES = PROFILE_PHOTO_TYPES.join(",");

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "uploading" }
  | { readonly kind: "removing" }
  | { readonly kind: "saved" }
  | { readonly kind: "removed" }
  | { readonly kind: "rejected"; readonly issue: ProfilePhotoIssueCode }
  | {
      readonly kind: "failed";
      readonly failure: ApiRequestFailure;
      /** Lo que se reintenta: el mismo fichero, o quitar la foto. */
      readonly retry: (() => void) | null;
    };

function isBusy(status: Status): boolean {
  return status.kind === "uploading" || status.kind === "removing";
}

export function ProfilePhoto({
  locale,
  fullName,
  initialPhotoUrl,
  children,
}: {
  locale: Locale;
  fullName: string;
  initialPhotoUrl: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);

  /** Un fallo que no es del fichero se puede reintentar tal cual; uno del
   * fichero, no, porque el servidor lo volvería a rechazar. */
  function fail(failure: ApiRequestFailure, retry: () => void): void {
    setStatus({
      kind: "failed",
      failure,
      retry: readPhotoIssue(failure) === null ? retry : null,
    });
  }

  async function upload(file: File): Promise<void> {
    setStatus({ kind: "uploading" });
    const result = await uploadProfilePhoto(file);
    if (result.kind === "failed") {
      fail(result, () => void upload(file));
      return;
    }
    setPhotoUrl(result.photoUrl);
    setStatus({ kind: "saved" });
  }

  async function remove(): Promise<void> {
    setStatus({ kind: "removing" });
    const result = await removeOwnProfilePhoto();
    if (result.kind === "failed") {
      fail(result, () => void remove());
      return;
    }
    setPhotoUrl(null);
    setStatus({ kind: "removed" });
  }

  function choose(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    // Vaciarlo deja volver a elegir el mismo fichero después de un error.
    event.target.value = "";
    if (file === undefined) {
      return;
    }
    const issue = validateProfilePhotoFile(file);
    if (issue !== null) {
      setStatus({ kind: "rejected", issue });
      return;
    }
    void upload(file);
  }

  const busy = isBusy(status);
  return (
    <>
      <MemberAvatar
        className="account-avatar"
        fullName={fullName}
        photoUrl={photoUrl}
        size={HEADER_AVATAR_SIZE}
        alt={translate("account.photo.alt")}
      />
      <div className="account-identity">
        {children}
        <div className="account-photo-actions">
          <input
            ref={input}
            type="file"
            accept={ACCEPTED_TYPES}
            aria-label={translate("account.photo.choose")}
            className="account-photo-input"
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
              ? translate("account.photo.uploading")
              : translate(
                  photoUrl === null
                    ? "account.photo.add"
                    : "account.photo.change",
                )}
          </button>
          {photoUrl === null ? null : (
            <button
              type="button"
              className="auth-secondary"
              disabled={busy}
              onClick={() => void remove()}
            >
              {status.kind === "removing"
                ? translate("account.photo.removing")
                : translate("account.photo.remove")}
            </button>
          )}
        </div>
        <p className="auth-hint account-photo-hint">
          {describePhotoHint(translate)}
        </p>
        <PhotoStatus translate={translate} status={status} />
      </div>
    </>
  );
}

function PhotoStatus({
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
          {translate("account.photo.saved")}
        </p>
      );
    case "removed":
      return (
        <p role="status" className="auth-note">
          {translate("account.photo.removed")}
        </p>
      );
    case "rejected":
      return (
        <p role="alert" className="auth-error account-photo-error">
          {describePhotoIssue(translate, status.issue)}
        </p>
      );
    case "failed":
      return (
        <div role="alert" className="auth-error account-photo-error">
          <p>{describePhotoFailure(translate, status.failure)}</p>
          {status.retry === null ? null : (
            <button
              type="button"
              className="auth-secondary"
              onClick={status.retry}
            >
              {translate("account.photo.retry")}
            </button>
          )}
        </div>
      );
    default:
      return null;
  }
}
