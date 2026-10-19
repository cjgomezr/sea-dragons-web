"use client";

import { Camera } from "@phosphor-icons/react/dist/ssr/Camera";
import { useId, useRef, useState } from "react";
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
 * La foto del perfil propio (#245, FR-084): el círculo de la cabecera (#771)
 * con el botón de cámara que la sube o la cambia y, bajo el nombre, el de
 * quitarla y el aviso de cómo fue.
 *
 * Es de cliente por el estado del envío. Avisa antes de subir lo que no vale
 * (el servidor lo vuelve a comprobar), y sólo cambia la foto que enseña
 * cuando el servidor confirmó: si la subida se corta, sigue la anterior y se
 * ofrece reintentar con el mismo fichero.
 *
 * El nombre y el rol llegan como `children` para que la cabecera siga siendo
 * de servidor y esto sólo envuelva lo que cambia.
 */

/** El círculo de la cabecera (#771), en píxeles; `.profile-hero-avatar` dice
 * lo mismo. */
export const HERO_AVATAR_SIZE = 96;

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
  userId,
  fullName,
  initialPhotoUrl,
  children,
}: {
  locale: Locale;
  /** El `user_id` propio, para abrir la foto en grande (#355). */
  userId: string;
  fullName: string;
  initialPhotoUrl: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();

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
      <span className="profile-hero-photo">
        <MemberAvatar
          className="profile-hero-avatar"
          fullName={fullName}
          photoUrl={photoUrl}
          size={HERO_AVATAR_SIZE}
          alt={translate("account.photo.alt")}
          viewer={{ userId, translate }}
        />
        <button
          type="button"
          className="profile-hero-camera"
          aria-label={cameraLabelOf(translate, status, photoUrl)}
          aria-describedby={hintId}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Camera aria-hidden="true" weight="bold" />
        </button>
      </span>
      <div className="profile-hero-identity">
        {children}
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_TYPES}
          aria-label={translate("account.photo.choose")}
          className="account-photo-input"
          tabIndex={-1}
          onChange={choose}
        />
        <p className="visually-hidden" id={hintId}>
          {describePhotoHint(translate)}
        </p>
        {photoUrl === null ? null : (
          <button
            type="button"
            className="profile-hero-photo-remove"
            disabled={busy}
            onClick={() => void remove()}
          >
            {status.kind === "removing"
              ? translate("account.photo.removing")
              : translate("account.photo.remove")}
          </button>
        )}
        <PhotoStatus translate={translate} status={status} />
      </div>
    </>
  );
}

/** El botón de cámara no tiene texto: su nombre dice lo que hace. */
function cameraLabelOf(
  translate: Translator,
  status: Status,
  photoUrl: string | null,
): string {
  if (status.kind === "uploading") {
    return translate("account.photo.uploading");
  }
  return translate(
    photoUrl === null ? "account.photo.add" : "account.photo.change",
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
