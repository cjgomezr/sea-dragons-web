"use client";

import { useRef, useState } from "react";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import type { Group } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";
import {
  type NewsDraftField,
  type NewsDraftIssue,
  listNewsDraftIssues,
} from "@/lib/news/news-draft";
import {
  NEWS_CATEGORIES,
  NEWS_TITLE_MAX_LENGTH,
  type NewsAudience,
  type NewsCategory,
} from "@/lib/news/news-posts";
import { type AudienceChoice, NewsAudienceField } from "./NewsAudienceField";
import { NewsAttachmentsField } from "./NewsAttachmentsField";
import {
  describeDraftIssue,
  describePublishFailure,
  publishNews,
} from "./news-publish-client";
import { useNewsAttachments } from "./use-news-attachments";

/**
 * El formulario de publicar (#330, RF-2 y RF-3 del PRD de E11): categoría,
 * título, cuerpo, audiencia y adjuntos.
 *
 * Quien publica lo hace pocas veces al mes, así que el formulario se explica
 * solo: cada campo dice su límite, y lo que falta se marca junto al campo
 * antes de mandar nada, con la misma regla que el servidor. Un fallo al
 * publicar no borra nada: lo escrito y lo subido siguen ahí para reintentar.
 */

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "sending" }
  | ApiRequestFailure;

type Draft = {
  readonly category: NewsCategory;
  readonly title: string;
  readonly body: string;
  readonly audience: AudienceChoice;
};

const EMPTY_DRAFT: Draft = {
  category: "news",
  title: "",
  body: "",
  audience: { kind: "club", groupIds: new Set() },
};

const FIELD_IDS = {
  category: "publicar-categoria",
  title: "publicar-titulo",
  body: "publicar-cuerpo",
} as const;

const TITLE_HINT_ID = "publicar-titulo-pista";
const BODY_HINT_ID = "publicar-cuerpo-pista";
const UPLOADS_HINT_ID = "publicar-esperando-adjuntos";

function toAudience(choice: AudienceChoice): NewsAudience {
  return choice.kind === "club"
    ? { kind: "club" }
    : { kind: "groups", groupIds: [...choice.groupIds] };
}

/** Los ids que describen un campo: su aviso, si lo tiene, y su pista. */
function describedBy(
  issueId: string | null,
  hintId: string,
): string | undefined {
  return issueId === null ? hintId : `${issueId} ${hintId}`;
}

function FieldIssue({
  id,
  text,
}: {
  readonly id: string;
  readonly text: string | null;
}): React.JSX.Element | null {
  return text === null ? null : (
    <p className="auth-field-error" id={id}>
      {text}
    </p>
  );
}

type TextFieldsProps = {
  readonly translate: Translator;
  readonly draft: Draft;
  readonly issueTextFor: (field: NewsDraftField) => string | null;
  readonly onChange: (change: Partial<Draft>) => void;
};

function CategoryField({
  translate,
  draft,
  onChange,
}: TextFieldsProps): React.JSX.Element {
  return (
    <div className="auth-field">
      <label htmlFor={FIELD_IDS.category}>
        {translate("news.publish.category")}
      </label>
      <select
        id={FIELD_IDS.category}
        value={draft.category}
        onChange={(event) => {
          const category = NEWS_CATEGORIES.find(
            (candidate) => candidate === event.target.value,
          );
          if (category !== undefined) {
            onChange({ category });
          }
        }}
      >
        {NEWS_CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {translate(`news.category.${category}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

function TitleAndBodyFields({
  translate,
  draft,
  issueTextFor,
  onChange,
}: TextFieldsProps): React.JSX.Element {
  const titleIssue = issueTextFor("title");
  const bodyIssue = issueTextFor("body");
  const titleIssueId = `${FIELD_IDS.title}-aviso`;
  const bodyIssueId = `${FIELD_IDS.body}-aviso`;
  return (
    <>
      <div className="auth-field">
        <label htmlFor={FIELD_IDS.title}>
          {translate("news.publish.titleLabel")}
        </label>
        <input
          id={FIELD_IDS.title}
          type="text"
          value={draft.title}
          autoComplete="off"
          aria-invalid={titleIssue !== null}
          aria-describedby={describedBy(
            titleIssue === null ? null : titleIssueId,
            TITLE_HINT_ID,
          )}
          onChange={(event) => onChange({ title: event.target.value })}
        />
        <FieldIssue id={titleIssueId} text={titleIssue} />
        <p className="auth-hint" id={TITLE_HINT_ID}>
          {translate("news.publish.titleHint", { max: NEWS_TITLE_MAX_LENGTH })}
        </p>
      </div>
      <div className="auth-field">
        <label htmlFor={FIELD_IDS.body}>{translate("news.publish.body")}</label>
        <textarea
          id={FIELD_IDS.body}
          className="news-publish-body"
          value={draft.body}
          aria-invalid={bodyIssue !== null}
          aria-describedby={describedBy(
            bodyIssue === null ? null : bodyIssueId,
            BODY_HINT_ID,
          )}
          onChange={(event) => onChange({ body: event.target.value })}
        />
        <FieldIssue id={bodyIssueId} text={bodyIssue} />
        <p className="auth-hint" id={BODY_HINT_ID}>
          {translate("news.publish.bodyHint")}
        </p>
      </div>
    </>
  );
}

function SubmitFailure({
  translate,
  status,
}: {
  readonly translate: Translator;
  readonly status: Status;
}): React.JSX.Element | null {
  if (status.kind !== "failed") {
    return null;
  }
  return (
    <p className="auth-error" role="alert">
      {describePublishFailure(translate, status)}
    </p>
  );
}

export function NewsPublishForm({
  translate,
  clubGroups,
  onPublished,
}: {
  readonly translate: Translator;
  readonly clubGroups: readonly Group[];
  readonly onPublished: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [status, setStatus] = useState<Status>({ kind: "editing" });
  const [issues, setIssues] = useState<readonly NewsDraftIssue[]>([]);
  const attachments = useNewsAttachments();
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isSendingRef = useRef(false);

  function update(change: Partial<Draft>): void {
    setDraft((current) => ({ ...current, ...change }));
    setIssues([]);
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (isSendingRef.current || attachments.isUploading) {
      return;
    }
    const audience = toAudience(draft.audience);
    const found = listNewsDraftIssues({ ...draft, audience });
    if (found.length > 0) {
      setIssues(found);
      return;
    }
    isSendingRef.current = true;
    setStatus({ kind: "sending" });
    const result = await publishNews({
      category: draft.category,
      title: draft.title,
      body: draft.body,
      audience,
      attachmentUploadIds: attachments.uploadIds,
    });
    isSendingRef.current = false;
    if (result.kind === "failed") {
      setStatus(result);
      return;
    }
    onPublished();
  }

  const issueTextFor = (field: NewsDraftField): string | null => {
    const issue = issues.find((candidate) => candidate.field === field);
    return issue === undefined
      ? null
      : describeDraftIssue(translate, issue.code);
  };
  const isSending = status.kind === "sending";
  const fieldProps: TextFieldsProps = {
    translate,
    draft,
    issueTextFor,
    onChange: update,
  };

  return (
    <form
      className="auth-pending member-record-form news-publish-form"
      onSubmit={handleSubmit}
      noValidate
    >
      <fieldset className="member-record-fields" disabled={isSending}>
        <CategoryField {...fieldProps} />
        <TitleAndBodyFields {...fieldProps} />
        <NewsAudienceField
          translate={translate}
          clubGroups={clubGroups}
          audience={draft.audience}
          issueText={issueTextFor("audience")}
          onChange={(audience) => update({ audience })}
        />
        <NewsAttachmentsField translate={translate} attachments={attachments} />
      </fieldset>
      <SubmitFailure translate={translate} status={status} />
      {attachments.isUploading ? (
        <p className="auth-note" id={UPLOADS_HINT_ID}>
          {translate("news.publish.waitForUploads")}
        </p>
      ) : null}
      <button
        type="submit"
        className="auth-submit"
        disabled={isSending || attachments.isUploading}
        aria-describedby={attachments.isUploading ? UPLOADS_HINT_ID : undefined}
      >
        {translate(isSending ? "news.publish.sending" : "news.publish.submit")}
      </button>
    </form>
  );
}
