"use client";

import { Image as ImageGlyph } from "@phosphor-icons/react/dist/ssr/Image";
import { useEffect, useRef } from "react";
import type { EventType } from "@/lib/events/event-creation";
import type { Translator } from "@/lib/i18n/translator";
import { describeEventIssue } from "./event-create-client";
import { EventCoverFallback } from "./EventCoverFallback";
import {
  EVENT_COVER_TYPES,
  type EventCoverField as EventCoverState,
  type EventCoverIssue,
} from "./use-event-cover";

/**
 * La imagen del diálogo de evento (#650, punto 1 del "#1c" del handoff de
 * E24). Sin imagen se ve el fondo del tipo elegido, que es lo que enseñará la
 * agenda; con ella, la foto tal como se subió. La subida la lleva
 * `useEventCover`.
 *
 * `<img>` y no `next/image`: la vista previa es una URL de objeto del archivo
 * elegido o una URL firmada, y su tamaño natural no se sabe de antemano.
 */

const ISSUE_ID = "evento-imagen-aviso";

/** El icono del fondo, del tamaño del de la imagen del panel. */
const BANNER_ICON_SIZE = 76;

export function describeCoverIssue(
  translate: Translator,
  issue: EventCoverIssue,
): string {
  if (issue.kind === "rejected") {
    return describeEventIssue(translate, { field: "cover", code: issue.code });
  }
  return issue.failure.failure === "network"
    ? translate("calendar.form.error.network")
    : translate("calendar.form.image.uploadFailed");
}

function CoverBanner({
  translate,
  eventType,
  addButton,
  onAdd,
}: {
  readonly translate: Translator;
  readonly eventType: EventType;
  readonly addButton: React.RefObject<HTMLButtonElement | null>;
  readonly onAdd: () => void;
}): React.JSX.Element {
  const typeName = translate(`event.type.${eventType}`).toLocaleLowerCase(
    translate.locale,
  );
  return (
    <div className="event-cover-banner">
      <EventCoverFallback eventType={eventType} iconSize={BANNER_ICON_SIZE} />
      <div className="event-cover-banner-content">
        <p className="event-cover-banner-text">
          {translate("calendar.form.image.fallback", { type: typeName })}
        </p>
        <button
          ref={addButton}
          type="button"
          className="admin-secondary event-cover-add"
          onClick={onAdd}
        >
          <ImageGlyph aria-hidden="true" focusable="false" size={18} />
          {translate("calendar.form.image.add")}
        </button>
      </div>
    </div>
  );
}

function CoverPreview({
  translate,
  url,
  onRemove,
}: {
  readonly translate: Translator;
  readonly url: string;
  readonly onRemove: () => void;
}): React.JSX.Element {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- ver el comentario del componente. */}
      <img
        className="event-cover-preview"
        src={url}
        alt={translate("calendar.form.image.preview")}
      />
      <button type="button" className="event-cover-remove" onClick={onRemove}>
        {translate("calendar.form.image.remove")}
      </button>
    </>
  );
}

export function EventCoverField({
  translate,
  eventType,
  field,
  issueText,
}: {
  readonly translate: Translator;
  readonly eventType: EventType;
  readonly field: EventCoverState;
  /** Por qué no vale: la subida, o lo que dijo el servidor al guardar. */
  readonly issueText: string | null;
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // Quitar la imagen se lleva el botón que tenía el foco: el foco pasa al de
  // añadirla, que aparece en su sitio.
  const shouldFocusAdd = useRef(false);
  const { cover } = field;

  useEffect(() => {
    if (cover.kind === "none" && shouldFocusAdd.current) {
      shouldFocusAdd.current = false;
      addButton.current?.focus();
    }
  }, [cover.kind]);

  function remove(): void {
    shouldFocusAdd.current = true;
    field.remove();
  }

  function choose(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.item(0) ?? null;
    // Vaciarlo deja volver a elegir la misma imagen después de quitarla.
    event.target.value = "";
    if (file !== null) {
      field.choose(file);
    }
  }

  return (
    <fieldset
      className="event-cover-field"
      aria-describedby={issueText === null ? undefined : ISSUE_ID}
    >
      <legend>
        {translate("calendar.form.image")}{" "}
        <span className="event-form-optional">
          · {translate("calendar.form.image.optional")}
        </span>
      </legend>
      {cover.kind === "none" ? (
        <CoverBanner
          translate={translate}
          eventType={eventType}
          addButton={addButton}
          onAdd={() => input.current?.click()}
        />
      ) : null}
      {cover.kind === "uploading" ? (
        <div className="event-cover-banner event-cover-uploading">
          <p role="status">{translate("calendar.form.image.uploading")}</p>
        </div>
      ) : null}
      {cover.kind === "current" || cover.kind === "uploaded" ? (
        <CoverPreview
          translate={translate}
          url={cover.kind === "current" ? cover.url : cover.previewUrl}
          onRemove={remove}
        />
      ) : null}
      {issueText === null ? null : (
        <p className="auth-field-error" id={ISSUE_ID} role="alert">
          {issueText}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept={EVENT_COVER_TYPES.join(",")}
        aria-label={translate("calendar.form.image.choose")}
        className="account-photo-input"
        tabIndex={-1}
        onChange={choose}
      />
    </fieldset>
  );
}
