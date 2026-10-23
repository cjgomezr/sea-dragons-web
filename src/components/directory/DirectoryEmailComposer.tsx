"use client";

import { EnvelopeSimple } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  type ApiRequestFailure,
  UNRECOGNIZED_RESPONSE,
} from "@/lib/api/request-api";
import {
  DIRECTORY_EMAIL_SUBJECT_MAX_LENGTH,
  type DirectoryEmailDraft,
  type DirectoryEmailResult,
  type DraftFieldProblem,
  checkDirectoryEmailDraft,
  hasDraftProblems,
} from "@/lib/directory/directory-email-rules";
import { formatCharacterCount } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { Icon } from "@/components/Icon";
import { useIsPhone } from "@/components/use-is-phone";
import { DirectoryEmailConfirmDialog } from "./DirectoryEmailConfirmDialog";
import { DirectoryEmailFieldError } from "./DirectoryEmailFieldError";
import { DirectoryEmailFooter, ProblemSummary } from "./DirectoryEmailFooter";
import {
  DirectoryEmailMessageField,
  type EditorTab,
} from "./DirectoryEmailMessageField";
import { DirectoryEmailRecipients } from "./DirectoryEmailRecipients";
import { DirectoryEmailSent } from "./DirectoryEmailSent";
import {
  describeDirectoryEmailFailure,
  describeQuotaExceeded,
  isQuotaExceeded,
  loadDirectoryEmailQuota,
  sendDirectoryEmailRequest,
} from "./directory-email-client";
import {
  knownQuota,
  useDirectoryEmailQuota,
} from "./use-directory-email-quota";

/**
 * El correo del directorio (#501, rediseñado en E33): a quién va (la lista
 * que se estaba viendo, de la que se pueden quitar y a la que se pueden
 * añadir socios, #858), el asunto y el mensaje con formato (#859). El pie
 * dice cuántos correos quedan hoy y Enviar abre un diálogo que confirma antes
 * de mandar nada.
 *
 * Valida con la misma función que el servidor, pero quien decide es él: las
 * bajas, el rol de quien escribe y el cupo se comprueban al enviar.
 *
 * En el móvil (#860) es una ventana a pantalla completa con la × y Enviar en
 * la barra de arriba; el formulario es el mismo.
 */

/** Por debajo de 768 px el redactor es la ventana del móvil. */
export type ComposerLayout = "desktop" | "phone";

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

/** Cómo acabó un envío, antes de decidir qué se enseña. */
type Settlement =
  | { readonly kind: "sent"; readonly result: DirectoryEmailResult }
  | { readonly kind: "failed"; readonly failure: ApiRequestFailure }
  | { readonly kind: "quotaExceeded"; readonly remaining: number | null };

type SendRequest = Parameters<typeof sendDirectoryEmailRequest>[0];

const SUBJECT_ID = "correo-directorio-asunto";
const SUBJECT_ERROR_ID = "correo-directorio-asunto-error";
const EMPTY_DRAFT: DirectoryEmailDraft = { subject: "", message: "" };
const NO_PROBLEMS = { subject: null, message: null } as const;

function describeNotice(translate: Translator, notice: Notice): string {
  return notice.kind === "quotaExceeded"
    ? describeQuotaExceeded(translate, notice.remaining)
    : describeDirectoryEmailFailure(translate, notice.failure);
}

function SubjectField({
  translate,
  inputRef,
  value,
  problem,
  onChange,
}: {
  readonly translate: Translator;
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly value: string;
  readonly problem: DraftFieldProblem | null;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  const max = DIRECTORY_EMAIL_SUBJECT_MAX_LENGTH;
  return (
    <div className="directory-email-field">
      <div className="directory-email-label-row">
        <label htmlFor={SUBJECT_ID} className="directory-email-label">
          {translate("directory.email.subject")}
        </label>
        <span className="directory-email-counter">
          {translate("directory.email.counter", {
            length: formatCharacterCount(translate.locale, value.length),
            max: formatCharacterCount(translate.locale, max),
          })}
        </span>
      </div>
      <input
        ref={inputRef}
        id={SUBJECT_ID}
        type="text"
        className="directory-email-subject"
        value={value}
        placeholder={translate("directory.email.subjectPlaceholder")}
        aria-invalid={problem !== null}
        aria-describedby={problem === null ? undefined : SUBJECT_ERROR_ID}
        onChange={(event) => onChange(event.target.value)}
      />
      {problem === null ? null : (
        <DirectoryEmailFieldError id={SUBJECT_ERROR_ID}>
          {problem === "required"
            ? translate("directory.email.error.subjectRequired")
            : translate("directory.email.error.subjectTooLong", {
                max,
                length: value.length,
              })}
        </DirectoryEmailFieldError>
      )}
    </div>
  );
}

/** Con más destinatarios que correos quedan hoy no se puede enviar: dice
 * cuántos sobran. */
function OverQuotaAlert({
  translate,
  remaining,
  recipientCount,
}: {
  readonly translate: Translator;
  readonly remaining: number;
  readonly recipientCount: number;
}): React.JSX.Element {
  return (
    <p className="directory-email-warning" role="alert">
      {remaining === 0
        ? translate("directory.email.quota.overNone")
        : translate("directory.email.quota.over", { count: remaining })}{" "}
      {translate("directory.email.quota.overRemove", {
        count: recipientCount - remaining,
      })}
    </p>
  );
}

/** Manda la petición una sola vez aunque llegue un doble clic: el estado
 * desactiva el botón en el siguiente pintado, y la referencia en el acto. */
function useEmailSending(onSettled: (settlement: Settlement) => void): {
  readonly isSending: boolean;
  readonly send: (request: SendRequest) => void;
} {
  const [isSending, setIsSending] = useState(false);
  const isSendingRef = useRef(false);

  async function settle(request: SendRequest): Promise<Settlement> {
    const outcome = await sendDirectoryEmailRequest(request);
    if (outcome.kind === "sent") {
      return outcome;
    }
    if (!isQuotaExceeded(outcome)) {
      return { kind: "failed", failure: outcome };
    }
    // Cuántos caben ahora, y no los de cuando se abrió el redactor: entre
    // medias pudo enviar alguien más.
    const quota = await loadDirectoryEmailQuota();
    const remaining = quota.kind === "loaded" ? quota.quota.remaining : null;
    return { kind: "quotaExceeded", remaining };
  }

  function send(request: SendRequest): void {
    if (isSendingRef.current) {
      return;
    }
    isSendingRef.current = true;
    setIsSending(true);
    void settle(request)
      // Un fallo inesperado no puede dejar el diálogo atascado en "Enviando":
      // se explica como una respuesta que la pantalla no sabe leer.
      .catch((): Settlement => ({
        kind: "failed",
        failure: UNRECOGNIZED_RESPONSE,
      }))
      .then((settlement) => {
        isSendingRef.current = false;
        setIsSending(false);
        onSettled(settlement);
      });
  }

  return { isSending, send };
}

/** Quien lo abre desde el directorio llega al formulario, no se queda
 * arriba: el foco va al título en cuanto se pinta. */
function useFocusedTitle(): React.RefObject<HTMLHeadingElement | null> {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  return titleRef;
}

function ComposerHeader({
  translate,
  titleId,
  onClose,
}: {
  readonly translate: Translator;
  readonly titleId: string;
  readonly onClose: () => void;
}): React.JSX.Element {
  const titleRef = useFocusedTitle();

  return (
    <div className="directory-email-header">
      <span className="directory-email-header-icon" aria-hidden="true">
        <Icon glyph={EnvelopeSimple} />
      </span>
      <div className="directory-email-heading">
        <h2 id={titleId} ref={titleRef} tabIndex={-1}>
          {translate("directory.email.title")}
        </h2>
        <p>{translate("directory.email.lead")}</p>
      </div>
      <button
        type="button"
        className="directory-email-close"
        aria-label={translate("directory.email.close")}
        onClick={onClose}
      >
        <Icon glyph={X} />
      </button>
    </div>
  );
}

/** El Enviar de la barra del móvil: dice "Enviar" y se nombra con la cuenta,
 * como el del pie de escritorio. Está fuera del formulario y lo envía por su
 * id. */
function PhoneSendButton({
  translate,
  formId,
  recipientCount,
  canSend,
}: {
  readonly translate: Translator;
  readonly formId: string;
  readonly recipientCount: number;
  readonly canSend: boolean;
}): React.JSX.Element {
  return (
    <button
      type="submit"
      form={formId}
      className="auth-submit directory-email-screen-send"
      aria-label={translate("directory.email.send", { count: recipientCount })}
      disabled={!canSend}
    >
      <Icon glyph={PaperPlaneTilt} />
      {translate("directory.email.sendShort")}
    </button>
  );
}

/** El redactor del móvil: un `<dialog>` modal que ocupa la pantalla. Se
 * cierra con `close`, y no desmontándolo, para que el foco vuelva a lo que lo
 * abrió cuando lo de detrás ya no está inerte. */
function PhoneComposerScreen({
  translate,
  titleId,
  screenRef,
  sendButton,
  onClosed,
  children,
}: {
  readonly translate: Translator;
  readonly titleId: string;
  readonly screenRef: React.RefObject<HTMLDialogElement | null>;
  /** Nada cuando ya se envió: no queda formulario que enviar. */
  readonly sendButton: React.ReactNode;
  /** Ya cerrado: quien lo abrió lo desmonta. */
  readonly onClosed: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const titleRef = useFocusedTitle();

  // Antes que los efectos: el del título lleva el foco, y `showModal` lo
  // movería al primer control si fuera después.
  useLayoutEffect(() => {
    screenRef.current?.showModal();
  }, [screenRef]);

  return (
    <dialog
      ref={screenRef}
      className="directory-email-screen"
      aria-labelledby={titleId}
      // React hace subir el `close` de la confirmación, que va dentro: ése
      // sólo vuelve al formulario.
      onClose={(event) => {
        if (event.target === event.currentTarget) {
          onClosed();
        }
      }}
    >
      <div className="directory-email-screen-bar">
        <button
          type="button"
          className="directory-email-close"
          aria-label={translate("directory.email.close")}
          onClick={() => screenRef.current?.close()}
        >
          <Icon glyph={X} />
        </button>
        <h2 id={titleId} ref={titleRef} tabIndex={-1}>
          {translate("directory.email.title")}
        </h2>
        {sendButton}
      </div>
      <div className="directory-email-screen-body">
        <p className="directory-email-screen-lead">
          {translate("directory.email.lead")}
        </p>
        {children}
      </div>
    </dialog>
  );
}

/** El borrador, la pestaña del mensaje y llevar el foco al primer campo que
 * hay que arreglar. Los avisos salen al intentar enviar, no al escribir. */
function useEmailDraft(): {
  readonly draft: DirectoryEmailDraft;
  readonly setDraft: (draft: DirectoryEmailDraft) => void;
  readonly problems: ReturnType<typeof checkDirectoryEmailDraft>;
  readonly activeTab: EditorTab;
  readonly setActiveTab: (tab: EditorTab) => void;
  readonly subjectRef: React.RefObject<HTMLInputElement | null>;
  readonly messageRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Marca los errores y devuelve si el borrador vale. */
  readonly validate: () => boolean;
  readonly reset: () => void;
} {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [hasTriedToSend, setHasTriedToSend] = useState(false);
  const [activeTab, setActiveTab] = useState<EditorTab>("write");
  const subjectRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const checked = checkDirectoryEmailDraft(draft);

  function validate(): boolean {
    setHasTriedToSend(true);
    if (!hasDraftProblems(checked)) {
      return true;
    }
    // Los avisos se ven en Escribir, y el área escondida no recibe el foco:
    // se vuelve ya, antes de llevarlo.
    flushSync(() => setActiveTab("write"));
    const firstInvalid =
      checked.subject === null ? messageRef.current : subjectRef.current;
    firstInvalid?.focus();
    return false;
  }

  function reset(): void {
    setDraft(EMPTY_DRAFT);
    setHasTriedToSend(false);
    setActiveTab("write");
  }

  return {
    draft,
    setDraft,
    problems: hasTriedToSend ? checked : NO_PROBLEMS,
    activeTab,
    setActiveTab,
    subjectRef,
    messageRef,
    validate,
    reset,
  };
}

function countProblems(problems: {
  readonly subject: DraftFieldProblem | null;
  readonly message: DraftFieldProblem | null;
}): number {
  return [problems.subject, problems.message].filter(
    (problem) => problem !== null,
  ).length;
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
  const formId = useId();
  const layout: ComposerLayout = useIsPhone() ? "phone" : "desktop";
  const screenRef = useRef<HTMLDialogElement>(null);
  const [recipients, setRecipients] = useState(initialRecipients);
  const [phase, setPhase] = useState<Phase>({ kind: "editing", notice: null });
  const editor = useEmailDraft();
  const { quota, showRemaining } = useDirectoryEmailQuota();
  const { isSending, send } = useEmailSending(showSettlement);
  const known = knownQuota(quota);
  const isOverQuota = known !== null && recipients.length > known.remaining;
  const canSend = recipients.length > 0 && !isOverQuota;
  const problemCount = countProblems(editor.problems);
  // En el móvil se cierra la ventana, que avisa con `onClose` al cerrarse.
  const close = layout === "phone" ? () => screenRef.current?.close() : onClose;

  function showSettlement(settlement: Settlement): void {
    if (settlement.kind === "sent") {
      showRemaining(settlement.result.remaining);
      setPhase({ kind: "sent", result: settlement.result });
      return;
    }
    if (settlement.kind === "failed") {
      setPhase({
        kind: "editing",
        notice: { kind: "failure", failure: settlement.failure },
      });
      return;
    }
    const { remaining } = settlement;
    if (remaining !== null) {
      showRemaining(remaining);
    }
    // Si el cupo nuevo ya no los deja, el aviso del cupo lo explica.
    const isExplainedByQuota =
      remaining !== null && recipients.length > remaining;
    setPhase({
      kind: "editing",
      notice: isExplainedByQuota ? null : { kind: "quotaExceeded", remaining },
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!editor.validate() || !canSend) {
      return;
    }
    setPhase({ kind: "confirming", requestId: crypto.randomUUID() });
  }

  /** El botón que tenía el foco desaparece con el estado Enviado: el foco
   * pasa al asunto del formulario nuevo en cuanto existe. */
  function writeAnother(): void {
    flushSync(() => {
      editor.reset();
      setPhase({ kind: "editing", notice: null });
    });
    editor.subjectRef.current?.focus();
  }

  const body = (
    <>
      {phase.kind === "sent" ? (
        <DirectoryEmailSent
          translate={translate}
          result={phase.result}
          onWriteAnother={writeAnother}
          onClose={close}
        />
      ) : (
        <form
          id={formId}
          className="directory-email-form"
          onSubmit={submit}
          noValidate
        >
          <div className="directory-email-fields">
            {layout === "phone" ? (
              <ProblemSummary
                translate={translate}
                layout={layout}
                count={problemCount}
              />
            ) : null}
            <DirectoryEmailRecipients
              translate={translate}
              layout={layout}
              recipients={recipients}
              onChange={setRecipients}
            />
            <SubjectField
              translate={translate}
              inputRef={editor.subjectRef}
              value={editor.draft.subject}
              problem={editor.problems.subject}
              onChange={(subject) =>
                editor.setDraft({ ...editor.draft, subject })
              }
            />
            <DirectoryEmailMessageField
              translate={translate}
              areaRef={editor.messageRef}
              value={editor.draft.message}
              problem={editor.problems.message}
              activeTab={editor.activeTab}
              preview={{ recipients, subject: editor.draft.subject }}
              onChange={(message) =>
                editor.setDraft({ ...editor.draft, message })
              }
              onSelectTab={editor.setActiveTab}
            />
            {known !== null && isOverQuota ? (
              <OverQuotaAlert
                translate={translate}
                remaining={known.remaining}
                recipientCount={recipients.length}
              />
            ) : null}
            {phase.kind === "editing" && phase.notice !== null ? (
              <p className="auth-error" role="alert">
                {describeNotice(translate, phase.notice)}
              </p>
            ) : null}
          </div>
          <DirectoryEmailFooter
            translate={translate}
            layout={layout}
            quota={quota}
            problemCount={problemCount}
            recipientCount={recipients.length}
            canSend={canSend}
            onCancel={onClose}
          />
        </form>
      )}
      {phase.kind === "confirming" ? (
        <DirectoryEmailConfirmDialog
          translate={translate}
          recipients={recipients}
          subject={editor.draft.subject}
          quota={quota}
          isSending={isSending}
          onConfirm={() =>
            send({
              requestId: phase.requestId,
              draft: editor.draft,
              recipientIds: recipients.map((recipient) => recipient.userId),
            })
          }
          onClosed={() => {
            if (!isSending) {
              setPhase({ kind: "editing", notice: null });
            }
          }}
        />
      ) : null}
    </>
  );

  if (layout === "phone") {
    return (
      <PhoneComposerScreen
        translate={translate}
        titleId={titleId}
        screenRef={screenRef}
        sendButton={
          phase.kind === "sent" ? null : (
            <PhoneSendButton
              translate={translate}
              formId={formId}
              recipientCount={recipients.length}
              canSend={canSend}
            />
          )
        }
        onClosed={onClose}
      >
        {body}
      </PhoneComposerScreen>
    );
  }
  return (
    <section
      className="admin-section directory-email"
      aria-labelledby={titleId}
    >
      <ComposerHeader
        translate={translate}
        titleId={titleId}
        onClose={onClose}
      />
      {body}
    </section>
  );
}
