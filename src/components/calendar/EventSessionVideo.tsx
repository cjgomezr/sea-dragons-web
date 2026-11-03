import { PlayCircle } from "@phosphor-icons/react/dist/ssr/PlayCircle";
import { YoutubeLogo } from "@phosphor-icons/react/dist/ssr/YoutubeLogo";
import { useEffect, useId, useRef, useState } from "react";
import {
  type SessionVideoUrlIssue,
  parseSessionVideoUrl,
} from "@/lib/events/session-video-url";
import type { Translator } from "@/lib/i18n/translator";
import { useFocusOnMount } from "./EventOrganizerActions";
import {
  describeSessionVideoIssue,
  readSessionVideoIssue,
  removeSessionVideo,
  saveSessionVideo,
} from "./session-video-client";

/**
 * El vídeo de la sesión en la pantalla del evento (#965, RF-4 del PRD de
 * E37), como un bloque más junto a la tarjeta del lugar. Quien ve el evento
 * abre el vídeo en YouTube, en una pestaña nueva. Admin, Committee y Coach lo
 * ponen, lo cambian y lo quitan aquí mismo; quitarlo pide confirmación en
 * línea, como cancelar un evento.
 *
 * Un evento cancelado no recibe vídeo nuevo, pero el que tenía se sigue
 * viendo y se puede quitar. El vídeo vive en la fila, que pinta su icono: lo
 * guardado se le pasa con `onChange` y la fila lo vuelve a dar aquí.
 */

/** Lo que el campo dice debajo: el motivo del enlace o que no se guardó. */
type FieldIssue = SessionVideoUrlIssue | "save_failed";

/** Qué recibe el foco al volver a ver el bloque. */
type ViewFocus = "none" | "edit" | "remove" | "watch";

type Step =
  | { readonly kind: "viewing"; readonly focus: ViewFocus }
  | {
      readonly kind: "editing";
      readonly draft: string;
      readonly issue: FieldIssue | null;
      readonly isSaving: boolean;
    }
  | {
      readonly kind: "confirming";
      readonly isRemoving: boolean;
      readonly hasFailed: boolean;
    };

type Announcement = "calendar.video.saved" | "calendar.video.removed";

const ICON_SIZE = 18;

function describeFieldIssue(translate: Translator, issue: FieldIssue): string {
  return issue === "save_failed"
    ? translate("calendar.video.saveFailed")
    : describeSessionVideoIssue(translate, issue);
}

/** Enfoca el elemento al montarse si le toca. */
function useFocusWhen<Element extends HTMLElement>(
  shouldFocus: boolean,
): React.RefObject<Element | null> {
  const ref = useRef<Element>(null);
  useEffect(() => {
    if (shouldFocus) {
      ref.current?.focus();
    }
  }, [shouldFocus]);
  return ref;
}

function WatchLink({
  translate,
  url,
  shouldFocus,
}: {
  readonly translate: Translator;
  readonly url: string;
  readonly shouldFocus: boolean;
}): React.JSX.Element {
  const ref = useFocusWhen<HTMLAnchorElement>(shouldFocus);
  return (
    <a
      ref={ref}
      className="agenda-video-watch"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <YoutubeLogo aria-hidden="true" focusable="false" size={ICON_SIZE} />
      {translate("calendar.video.watch")}{" "}
      <span className="visually-hidden">
        {translate("calendar.panel.opensNewTab")}
      </span>
    </a>
  );
}

function VideoView({
  translate,
  videoUrl,
  canChange,
  canRemove,
  focus,
  onEdit,
  onRemove,
}: {
  readonly translate: Translator;
  readonly videoUrl: string | null;
  readonly canChange: boolean;
  readonly canRemove: boolean;
  readonly focus: ViewFocus;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}): React.JSX.Element {
  const editRef = useFocusWhen<HTMLButtonElement>(focus === "edit");
  const removeRef = useFocusWhen<HTMLButtonElement>(focus === "remove");
  return (
    <>
      {videoUrl === null ? null : (
        <WatchLink
          translate={translate}
          url={videoUrl}
          shouldFocus={focus === "watch"}
        />
      )}
      {canChange || canRemove ? (
        <div className="agenda-video-actions">
          {canChange ? (
            <button
              ref={editRef}
              type="button"
              className="admin-secondary"
              onClick={onEdit}
            >
              {videoUrl === null ? (
                <PlayCircle
                  aria-hidden="true"
                  focusable="false"
                  size={ICON_SIZE}
                />
              ) : null}
              {translate(
                videoUrl === null
                  ? "calendar.video.add"
                  : "calendar.video.change",
              )}
            </button>
          ) : null}
          {canRemove ? (
            <button
              ref={removeRef}
              type="button"
              className="admin-secondary"
              onClick={onRemove}
            >
              {translate("calendar.video.remove")}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function VideoForm({
  translate,
  draft,
  issue,
  isSaving,
  onDraft,
  onSave,
  onCancel,
}: {
  readonly translate: Translator;
  readonly draft: string;
  readonly issue: FieldIssue | null;
  readonly isSaving: boolean;
  readonly onDraft: (draft: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const fieldId = useId();
  const issueId = useId();
  const inputRef = useFocusOnMount<HTMLInputElement>();

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSave();
  }

  return (
    <form className="agenda-video-form" onSubmit={submit} noValidate>
      <div className="auth-field">
        <label htmlFor={fieldId}>{translate("calendar.video.field")}</label>
        <input
          ref={inputRef}
          id={fieldId}
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://youtu.be/…"
          value={draft}
          aria-invalid={issue !== null}
          aria-describedby={issue === null ? undefined : issueId}
          onChange={(change) => onDraft(change.target.value)}
        />
        {issue === null ? null : (
          <p className="auth-field-error" id={issueId}>
            {describeFieldIssue(translate, issue)}
          </p>
        )}
      </div>
      <div className="groups-actions">
        <button type="submit" className="auth-submit" disabled={isSaving}>
          {translate(
            isSaving ? "calendar.video.saving" : "calendar.video.save",
          )}
        </button>
        <button
          type="button"
          className="admin-secondary"
          disabled={isSaving}
          onClick={onCancel}
        >
          {translate("calendar.video.cancel")}
        </button>
      </div>
    </form>
  );
}

function RemoveConfirmation({
  translate,
  isRemoving,
  hasFailed,
  onConfirm,
  onKeep,
}: {
  readonly translate: Translator;
  readonly isRemoving: boolean;
  readonly hasFailed: boolean;
  readonly onConfirm: () => void;
  readonly onKeep: () => void;
}): React.JSX.Element {
  const questionId = useId();
  const questionRef = useFocusOnMount<HTMLParagraphElement>();
  return (
    <div
      className="groups-confirm agenda-organizer-step"
      role="group"
      aria-labelledby={questionId}
    >
      <p
        id={questionId}
        ref={questionRef}
        className="groups-question"
        tabIndex={-1}
      >
        {translate("calendar.video.removeQuestion")}
      </p>
      {hasFailed ? (
        <p className="auth-error" role="alert">
          {translate("calendar.video.removeFailed")}
        </p>
      ) : null}
      <div className="groups-actions">
        <button
          type="button"
          className="groups-danger"
          disabled={isRemoving}
          onClick={onConfirm}
        >
          {translate(
            isRemoving
              ? "calendar.video.removing"
              : "calendar.video.confirmRemove",
          )}
        </button>
        <button
          type="button"
          className="admin-secondary"
          disabled={isRemoving}
          onClick={onKeep}
        >
          {translate("calendar.video.keep")}
        </button>
      </div>
    </div>
  );
}

/** Guardar y quitar, con lo que cada uno deja en el bloque. */
function useSessionVideoSteps({
  eventId,
  videoUrl,
  onChange,
}: {
  readonly eventId: string;
  readonly videoUrl: string | null;
  readonly onChange: (url: string | null) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "viewing", focus: "none" });
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  async function save(draft: string): Promise<void> {
    const parsed = parseSessionVideoUrl(draft);
    if (parsed.kind === "invalid") {
      setStep({ kind: "editing", draft, issue: parsed.issue, isSaving: false });
      return;
    }
    setStep({ kind: "editing", draft, issue: null, isSaving: true });
    const saved = await saveSessionVideo(eventId, parsed.url);
    if (saved.kind === "failed") {
      const issue = readSessionVideoIssue(saved) ?? "save_failed";
      setStep({ kind: "editing", draft, issue, isSaving: false });
      return;
    }
    onChange(saved.url);
    setAnnouncement("calendar.video.saved");
    setStep({ kind: "viewing", focus: "watch" });
  }

  async function remove(): Promise<void> {
    setStep({ kind: "confirming", isRemoving: true, hasFailed: false });
    const removal = await removeSessionVideo(eventId);
    if (removal.kind === "failed") {
      setStep({ kind: "confirming", isRemoving: false, hasFailed: true });
      return;
    }
    onChange(null);
    setAnnouncement("calendar.video.removed");
    setStep({ kind: "viewing", focus: "edit" });
  }

  return {
    step,
    announcement,
    startEditing: () => {
      setAnnouncement(null);
      setStep({
        kind: "editing",
        draft: videoUrl ?? "",
        issue: null,
        isSaving: false,
      });
    },
    editDraft: (draft: string) =>
      setStep({ kind: "editing", draft, issue: null, isSaving: false }),
    stopEditing: () => setStep({ kind: "viewing", focus: "edit" }),
    askToRemove: () => {
      setAnnouncement(null);
      setStep({ kind: "confirming", isRemoving: false, hasFailed: false });
    },
    keep: () => setStep({ kind: "viewing", focus: "remove" }),
    save: (draft: string) => void save(draft),
    remove: () => void remove(),
  };
}

export function EventSessionVideo({
  translate,
  eventId,
  videoUrl,
  canEdit,
  isCancelled,
  onChange,
}: {
  readonly translate: Translator;
  readonly eventId: string;
  readonly videoUrl: string | null;
  /** Si quien mira es Admin, Committee o Coach. Sólo decide qué se pinta:
   * el endpoint ya rechaza a un Player. */
  readonly canEdit: boolean;
  readonly isCancelled: boolean;
  readonly onChange: (url: string | null) => void;
}): React.JSX.Element | null {
  const headingId = useId();
  const steps = useSessionVideoSteps({ eventId, videoUrl, onChange });
  const { step, announcement } = steps;
  const canChange = canEdit && !isCancelled;
  const canRemove = canEdit && videoUrl !== null;
  if (videoUrl === null && !canChange && announcement === null) {
    return null;
  }
  return (
    <section className="agenda-video" aria-labelledby={headingId}>
      <h3 id={headingId} className="agenda-panel-eyebrow">
        {translate("calendar.video.heading")}
      </h3>
      {step.kind === "viewing" ? (
        <VideoView
          translate={translate}
          videoUrl={videoUrl}
          canChange={canChange}
          canRemove={canRemove}
          focus={step.focus}
          onEdit={steps.startEditing}
          onRemove={steps.askToRemove}
        />
      ) : null}
      {step.kind === "editing" ? (
        <VideoForm
          translate={translate}
          draft={step.draft}
          issue={step.issue}
          isSaving={step.isSaving}
          onDraft={steps.editDraft}
          onSave={() => steps.save(step.draft)}
          onCancel={steps.stopEditing}
        />
      ) : null}
      {step.kind === "confirming" ? (
        <RemoveConfirmation
          translate={translate}
          isRemoving={step.isRemoving}
          hasFailed={step.hasFailed}
          onConfirm={steps.remove}
          onKeep={steps.keep}
        />
      ) : null}
      <p className="agenda-video-status" role="status">
        {announcement === null ? null : translate(announcement)}
      </p>
    </section>
  );
}
