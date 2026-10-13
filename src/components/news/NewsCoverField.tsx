"use client";

import { Image as ImageGlyph } from "@phosphor-icons/react/dist/ssr/Image";
import { useEffect, useRef } from "react";
import type { Translator } from "@/lib/i18n/translator";
import type { NewsCategory } from "@/lib/news/news-posts";
import { NewsCategoryFallback } from "./NewsCategoryFallback";
import {
  describeAttachmentIssue,
  describePublishFailure,
} from "./news-publish-client";
import {
  NEWS_COVER_TYPES,
  type NewsCoverField as NewsCoverState,
  type NewsCoverIssue,
} from "./use-news-cover";

/**
 * La portada del formulario de publicar y editar (#597, el "#2b" del handoff
 * de E22). Sin portada se ve el fondo de la categoría elegida, que es lo que
 * enseñará el feed; con ella, la foto tal como se subió. La subida la lleva
 * `useNewsCover`.
 *
 * `<img>` y no `next/image`: la vista previa es una URL de objeto del archivo
 * elegido o una URL firmada, y su tamaño natural no se sabe de antemano.
 */

const ISSUE_ID = "publicar-portada-aviso";

function describeCoverIssue(
  translate: Translator,
  issue: NewsCoverIssue,
): string {
  return issue.kind === "rejected"
    ? describeAttachmentIssue(translate, issue.code)
    : describePublishFailure(translate, issue.failure);
}

function CoverBanner({
  translate,
  category,
  addButton,
  onAdd,
}: {
  readonly translate: Translator;
  readonly category: NewsCategory;
  readonly addButton: React.RefObject<HTMLButtonElement | null>;
  readonly onAdd: () => void;
}): React.JSX.Element {
  const categoryName = translate(`news.category.${category}`).toLocaleLowerCase(
    translate.locale,
  );
  return (
    <div className="news-cover-banner">
      <NewsCategoryFallback category={category} iconSize={88} />
      <div className="news-cover-banner-content">
        <p className="news-cover-banner-text">
          <strong>{translate("news.publish.cover.empty")}</strong>
          <span>
            {translate("news.publish.cover.fallback", {
              category: categoryName,
            })}
          </span>
        </p>
        <button
          ref={addButton}
          type="button"
          className="admin-secondary news-cover-add"
          onClick={onAdd}
        >
          <ImageGlyph aria-hidden="true" focusable="false" size={18} />
          {translate("news.publish.cover.add")}
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
        className="news-cover-preview"
        src={url}
        alt={translate("news.publish.cover.preview")}
      />
      <div className="news-cover-preview-footer">
        <p className="auth-hint">{translate("news.publish.cover.hint")}</p>
        <button type="button" className="news-cover-remove" onClick={onRemove}>
          {translate("news.publish.cover.remove")}
        </button>
      </div>
    </>
  );
}

function CoverUploading({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <div className="news-cover-banner news-cover-uploading">
      <p role="status">{translate("news.publish.attachments.uploading")}</p>
    </div>
  );
}

function CoverIssue({
  translate,
  issue,
}: {
  readonly translate: Translator;
  readonly issue: NewsCoverIssue | null;
}): React.JSX.Element | null {
  return issue === null ? null : (
    <p className="auth-field-error" id={ISSUE_ID} role="alert">
      {describeCoverIssue(translate, issue)}
    </p>
  );
}

export function NewsCoverField({
  translate,
  category,
  field,
}: {
  readonly translate: Translator;
  readonly category: NewsCategory;
  readonly field: NewsCoverState;
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // Quitar la portada se lleva el botón que tenía el foco: el foco pasa al
  // de añadirla, que aparece en su sitio.
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
      className="news-publish-cover"
      aria-describedby={field.issue === null ? undefined : ISSUE_ID}
    >
      <legend>
        {translate("news.publish.cover.legend")}{" "}
        <span className="news-publish-optional">
          · {translate("news.publish.cover.optional")}
        </span>
      </legend>
      {cover.kind === "none" ? (
        <CoverBanner
          translate={translate}
          category={category}
          addButton={addButton}
          onAdd={() => input.current?.click()}
        />
      ) : null}
      {cover.kind === "uploading" ? (
        <CoverUploading translate={translate} />
      ) : null}
      {cover.kind === "current" || cover.kind === "uploaded" ? (
        <CoverPreview
          translate={translate}
          url={cover.kind === "current" ? cover.url : cover.previewUrl}
          onRemove={remove}
        />
      ) : null}
      <CoverIssue translate={translate} issue={field.issue} />
      <input
        ref={input}
        type="file"
        accept={NEWS_COVER_TYPES.join(",")}
        aria-label={translate("news.publish.cover.choose")}
        className="account-photo-input"
        tabIndex={-1}
        onChange={choose}
      />
    </fieldset>
  );
}
