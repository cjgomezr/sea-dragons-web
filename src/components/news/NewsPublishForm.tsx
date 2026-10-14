"use client";

import { useRef, useState } from "react";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import type { Group } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";
import {
  type NewsDraftField,
  listNewsDraftIssues,
} from "@/lib/news/news-draft";
import type { EditableNewsPost } from "@/lib/news/news-management";
import type { NewsPinChange } from "@/lib/news/news-pins";
import {
  NEWS_TITLE_MAX_LENGTH,
  type NewsAudience,
  type NewsCategory,
  type NewsDraft,
} from "@/lib/news/news-posts";
import { type AudienceChoice, AudienceField } from "@/components/AudienceField";
import { NewsAttachmentsField } from "./NewsAttachmentsField";
import { NewsBodyEditor } from "./NewsBodyEditor";
import { NewsCategoryField } from "./NewsCategoryField";
import { NewsCoverField } from "./NewsCoverField";
import { NewsPinField } from "./NewsPinField";
import { describeEditFailure, saveNewsEdit } from "./news-manage-client";
import {
  describeDraftIssue,
  describePublishFailure,
  newsPinFieldOf,
  publishNews,
} from "./news-publish-client";
import {
  type PublishedAudience,
  type PublishedPin,
  rememberPublishedNotice,
} from "./news-published-notice";
import { useNewsAttachments } from "./use-news-attachments";
import { type PinnedNow, useNewsPinChoice } from "./use-news-pin-choice";
import {
  type NewsCoverField as NewsCover,
  useNewsCover,
} from "./use-news-cover";

/**
 * El formulario de publicar (#330, RF-2 y RF-3 del PRD de E11): categoría,
 * título, cuerpo, audiencia y adjuntos.
 *
 * Quien publica lo hace pocas veces al mes, así que el formulario se explica
 * solo: cada campo dice su límite, y lo que falta se marca junto al campo
 * antes de mandar nada, con la misma regla que el servidor. Un fallo al
 * publicar no borra nada: lo escrito y lo subido siguen ahí para reintentar.
 *
 * Editar (#331) es el mismo formulario con los valores cargados y otro verbo.
 * No ofrece adjuntos: la edición cubre categoría, título, cuerpo y audiencia,
 * y los adjuntos tienen sus propios endpoints. Guarda con la marca de editada
 * que tenía delante; si alguien guardó entretanto, el servidor responde con
 * un conflicto y lo escrito se queda para no perderlo.
 *
 * El rediseño de E22 (#597) pone delante la portada, cambia la categoría a un
 * control segmentado y deja el botón desactivado mientras falte algo. Por eso
 * el aviso de un campo sale en cuanto se toca, y no al pulsar: con el botón
 * desactivado no habría otro momento para decir qué falta.
 *
 * El Admin ve además la caja de fijar (#599), después del cuerpo. Solo se
 * manda `pin` si la caja cambió el fijado: editar sin tocarla lo deja igual.
 */

/** Si salió fijada, hasta cuándo, para el aviso del feed. */
function publishedPinOf(change: NewsPinChange): PublishedPin {
  return change.kind === "pin"
    ? { kind: "pinned", until: change.until }
    : { kind: "none" };
}

/** Publicar una nueva, o editar una que ya existe. */
export type NewsFormIntent =
  | { readonly kind: "publish"; readonly onPublished: () => void }
  | {
      readonly kind: "edit";
      readonly post: EditableNewsPost;
      readonly onSaved: () => void;
    };

/** Lo que necesita la caja de fijar, que solo ve quien puede fijar: la
 * fijada vigente del club, para avisar de que se reemplaza. */
export type NewsFormPinning = { readonly pinnedNow: PinnedNow | null };

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
  title: "publicar-titulo",
  body: "publicar-cuerpo",
} as const;

const TITLE_COUNTER_ID = "publicar-titulo-contador";
const UPLOADS_HINT_ID = "publicar-esperando-adjuntos";

function draftOf(post: EditableNewsPost): Draft {
  return {
    category: post.category,
    title: post.title,
    body: post.body,
    audience: {
      kind: post.audience.kind,
      groupIds: new Set(
        post.audience.kind === "groups" ? post.audience.groupIds : [],
      ),
    },
  };
}

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
      <div className="auth-field news-publish-title">
        <div className="news-publish-title-label">
          <label htmlFor={FIELD_IDS.title}>
            {translate("news.publish.titleLabel")}
          </label>
          <span className="news-publish-counter" id={TITLE_COUNTER_ID}>
            {translate("news.publish.titleCounter", {
              length: [...draft.title].length,
              max: NEWS_TITLE_MAX_LENGTH,
            })}
          </span>
        </div>
        <input
          id={FIELD_IDS.title}
          type="text"
          value={draft.title}
          autoComplete="off"
          aria-invalid={titleIssue !== null}
          aria-describedby={describedBy(
            titleIssue === null ? null : titleIssueId,
            TITLE_COUNTER_ID,
          )}
          onChange={(event) => onChange({ title: event.target.value })}
        />
        <FieldIssue id={titleIssueId} text={titleIssue} />
      </div>
      <div className="auth-field">
        <NewsBodyEditor
          translate={translate}
          id={FIELD_IDS.body}
          value={draft.body}
          onChange={(body) => onChange({ body })}
          issueId={bodyIssue === null ? null : bodyIssueId}
        />
        <FieldIssue id={bodyIssueId} text={bodyIssue} />
      </div>
    </>
  );
}

function SubmitFailure({
  translate,
  intent,
  status,
}: {
  readonly translate: Translator;
  readonly intent: NewsFormIntent["kind"];
  readonly status: Status;
}): React.JSX.Element | null {
  if (status.kind !== "failed") {
    return null;
  }
  return (
    <p className="auth-error" role="alert">
      {intent === "edit"
        ? describeEditFailure(translate, status)
        : describePublishFailure(translate, status)}
    </p>
  );
}

function submitLabel(
  translate: Translator,
  intent: NewsFormIntent["kind"],
  isSending: boolean,
): string {
  if (intent === "edit") {
    return translate(isSending ? "news.edit.sending" : "news.edit.submit");
  }
  return translate(isSending ? "news.publish.sending" : "news.publish.submit");
}

/** Lo que el borrador cambia de cada campo, para saber cuáles se tocaron. */
const DRAFT_FIELDS: Readonly<Record<keyof Draft, NewsDraftField | null>> = {
  category: null,
  title: "title",
  body: "body",
  audience: "audience",
};

function touchedBy(change: Partial<Draft>): readonly NewsDraftField[] {
  return Object.entries(DRAFT_FIELDS).flatMap(([key, field]) =>
    field !== null && key in change ? [field] : [],
  );
}

/** A quién avisó lo publicado, con los nombres de los grupos de hoy. */
function publishedAudienceOf(
  audience: NewsAudience,
  clubGroups: readonly Group[],
): PublishedAudience {
  if (audience.kind === "club") {
    return { kind: "club" };
  }
  return {
    kind: "groups",
    groupNames: clubGroups
      .filter((group) => audience.groupIds.includes(group.id))
      .map((group) => group.name),
  };
}

type FormSubmission = {
  readonly draft: NewsDraft;
  readonly attachmentUploadIds: readonly string[];
  readonly cover: NewsCover["change"];
  readonly pin: NewsPinChange;
};

/** Editar sólo manda la portada si cambió; publicar la manda siempre. */
function sendSubmission(
  intent: NewsFormIntent,
  submission: FormSubmission,
): ReturnType<typeof saveNewsEdit | typeof publishNews> {
  const { draft, cover } = submission;
  const pin = newsPinFieldOf(submission.pin);
  if (intent.kind === "edit") {
    return saveNewsEdit(intent.post.id, {
      ...draft,
      ...pin,
      expectedEditedAt: intent.post.editedAt,
      ...(cover.kind === "replace"
        ? { coverUploadId: cover.coverUploadId }
        : {}),
    });
  }
  return publishNews({
    ...draft,
    ...pin,
    attachmentUploadIds: submission.attachmentUploadIds,
    coverUploadId: cover.kind === "replace" ? cover.coverUploadId : null,
  });
}

export function NewsPublishForm({
  translate,
  clubGroups,
  intent,
  pinning,
}: {
  readonly translate: Translator;
  readonly clubGroups: readonly Group[];
  readonly intent: NewsFormIntent;
  /** `null` para quien no puede fijar: no ve la caja. */
  readonly pinning: NewsFormPinning | null;
}): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>(() =>
    intent.kind === "edit" ? draftOf(intent.post) : EMPTY_DRAFT,
  );
  const [status, setStatus] = useState<Status>({ kind: "editing" });
  const [touched, setTouched] = useState<ReadonlySet<NewsDraftField>>(
    () => new Set(),
  );
  const attachments = useNewsAttachments();
  const cover = useNewsCover(
    intent.kind === "edit" ? intent.post.coverUrl : null,
  );
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isSendingRef = useRef(false);
  const pin = useNewsPinChoice(
    intent.kind === "edit" ? intent.post : null,
    pinning?.pinnedNow ?? null,
  );
  const audience = toAudience(draft.audience);
  const issues = listNewsDraftIssues({ ...draft, audience });
  const isUploading = attachments.isUploading || cover.isUploading;
  const isSending = status.kind === "sending";

  function update(change: Partial<Draft>): void {
    setDraft((current) => ({ ...current, ...change }));
    setTouched((current) => new Set([...current, ...touchedBy(change)]));
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (isSendingRef.current || isUploading || issues.length > 0) {
      return;
    }
    isSendingRef.current = true;
    setStatus({ kind: "sending" });
    const pinChange = pin.changeAt(new Date());
    const result = await sendSubmission(intent, {
      draft: {
        category: draft.category,
        title: draft.title,
        body: draft.body,
        audience,
      },
      attachmentUploadIds: attachments.uploadIds,
      cover: cover.change,
      pin: pinChange,
    });
    isSendingRef.current = false;
    if (result.kind === "failed") {
      setStatus(result);
      return;
    }
    if (intent.kind === "edit") {
      intent.onSaved();
      return;
    }
    rememberPublishedNotice({
      audience: publishedAudienceOf(audience, clubGroups),
      pin: publishedPinOf(pinChange),
    });
    intent.onPublished();
  }

  const issueTextFor = (field: NewsDraftField): string | null => {
    const issue = issues.find((candidate) => candidate.field === field);
    return issue === undefined || !touched.has(field)
      ? null
      : describeDraftIssue(translate, issue.code);
  };
  const fieldProps: TextFieldsProps = {
    translate,
    draft,
    issueTextFor,
    onChange: update,
  };

  return (
    <form className="news-publish-form" onSubmit={handleSubmit} noValidate>
      <fieldset className="news-publish-fields" disabled={isSending}>
        <NewsCoverField
          translate={translate}
          category={draft.category}
          field={cover}
        />
        <NewsCategoryField
          translate={translate}
          category={draft.category}
          onChange={(category) => update({ category })}
        />
        <TitleAndBodyFields {...fieldProps} />
        {pinning === null ? null : (
          <NewsPinField
            translate={translate}
            choice={pin.choice}
            replacedTitle={pin.replacedTitle}
            onToggle={pin.onToggle}
            onChoose={pin.onChoose}
          />
        )}
        <AudienceField
          translate={translate}
          legend={translate("news.publish.audience.legend")}
          clubGroups={clubGroups}
          audience={draft.audience}
          issueText={issueTextFor("audience")}
          onChange={(choice) => update({ audience: choice })}
        />
        {intent.kind === "publish" ? (
          <NewsAttachmentsField
            translate={translate}
            attachments={attachments}
          />
        ) : null}
      </fieldset>
      <SubmitFailure
        translate={translate}
        intent={intent.kind}
        status={status}
      />
      {isUploading ? (
        <p className="auth-note" id={UPLOADS_HINT_ID}>
          {translate("news.publish.waitForUploads")}
        </p>
      ) : null}
      <button
        type="submit"
        className="auth-submit news-publish-submit"
        disabled={isSending || isUploading || issues.length > 0}
        aria-describedby={isUploading ? UPLOADS_HINT_ID : undefined}
      >
        {submitLabel(translate, intent.kind, isSending)}
      </button>
    </form>
  );
}
