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
  type NewsDraft,
} from "@/lib/news/news-posts";
import { type AudienceChoice, AudienceField } from "@/components/AudienceField";
import { useIsPhone } from "@/components/use-is-phone";
import { NewsAttachmentsField } from "./NewsAttachmentsField";
import { NewsBodyEditor } from "./NewsBodyEditor";
import { NewsCategoryField } from "./NewsCategoryField";
import { NewsCoverField } from "./NewsCoverField";
import { NewsPinField } from "./NewsPinField";
import { NewsPublishBar, type NewsPublishBarSubmit } from "./NewsPublishBar";
import {
  EMPTY_NEWS_FORM_DRAFT,
  type NewsFormDraft,
  isSameNewsFormDraft,
  newsFormDraftOf,
} from "./news-form-draft";
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
import {
  type NewsInlineImageUploader,
  useNewsInlineImageUpload,
} from "./use-news-inline-images";

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
  /** Salió bien y se está volviendo: el botón lo dice mientras tanto. */
  | { readonly kind: "done" }
  | ApiRequestFailure;

type Draft = NewsFormDraft;

const FIELD_IDS = {
  title: "publicar-titulo",
  body: "publicar-cuerpo",
} as const;

const TITLE_COUNTER_ID = "publicar-titulo-contador";
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
  readonly imageUpload: NewsInlineImageUploader;
};

function TitleAndBodyFields({
  translate,
  draft,
  issueTextFor,
  onChange,
  imageUpload,
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
          imageUpload={imageUpload}
        />
        <FieldIssue id={bodyIssueId} text={bodyIssue} />
      </div>
    </>
  );
}

/** Por qué no salió, o que espera a las subidas. En el móvil va bajo la
 * barra, junto al botón al que se refiere. */
function SubmitNotes({
  translate,
  intent,
  status,
  isUploading,
}: {
  readonly translate: Translator;
  readonly intent: NewsFormIntent["kind"];
  readonly status: Status;
  readonly isUploading: boolean;
}): React.JSX.Element {
  return (
    <>
      {status.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {intent === "edit"
            ? describeEditFailure(translate, status)
            : describePublishFailure(translate, status)}
        </p>
      ) : null}
      {isUploading ? (
        <p className="auth-note" id={UPLOADS_HINT_ID}>
          {translate("news.publish.waitForUploads")}
        </p>
      ) : null}
    </>
  );
}

/** Las frases del botón principal según la pantalla. En la barra del móvil
 * no cabe "Guardar cambios": dice "Guardar". */
const SUBMIT_LABELS = {
  publish: {
    idle: "news.publish.submit",
    barIdle: "news.publish.submit",
    sending: "news.publish.sending",
    done: "news.publish.done",
  },
  edit: {
    idle: "news.edit.submit",
    barIdle: "news.edit.barSubmit",
    sending: "news.edit.sending",
    done: "news.edit.done",
  },
} as const;

function submitLabel(
  translate: Translator,
  context: {
    readonly intent: NewsFormIntent["kind"];
    readonly status: Status;
    readonly isPhone: boolean;
  },
): string {
  const labels = SUBMIT_LABELS[context.intent];
  switch (context.status.kind) {
    case "sending":
      return translate(labels.sending);
    case "done":
      return translate(labels.done);
    default:
      return translate(context.isPhone ? labels.barIdle : labels.idle);
  }
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
  onLeave,
}: {
  readonly translate: Translator;
  readonly clubGroups: readonly Group[];
  readonly intent: NewsFormIntent;
  /** `null` para quien no puede fijar: no ve la caja. */
  readonly pinning: NewsFormPinning | null;
  /** Cancelar en la barra del móvil, ya confirmado si había cambios. */
  readonly onLeave: () => void;
}): React.JSX.Element {
  const [initialDraft] = useState<Draft>(() =>
    intent.kind === "edit"
      ? newsFormDraftOf(intent.post)
      : EMPTY_NEWS_FORM_DRAFT,
  );
  const [draft, setDraft] = useState<Draft>(initialDraft);
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
  const inlineImages = useNewsInlineImageUpload();
  const isUploading =
    attachments.isUploading || cover.isUploading || inlineImages.isUploading;
  const isLocked = status.kind === "sending" || status.kind === "done";
  const isPhone = useIsPhone();

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
    if (result.kind === "failed") {
      isSendingRef.current = false;
      setStatus(result);
      return;
    }
    setStatus({ kind: "done" });
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

  function hasUnsavedChanges(): boolean {
    return (
      !isSameNewsFormDraft(initialDraft, draft) ||
      cover.isUploading ||
      cover.change.kind !== "keep" ||
      attachments.entries.length > 0 ||
      pin.changeAt(new Date()).kind !== "keep"
    );
  }

  function cancel(): void {
    if (
      !hasUnsavedChanges() ||
      window.confirm(translate("news.publish.bar.discardQuestion"))
    ) {
      onLeave();
    }
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
    imageUpload: inlineImages,
  };

  const submit: NewsPublishBarSubmit = {
    label: submitLabel(translate, { intent: intent.kind, status, isPhone }),
    isDisabled: isLocked || isUploading || issues.length > 0,
    describedBy: isUploading ? UPLOADS_HINT_ID : undefined,
  };
  const submitNotes = (
    <SubmitNotes
      translate={translate}
      intent={intent.kind}
      status={status}
      isUploading={isUploading}
    />
  );

  return (
    <form
      className={
        isPhone
          ? "news-publish-form news-publish-form-phone"
          : "news-publish-form"
      }
      onSubmit={handleSubmit}
      noValidate
    >
      {isPhone ? (
        <>
          <NewsPublishBar
            translate={translate}
            heading={translate(
              intent.kind === "edit" ? "news.edit.title" : "news.publish.title",
            )}
            submit={submit}
            onCancel={cancel}
          />
          {submitNotes}
        </>
      ) : null}
      <fieldset className="news-publish-fields" disabled={isLocked}>
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
      {isPhone ? null : (
        <>
          {submitNotes}
          <button
            type="submit"
            className="auth-submit news-publish-submit"
            disabled={submit.isDisabled}
            aria-describedby={submit.describedBy}
          >
            {submit.label}
          </button>
        </>
      )}
    </form>
  );
}
