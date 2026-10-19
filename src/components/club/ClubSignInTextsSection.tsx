"use client";

import { Translate } from "@phosphor-icons/react/dist/ssr/Translate";
import { useEffect, useId, useState } from "react";
import { ClubBrandMark } from "@/components/ClubBrandMark";
import { Icon } from "@/components/Icon";
import {
  type SegmentedOption,
  SegmentedChoice,
} from "@/components/SegmentedChoice";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import {
  countCharacters,
  findSignInTextsIssues,
  isSameSignInTexts,
  NO_SIGN_IN_TEXTS,
  SIGN_IN_TEXT_KINDS,
  type SignInTextField,
  type SignInTextKind,
  type SignInTexts,
  signInTextMaxLength,
} from "@/lib/club/sign-in-texts";
import { type Locale, SUPPORTED_LOCALES } from "@/lib/i18n/locale";
import { createTranslator, type Translator } from "@/lib/i18n/translator";
import type { ClubIdentity } from "./ClubSettingsList";
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
 * Se edita un idioma a la vez, con una vista previa al lado (#721, RF-4 del
 * PRD de E26). El borrador es de los dos idiomas: cambiar de uno a otro no
 * pierde nada, y guardar los manda juntos, como antes.
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

/** Las filas del párrafo de bienvenida en el handoff (#721). */
const WELCOME_ROWS = 5;

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

/** El texto que sale en la pantalla de entrar: el del club o, si no
 * escribió uno, el de la aplicación en ese idioma. */
function shownText(text: string, locale: Locale, kind: SignInTextKind): string {
  return text.trim() === ""
    ? createTranslator(locale)(FALLBACK_KEY_OF_KIND[kind])
    : text;
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
  const counterId = `${id}-contador`;
  const control = {
    id,
    value,
    lang: field.locale,
    // El texto de la aplicación en el idioma del campo, no en el de la
    // pantalla: es el que saldrá si se deja vacío.
    placeholder: shownText("", field.locale, field.kind),
    "aria-invalid": isInvalid,
    "aria-describedby": isInvalid ? `${issueId} ${counterId}` : counterId,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange(event.target.value),
  };
  return (
    <div className="auth-field">
      <div className="club-field-heading">
        <label htmlFor={id}>
          {translate(`clubSettings.signInTexts.${field.kind}`)}
        </label>
        <span
          className={
            isInvalid
              ? "club-field-counter club-field-counter-over"
              : "club-field-counter"
          }
          id={counterId}
        >
          {translate("clubSettings.signInTexts.counter", {
            count: countCharacters(value),
            max: signInTextMaxLength(field.kind),
          })}
        </span>
      </div>
      {field.kind === "tagline" ? (
        <input type="text" autoComplete="off" {...control} />
      ) : (
        <textarea rows={WELCOME_ROWS} {...control} />
      )}
      {isInvalid ? (
        <p className="auth-field-error" id={issueId}>
          {describeSignInTextTooLong(translate, field.kind)}
        </p>
      ) : null}
    </div>
  );
}

function languageOptions(translate: Translator): SegmentedOption<Locale>[] {
  return SUPPORTED_LOCALES.map((locale) => ({
    value: locale,
    label: translate(`clubSettings.signInTexts.language.${locale}`),
    icon: null,
  }));
}

function otherLanguageOf(language: Locale): Locale {
  const other = SUPPORTED_LOCALES.find((locale) => locale !== language);
  if (other === undefined) {
    throw new Error("La aplicación habla un solo idioma.");
  }
  return other;
}

/** "Español tiene su propio texto.": lo que no se ve del otro idioma. Si
 * allí hay un campo por encima del límite, se avisa: es lo que impide
 * guardar, y su aviso no está a la vista. */
function OtherLanguageNote({
  translate,
  draft,
  other,
  hasIssue,
}: {
  translate: Translator;
  draft: Draft;
  other: Locale;
  hasIssue: boolean;
}): React.JSX.Element {
  const language = translate(`clubSettings.signInTexts.language.${other}`);
  if (hasIssue) {
    return (
      <p className="club-sign-in-other-language auth-field-error" role="alert">
        <Icon glyph={Translate} />
        {translate("clubSettings.signInTexts.otherLanguage.tooLong", {
          language,
        })}
      </p>
    );
  }
  const hasOwnText = SIGN_IN_TEXT_KINDS.some(
    (kind) => draft[other][kind].trim() !== "",
  );
  return (
    <p className="club-sign-in-other-language">
      <Icon glyph={Translate} />
      {translate(
        hasOwnText
          ? "clubSettings.signInTexts.otherLanguage.own"
          : "clubSettings.signInTexts.otherLanguage.app",
        { language },
      )}
    </p>
  );
}

/** La tarjeta de la página de entrar con lo que se está escribiendo. */
function SignInPreview({
  translate,
  club,
  texts,
  language,
}: {
  translate: Translator;
  club: ClubIdentity;
  texts: Draft[Locale];
  language: Locale;
}): React.JSX.Element {
  const captionId = useId();
  return (
    <figure className="club-sign-in-preview" aria-labelledby={captionId}>
      <figcaption id={captionId}>
        {translate("clubSettings.signInTexts.preview", {
          code: language.toUpperCase(),
        })}
      </figcaption>
      <div className="club-sign-in-preview-card" lang={language}>
        <ClubBrandMark
          logoUrl={club.logoUrl}
          logoAlt={translate("club.logoAlt", { club: club.name })}
          fallback={
            <span className="auth-brand-mark" aria-hidden="true">
              {club.initials}
            </span>
          }
        />
        <p className="club-sign-in-preview-headline">
          {shownText(texts.tagline, language, "tagline")}
        </p>
        <p className="club-sign-in-preview-copy">
          {shownText(texts.welcome, language, "welcome")}
        </p>
      </div>
    </figure>
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
  club,
  texts,
  initialLanguage,
}: {
  translate: Translator;
  club: ClubIdentity;
  texts: ClubDraft<Draft>;
  initialLanguage: Locale;
}): React.JSX.Element {
  const { draft, status } = texts;
  const [language, setLanguage] = useState(initialLanguage);
  // El borrador se valida mientras se escribe (#719), los dos idiomas: el
  // que no se ve también puede impedir guardar.
  const localIssues = findSignInTextsIssues(toTexts(draft));
  const serverIssue =
    status.kind === "failed" ? readSignInTextIssueField(status) : null;
  const isInvalid = (field: SignInTextField): boolean =>
    localIssues.some((issue) => isSameField(issue, field)) ||
    (serverIssue !== null && isSameField(serverIssue, field));
  const other = otherLanguageOf(language);
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
      <div className="club-sign-in-texts">
        <div className="club-sign-in-editor">
          <div className="club-sign-in-intro">
            <p className="app-lead">
              {translate("clubSettings.signInTexts.lead")}
            </p>
            <SegmentedChoice
              label={translate("clubSettings.signInTexts.language")}
              options={languageOptions(translate)}
              selected={language}
              onChoose={setLanguage}
            />
          </div>
          {/* Mientras se guarda no se edita: lo que se escribiera ahora lo
              pisaría lo que devuelva el servidor. */}
          <fieldset className="member-record-fields" disabled={isSending}>
            {SIGN_IN_TEXT_KINDS.map((kind) => (
              <SignInTextInput
                key={`${language}-${kind}`}
                translate={translate}
                field={{ locale: language, kind }}
                value={draft[language][kind]}
                isInvalid={isInvalid({ locale: language, kind })}
                onChange={(text) => update({ locale: language, kind }, text)}
              />
            ))}
          </fieldset>
          <OtherLanguageNote
            translate={translate}
            draft={draft}
            other={other}
            hasIssue={SIGN_IN_TEXT_KINDS.some((kind) =>
              isInvalid({ locale: other, kind }),
            )}
          />
          <SaveFailure translate={translate} status={status} />
        </div>
        <SignInPreview
          translate={translate}
          club={club}
          texts={draft[language]}
          language={language}
        />
      </div>
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
  locale,
  translate,
  club,
  onHasDraftChange,
}: {
  /** El de la pantalla: el idioma de los textos con que se abre. */
  locale: Locale;
  translate: Translator;
  /** La marca de la vista previa. */
  club: ClubIdentity;
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
        <SignInTextsForm
          translate={translate}
          club={club}
          texts={texts}
          initialLanguage={locale}
        />
      ) : null}
    </section>
  );
}
