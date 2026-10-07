"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  type ApiRequestFailure,
  UNRECOGNIZED_RESPONSE,
} from "@/lib/api/request-api";
import {
  DIRECTORY_EMAIL_MESSAGE_MAX_LENGTH,
  DIRECTORY_EMAIL_SUBJECT_MAX_LENGTH,
  type DirectoryEmailResult,
  type DraftFieldProblem,
  checkDirectoryEmailDraft,
  hasDraftProblems,
} from "@/lib/directory/directory-email-rules";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { DirectoryEmailConfirmDialog } from "./DirectoryEmailConfirmDialog";
import {
  describeDirectoryEmailFailure,
  describeQuotaExceeded,
  isQuotaExceeded,
  loadDirectoryEmailQuota,
  sendDirectoryEmailRequest,
} from "./directory-email-client";

/**
 * El correo del directorio (#501, RF-6 del PRD de E19): a quién va (la lista
 * que se estaba viendo, de la que se pueden quitar socios), el asunto y el
 * mensaje en texto plano. Enviar abre un diálogo que confirma antes de
 * mandar nada.
 *
 * Valida con la misma función que el servidor, pero quien decide es él: las
 * bajas, el rol de quien escribe y el cupo se comprueban al enviar.
 */

export type EmailRecipient = {
  readonly userId: string;
  readonly fullName: string;
};

/** Lo que el formulario explica después de un envío que no salió. Se guarda
 * el motivo y no la frase, para que cambie de idioma con el interruptor. */
type Notice =
  | { readonly kind: "failure"; readonly failure: ApiRequestFailure }
  | { readonly kind: "quotaExceeded"; readonly remaining: number | null };

type Phase =
  | { readonly kind: "editing"; readonly notice: Notice | null }
  | { readonly kind: "confirming"; readonly requestId: string }
  | { readonly kind: "sent"; readonly result: DirectoryEmailResult };

const SUBJECT_ID = "correo-directorio-asunto";
const SUBJECT_ERROR_ID = "correo-directorio-asunto-error";
const MESSAGE_ID = "correo-directorio-mensaje";
const MESSAGE_HINT_ID = "correo-directorio-mensaje-ayuda";
const MESSAGE_ERROR_ID = "correo-directorio-mensaje-error";
const MESSAGE_ROWS = 8;

function describeProblem(
  translate: Translator,
  field: "subject" | "message",
  problem: DraftFieldProblem,
): string {
  if (field === "subject") {
    return problem === "required"
      ? translate("directory.email.error.subjectRequired")
      : translate("directory.email.error.subjectTooLong", {
          max: DIRECTORY_EMAIL_SUBJECT_MAX_LENGTH,
        });
  }
  return problem === "required"
    ? translate("directory.email.error.messageRequired")
    : translate("directory.email.error.messageTooLong", {
        max: DIRECTORY_EMAIL_MESSAGE_MAX_LENGTH,
      });
}

function describeNotice(translate: Translator, notice: Notice): string {
  return notice.kind === "quotaExceeded"
    ? describeQuotaExceeded(translate, notice.remaining)
    : describeDirectoryEmailFailure(translate, notice.failure);
}

function RecipientList({
  translate,
  recipients,
  onRemove,
}: {
  readonly translate: Translator;
  readonly recipients: readonly EmailRecipient[];
  readonly onRemove: (userId: string) => void;
}): React.JSX.Element {
  const countId = useId();
  return (
    <div className="directory-email-recipients">
      <p id={countId} className="directory-email-count">
        {translate("directory.email.recipients", { count: recipients.length })}
      </p>
      {recipients.length === 0 ? (
        <p className="auth-note">{translate("directory.email.noRecipients")}</p>
      ) : (
        <ul aria-labelledby={countId}>
          {recipients.map((recipient) => (
            <li key={recipient.userId}>
              <span>{recipient.fullName}</span>
              <button
                type="button"
                className="admin-secondary"
                aria-label={translate("directory.email.remove", {
                  name: recipient.fullName,
                })}
                onClick={() => onRemove(recipient.userId)}
              >
                {translate("directory.email.removeShort")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DraftFields({
  translate,
  subject,
  message,
  problems,
  onSubjectChange,
  onMessageChange,
}: {
  readonly translate: Translator;
  readonly subject: string;
  readonly message: string;
  readonly problems: {
    readonly subject: DraftFieldProblem | null;
    readonly message: DraftFieldProblem | null;
  };
  readonly onSubjectChange: (value: string) => void;
  readonly onMessageChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <>
      <div className="auth-field">
        <label htmlFor={SUBJECT_ID}>
          {translate("directory.email.subject")}
        </label>
        <input
          id={SUBJECT_ID}
          type="text"
          value={subject}
          aria-invalid={problems.subject !== null}
          aria-describedby={
            problems.subject === null ? undefined : SUBJECT_ERROR_ID
          }
          onChange={(event) => onSubjectChange(event.target.value)}
        />
        {problems.subject === null ? null : (
          <p className="auth-field-error" id={SUBJECT_ERROR_ID}>
            {describeProblem(translate, "subject", problems.subject)}
          </p>
        )}
      </div>
      <div className="auth-field">
        <label htmlFor={MESSAGE_ID}>
          {translate("directory.email.message")}
        </label>
        <textarea
          id={MESSAGE_ID}
          rows={MESSAGE_ROWS}
          value={message}
          aria-invalid={problems.message !== null}
          aria-describedby={
            problems.message === null
              ? MESSAGE_HINT_ID
              : `${MESSAGE_HINT_ID} ${MESSAGE_ERROR_ID}`
          }
          onChange={(event) => onMessageChange(event.target.value)}
        />
        <p className="auth-hint" id={MESSAGE_HINT_ID}>
          {translate("directory.email.messageHint")}
        </p>
        {problems.message === null ? null : (
          <p className="auth-field-error" id={MESSAGE_ERROR_ID}>
            {describeProblem(translate, "message", problems.message)}
          </p>
        )}
      </div>
    </>
  );
}

function SendResult({
  translate,
  result,
}: {
  readonly translate: Translator;
  readonly result: DirectoryEmailResult;
}): React.JSX.Element {
  const failedId = useId();
  return (
    <div className="directory-email-result" role="status">
      <p>
        {translate("directory.email.result.sent", { count: result.sentCount })}
      </p>
      {result.failed.length === 0 ? null : (
        <>
          <p id={failedId}>{translate("directory.email.result.failed")}</p>
          <ul aria-labelledby={failedId}>
            {result.failed.map((recipient) => (
              <li key={recipient.userId}>{recipient.fullName}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Manda la petición una sola vez aunque llegue un doble clic: el estado
 * desactiva el botón en el siguiente pintado, y la referencia en el acto. */
function useEmailSending(onSettled: (phase: Phase) => void): {
  readonly isSending: boolean;
  readonly send: (
    request: Parameters<typeof sendDirectoryEmailRequest>[0],
  ) => void;
} {
  const [isSending, setIsSending] = useState(false);
  const isSendingRef = useRef(false);

  async function settle(
    request: Parameters<typeof sendDirectoryEmailRequest>[0],
  ): Promise<Phase> {
    const outcome = await sendDirectoryEmailRequest(request);
    if (outcome.kind === "sent") {
      return { kind: "sent", result: outcome.result };
    }
    if (!isQuotaExceeded(outcome)) {
      return { kind: "editing", notice: { kind: "failure", failure: outcome } };
    }
    // Cuántos caben ahora, y no los de cuando se abrió el diálogo: entre
    // medias pudo enviar alguien más.
    const quota = await loadDirectoryEmailQuota();
    const remaining = quota.kind === "loaded" ? quota.quota.remaining : null;
    return { kind: "editing", notice: { kind: "quotaExceeded", remaining } };
  }

  function send(
    request: Parameters<typeof sendDirectoryEmailRequest>[0],
  ): void {
    if (isSendingRef.current) {
      return;
    }
    isSendingRef.current = true;
    setIsSending(true);
    void settle(request)
      // Un fallo inesperado no puede dejar el diálogo atascado en "Mandando":
      // se explica como una respuesta que la pantalla no sabe leer.
      .catch((): Phase => ({
        kind: "editing",
        notice: { kind: "failure", failure: UNRECOGNIZED_RESPONSE },
      }))
      .then((phase) => {
        isSendingRef.current = false;
        setIsSending(false);
        onSettled(phase);
      });
  }

  return { isSending, send };
}

export function DirectoryEmailComposer({
  locale,
  recipients: initialRecipients,
  onClose,
}: {
  readonly locale: Locale;
  /** La lista que se estaba viendo al abrirlo. */
  readonly recipients: readonly EmailRecipient[];
  readonly onClose: () => void;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [recipients, setRecipients] = useState(initialRecipients);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  // Los avisos de cada campo salen al intentar enviar, no mientras se escribe.
  const [hasTriedToSend, setHasTriedToSend] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "editing", notice: null });
  const { isSending, send } = useEmailSending(setPhase);

  // Quien lo abre desde el directorio llega al formulario, no se queda arriba.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const draft = { subject, message };
  const checked = checkDirectoryEmailDraft(draft);
  const problems = hasTriedToSend ? checked : { subject: null, message: null };

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setHasTriedToSend(true);
    if (hasDraftProblems(checked) || recipients.length === 0) {
      return;
    }
    setPhase({ kind: "confirming", requestId: crypto.randomUUID() });
  }

  function confirm(requestId: string): void {
    send({
      requestId,
      draft,
      recipientIds: recipients.map((recipient) => recipient.userId),
    });
  }

  return (
    <section
      className="admin-section directory-email"
      aria-labelledby={titleId}
    >
      <div className="directory-email-header">
        <h2 id={titleId} ref={titleRef} tabIndex={-1}>
          {translate("directory.email.title")}
        </h2>
        <button type="button" className="admin-secondary" onClick={onClose}>
          {translate("directory.email.close")}
        </button>
      </div>
      {phase.kind === "sent" ? (
        <SendResult translate={translate} result={phase.result} />
      ) : (
        <form className="directory-email-form" onSubmit={submit} noValidate>
          <p className="app-lead">{translate("directory.email.lead")}</p>
          <RecipientList
            translate={translate}
            recipients={recipients}
            onRemove={(userId) =>
              setRecipients((current) =>
                current.filter((recipient) => recipient.userId !== userId),
              )
            }
          />
          <DraftFields
            translate={translate}
            subject={subject}
            message={message}
            problems={problems}
            onSubjectChange={setSubject}
            onMessageChange={setMessage}
          />
          {phase.kind === "editing" && phase.notice !== null ? (
            <p className="auth-error" role="alert">
              {describeNotice(translate, phase.notice)}
            </p>
          ) : null}
          <div className="directory-email-actions">
            <button
              type="submit"
              className="auth-submit"
              disabled={recipients.length === 0}
            >
              {translate("directory.email.send")}
            </button>
          </div>
        </form>
      )}
      {phase.kind === "confirming" ? (
        <DirectoryEmailConfirmDialog
          translate={translate}
          recipientCount={recipients.length}
          isSending={isSending}
          onConfirm={() => confirm(phase.requestId)}
          onClosed={() => {
            if (!isSending) {
              setPhase({ kind: "editing", notice: null });
            }
          }}
        />
      ) : null}
    </section>
  );
}
