"use client";

import { useEffect, useState } from "react";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import {
  findSignInTextsIssues,
  isSameSignInTexts,
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
import { SavedNotice, UnsavedChangesBar } from "./ClubUnsavedChangesBar";
import {
  type ClubDraft,
  type ClubDraftStatus,
  type DraftSaveOutcome,
  useClubDraft,
} from "./use-club-draft";

/**
 * El lema y el párrafo de la pantalla de entrar, en cada idioma (#301, RF-5
 * del PRD de E18a). Cada campo vacío enseña de muestra el texto de la
 * aplicación que saldrá en su lugar, y vaciarlo es volver a él.
 *
 * Se guarda con la barra de cambios sin guardar de la sección (#719), no
 * con la de General: es otro recurso de la API, y un fallo aquí no debe
 * perder el nombre escrito allí.
 */

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded" }
  | ApiRequestFailure;

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

function isSameDraft(draft: Draft, saved: Draft): boolean {
  return isSameSignInTexts(toTexts(draft), toTexts(saved));
}

async function sendTexts(draft: Draft): Promise<DraftSaveOutcome<Draft>> {
  const result = await saveSignInTexts(toTexts(draft));
  return result.kind === "failed"
    ? result
    : { kind: "saved", value: toDraft(result.texts) };
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

function SaveFailure({
  translate,
  status,
}: {
  translate: Translator;
  status: ClubDraftStatus;
}): React.JSX.Element | null {
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

/** Lee lo guardado una vez, al montar, y lo da por guardado en el
 * borrador. `replaceSaved` no cambia, así que el efecto no se repite. */
function useInitialLoad(replaceSaved: (draft: Draft) => void): LoadState {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  useEffect(() => {
    let isCurrent = true;
    void loadSignInTexts().then((outcome) => {
      if (!isCurrent) {
        return;
      }
      if (outcome.kind === "failed") {
        setLoad(outcome);
        return;
      }
      replaceSaved(toDraft(outcome.texts));
      setLoad({ kind: "loaded" });
    });
    return () => {
      isCurrent = false;
    };
  }, [replaceSaved]);
  return load;
}

function SignInTextsForm({
  translate,
  texts,
}: {
  translate: Translator;
  texts: ClubDraft<Draft>;
}): React.JSX.Element {
  const { draft, status } = texts;
  // El borrador se valida mientras se escribe (#719).
  const localIssues = findSignInTextsIssues(toTexts(draft));
  const serverIssue =
    status.kind === "failed" ? readSignInTextIssueField(status) : null;
  const isInvalid = (field: SignInTextField): boolean =>
    localIssues.some((issue) => isSameField(issue, field)) ||
    (serverIssue !== null && isSameField(serverIssue, field));
  const isSending = status.kind === "sending";
  const update = (field: SignInTextField, text: string): void =>
    texts.change((current) => ({
      ...current,
      [field.locale]: { ...current[field.locale], [field.kind]: text },
    }));

  return (
    <form
      className="auth-pending club-settings-form"
      onSubmit={(event) => event.preventDefault()}
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
      <SaveFailure translate={translate} status={status} />
      {texts.hasDraft ? (
        <UnsavedChangesBar
          translate={translate}
          section="sign-in"
          headingId="club-textos-entrada"
          canSave={localIssues.length === 0}
          isSaving={isSending}
          onDiscard={texts.discard}
          onSave={() => void texts.save()}
        />
      ) : null}
      <SavedNotice
        translate={translate}
        isShowing={texts.isSavedNoticeShowing}
      />
    </form>
  );
}

export function ClubSignInTextsSection({
  translate,
  onHasDraftChange,
}: {
  translate: Translator;
  onHasDraftChange: (hasDraft: boolean) => void;
}): React.JSX.Element {
  const texts = useClubDraft<Draft>({
    initial: toDraft(NO_SIGN_IN_TEXTS),
    isSame: isSameDraft,
    send: sendTexts,
    onHasDraftChange,
  });
  const load = useInitialLoad(texts.replaceSaved);

  return (
    <section className="auth-fields" aria-labelledby="club-textos-entrada">
      <h2 id="club-textos-entrada" tabIndex={-1}>
        {translate("clubSettings.signInTexts.title")}
      </h2>
      <p className="app-lead">{translate("clubSettings.signInTexts.lead")}</p>
      {load.kind === "loading" ? (
        <p className="admin-empty">
          {translate("clubSettings.signInTexts.loading")}
        </p>
      ) : null}
      {load.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeClubSettingsFailure(translate, load)}
        </p>
      ) : null}
      {load.kind === "loaded" ? (
        <SignInTextsForm translate={translate} texts={texts} />
      ) : null}
    </section>
  );
}
