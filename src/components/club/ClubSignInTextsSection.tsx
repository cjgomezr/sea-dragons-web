"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import {
  findSignInTextsIssues,
  NO_SIGN_IN_TEXTS,
  SIGN_IN_TEXT_FIELDS,
  type SignInTextField,
  type SignInTextKind,
  type SignInTexts,
  signInTextMaxLength,
} from "@/lib/club/sign-in-texts";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator, type Translator } from "@/lib/i18n/translator";
import { describeClubSettingsFailure } from "./club-settings-client";
import {
  describeSignInTextTooLong,
  loadSignInTexts,
  readSignInTextIssueField,
  saveSignInTexts,
} from "./club-sign-in-texts-client";

/**
 * El lema y el párrafo de la pantalla de entrar, en cada idioma (#301, RF-5
 * del PRD de E18a). Cada campo vacío enseña de muestra el texto de la
 * aplicación que saldrá en su lugar, y vaciarlo es volver a él.
 *
 * Viaja con su propio botón, no con el del formulario de la identidad: es
 * otro recurso de la API, y un fallo aquí no debe perder el nombre escrito
 * arriba.
 */

type Status =
  | { readonly kind: "loading" }
  | { readonly kind: "editing" }
  | { readonly kind: "sending" }
  | { readonly kind: "saved" }
  | ({ readonly phase: "load" | "save" } & ApiRequestFailure);

type Draft = {
  readonly [L in Locale]: { readonly [K in SignInTextKind]: string };
};

/** De qué clave del catálogo sale el texto cuando el club no escribe uno. */
const FALLBACK_KEY_OF_KIND = {
  tagline: "auth.brand.headline",
  welcome: "auth.brand.copy",
} as const satisfies Record<SignInTextKind, string>;

function toDraft(texts: SignInTexts): Draft {
  const draftOf = (locale: Locale): Draft[Locale] => ({
    tagline: texts[locale].tagline ?? "",
    welcome: texts[locale].welcome ?? "",
  });
  return { en: draftOf("en"), es: draftOf("es") };
}

/** Un campo en blanco viaja como `null`: el de la aplicación. */
function toTexts(draft: Draft): SignInTexts {
  const blankAsNull = (text: string): string | null =>
    text.trim() === "" ? null : text;
  const textsOf = (locale: Locale): SignInTexts[Locale] => ({
    tagline: blankAsNull(draft[locale].tagline),
    welcome: blankAsNull(draft[locale].welcome),
  });
  return { en: textsOf("en"), es: textsOf("es") };
}

function isSameField(a: SignInTextField, b: SignInTextField): boolean {
  return a.locale === b.locale && a.kind === b.kind;
}

function SignInTextInput({
  translate,
  field,
  value,
  isInvalid,
  onChange,
}: {
  translate: Translator;
  field: SignInTextField;
  value: string;
  isInvalid: boolean;
  onChange: (text: string) => void;
}): React.JSX.Element {
  const id = `club-texto-entrada-${field.kind}-${field.locale}`;
  const issueId = `${id}-aviso`;
  const hintId = `${id}-ayuda`;
  const control = {
    id,
    value,
    // El texto de la aplicación en el idioma del campo, no en el de la
    // pantalla: es el que saldrá si se deja vacío.
    placeholder: createTranslator(field.locale)(
      FALLBACK_KEY_OF_KIND[field.kind],
    ),
    "aria-invalid": isInvalid,
    "aria-describedby": isInvalid ? `${issueId} ${hintId}` : hintId,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange(event.target.value),
  };
  return (
    <div className="auth-field">
      <label htmlFor={id}>
        {translate(`clubSettings.signInTexts.${field.kind}.${field.locale}`)}
      </label>
      {field.kind === "tagline" ? (
        <input type="text" autoComplete="off" {...control} />
      ) : (
        <textarea rows={4} {...control} />
      )}
      {isInvalid ? (
        <p className="auth-field-error" id={issueId}>
          {describeSignInTextTooLong(translate, field.kind)}
        </p>
      ) : null}
      <p className="auth-hint" id={hintId}>
        {translate("clubSettings.signInTexts.hint", {
          max: signInTextMaxLength(field.kind),
        })}
      </p>
    </div>
  );
}

function SaveOutcome({
  translate,
  status,
}: {
  translate: Translator;
  status: Status;
}): React.JSX.Element | null {
  if (status.kind === "saved") {
    return (
      <p className="auth-note" role="status">
        {translate("clubSettings.signInTexts.saved")}
      </p>
    );
  }
  // Un 400 de un campo ya se enseña junto a ese campo.
  if (status.kind !== "failed" || readSignInTextIssueField(status) !== null) {
    return null;
  }
  return (
    <p className="auth-error" role="alert">
      {describeClubSettingsFailure(translate, status)}
    </p>
  );
}

type SignInTextsEditor = {
  readonly draft: Draft;
  readonly status: Status;
  readonly localIssues: readonly SignInTextField[];
  readonly update: (field: SignInTextField, text: string) => void;
  readonly submit: () => Promise<void>;
};

/** Lee lo guardado una vez, al montar. Los setters de React no cambian, así
 * que el efecto no se repite. */
function useInitialLoad(
  setDraft: (draft: Draft) => void,
  setStatus: (status: Status) => void,
): void {
  useEffect(() => {
    let isCurrent = true;
    void loadSignInTexts().then((outcome) => {
      if (!isCurrent) {
        return;
      }
      if (outcome.kind === "failed") {
        setStatus({ ...outcome, phase: "load" });
        return;
      }
      setDraft(toDraft(outcome.texts));
      setStatus({ kind: "editing" });
    });
    return () => {
      isCurrent = false;
    };
  }, [setDraft, setStatus]);
}

function useSignInTextsEditor(): SignInTextsEditor {
  const [draft, setDraft] = useState<Draft>(() => toDraft(NO_SIGN_IN_TEXTS));
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [localIssues, setLocalIssues] = useState<readonly SignInTextField[]>(
    [],
  );
  // Un doble clic llega antes de que el estado desactive el botón.
  const isSendingRef = useRef(false);
  useInitialLoad(setDraft, setStatus);

  function update(field: SignInTextField, text: string): void {
    setDraft((current) => ({
      ...current,
      [field.locale]: { ...current[field.locale], [field.kind]: text },
    }));
    setLocalIssues([]);
    setStatus((current) =>
      current.kind === "sending" ? current : { kind: "editing" },
    );
  }

  async function submit(): Promise<void> {
    if (isSendingRef.current) {
      return;
    }
    const texts = toTexts(draft);
    const issues = findSignInTextsIssues(texts);
    if (issues.length > 0) {
      setLocalIssues(issues);
      return;
    }
    isSendingRef.current = true;
    setStatus({ kind: "sending" });
    const result = await saveSignInTexts(texts);
    isSendingRef.current = false;
    if (result.kind === "failed") {
      setStatus({ ...result, phase: "save" });
      return;
    }
    setDraft(toDraft(result.texts));
    setStatus({ kind: "saved" });
  }

  return { draft, status, localIssues, update, submit };
}

function SignInTextsForm({
  translate,
  editor: { draft, status, localIssues, update, submit },
}: {
  translate: Translator;
  editor: SignInTextsEditor;
}): React.JSX.Element {
  const serverIssue =
    status.kind === "failed" ? readSignInTextIssueField(status) : null;
  const isInvalid = (field: SignInTextField): boolean =>
    localIssues.some((issue) => isSameField(issue, field)) ||
    (serverIssue !== null && isSameField(serverIssue, field));
  const isSending = status.kind === "sending";

  return (
    <form
      className="auth-pending club-settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
    >
      {/* Mientras se guarda no se edita: lo que se escribiera ahora lo
          pisaría lo que devuelva el servidor. */}
      <fieldset className="member-record-fields" disabled={isSending}>
        {SIGN_IN_TEXT_FIELDS.map((field) => (
          <SignInTextInput
            key={`${field.locale}-${field.kind}`}
            translate={translate}
            field={field}
            value={draft[field.locale][field.kind]}
            isInvalid={isInvalid(field)}
            onChange={(text) => update(field, text)}
          />
        ))}
      </fieldset>
      <SaveOutcome translate={translate} status={status} />
      <button type="submit" className="auth-submit" disabled={isSending}>
        {translate(
          isSending
            ? "clubSettings.signInTexts.saving"
            : "clubSettings.signInTexts.save",
        )}
      </button>
    </form>
  );
}

export function ClubSignInTextsSection({
  translate,
}: {
  translate: Translator;
}): React.JSX.Element {
  const editor = useSignInTextsEditor();
  const { status } = editor;
  const hasLoadFailed = status.kind === "failed" && status.phase === "load";

  return (
    <section className="auth-fields" aria-labelledby="club-textos-entrada">
      <h2 id="club-textos-entrada">
        {translate("clubSettings.signInTexts.title")}
      </h2>
      <p className="app-lead">{translate("clubSettings.signInTexts.lead")}</p>
      {status.kind === "loading" ? (
        <p className="admin-empty">
          {translate("clubSettings.signInTexts.loading")}
        </p>
      ) : null}
      {hasLoadFailed ? (
        <p className="auth-error" role="alert">
          {describeClubSettingsFailure(translate, status)}
        </p>
      ) : null}
      {status.kind === "loading" || hasLoadFailed ? null : (
        <SignInTextsForm translate={translate} editor={editor} />
      )}
    </section>
  );
}
