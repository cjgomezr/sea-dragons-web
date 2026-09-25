import {
  type AuditActor,
  type AuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import { isLocale, type Locale, SUPPORTED_LOCALES } from "@/lib/i18n/locale";
import { type ClubSettingsGateways, findAdministrator } from "./club-settings";

/**
 * Los textos del inicio de sesión que escribe el club (#301, RF-5 del PRD de
 * E18a): el lema y el párrafo de bienvenida del panel de marca, uno por
 * idioma. Son las filas de `club_sign_in_texts`, el mismo reparto por idioma
 * que los nombres de las posiciones (D2).
 *
 * A diferencia de una posición, un idioma sin texto no toma el del otro: la
 * pantalla cae al catálogo de la aplicación, que sí habla ese idioma.
 */

/** Los límites de `0028_club_sign_in_texts.sql`. */
export const SIGN_IN_TAGLINE_MAX_LENGTH = 140;
export const SIGN_IN_WELCOME_MAX_LENGTH = 320;

export const SIGN_IN_TEXT_KINDS = ["tagline", "welcome"] as const;

/** `tagline` es el lema; `welcome`, el párrafo de bienvenida. */
export type SignInTextKind = (typeof SIGN_IN_TEXT_KINDS)[number];

const MAX_LENGTH_OF_KIND: Readonly<Record<SignInTextKind, number>> = {
  tagline: SIGN_IN_TAGLINE_MAX_LENGTH,
  welcome: SIGN_IN_WELCOME_MAX_LENGTH,
};

export function signInTextMaxLength(kind: SignInTextKind): number {
  return MAX_LENGTH_OF_KIND[kind];
}

/** Un campo de la pantalla: su idioma y si es el lema o el párrafo. */
export type SignInTextField = {
  readonly locale: Locale;
  readonly kind: SignInTextKind;
};

/** Todos los campos, idioma por idioma: el orden en que se enseñan. */
export const SIGN_IN_TEXT_FIELDS: readonly SignInTextField[] =
  SUPPORTED_LOCALES.flatMap((locale) =>
    SIGN_IN_TEXT_KINDS.map((kind) => ({ locale, kind })),
  );

/** Sin texto es `null`, nunca la cadena vacía. */
export type SignInTextsInLocale = {
  readonly [Kind in SignInTextKind]: string | null;
};

export type SignInTexts = { readonly [L in Locale]: SignInTextsInLocale };

export const NO_SIGN_IN_TEXTS: SignInTexts = {
  en: { tagline: null, welcome: null },
  es: { tagline: null, welcome: null },
};

/** El texto del club en ese idioma, o `null` si ahí sale el de la
 * aplicación. */
export function clubSignInText(
  texts: SignInTexts,
  locale: Locale,
  kind: SignInTextKind,
): string | null {
  return texts[locale][kind];
}

/** Una fila de `club_sign_in_texts`. */
export type SignInTextRow = {
  readonly locale: string;
  readonly tagline: string | null;
  readonly welcome: string | null;
};

/** Un idioma sin fila no tiene textos del club. Un idioma que la aplicación
 * no habla es una fila que `club_sign_in_texts_locale_check` no dejaría
 * existir: se falla en vez de ignorarla. */
export function toSignInTexts(rows: readonly SignInTextRow[]): SignInTexts {
  return rows.reduce<SignInTexts>((texts, { locale, tagline, welcome }) => {
    if (!isLocale(locale)) {
      throw new Error(
        `Textos del inicio de sesión en un idioma que no hay: ${locale}.`,
      );
    }
    return { ...texts, [locale]: { tagline, welcome } };
  }, NO_SIGN_IN_TEXTS);
}

export type SignInTextsIssueCode = `${SignInTextKind}_too_long`;

export type SignInTextsIssue = SignInTextField & {
  readonly code: SignInTextsIssueCode;
};

export type SignInTextsGateways = {
  readonly members: ClubSettingsGateways["members"];
  readonly signInTexts: {
    findSignInTexts(clubId: string): Promise<SignInTexts>;
    /** Deja los dos idiomas como `texts`, en una sola escritura. */
    replaceSignInTexts(
      clubId: string,
      texts: SignInTexts,
    ): Promise<SignInTexts>;
  };
  readonly audit: AuditLogWriter;
};

export class SignInTextsValidationError extends Error {
  readonly issues: readonly SignInTextsIssue[];

  constructor(issues: readonly SignInTextsIssue[]) {
    super(
      `Los textos del inicio de sesión se pasan del límite: ${issues
        .map((issue) => `${issue.locale}.${issue.kind}`)
        .join(", ")}.`,
    );
    this.name = "SignInTextsValidationError";
    this.issues = issues;
  }
}

/** Como `char_length` de Postgres: un emoji es un carácter, no dos. */
function countCharacters(text: string): number {
  return [...text].length;
}

function normalizeText(text: string | null): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** Sin los espacios de los extremos, y vacío como ninguno: así lo guarda la
 * base, y así vuelve el texto de la aplicación. */
export function normalizeSignInTexts(texts: SignInTexts): SignInTexts {
  const normalizeLocale = (locale: Locale): SignInTextsInLocale => ({
    tagline: normalizeText(texts[locale].tagline),
    welcome: normalizeText(texts[locale].welcome),
  });
  return { en: normalizeLocale("en"), es: normalizeLocale("es") };
}

export function findSignInTextsIssues(
  texts: SignInTexts,
): readonly SignInTextsIssue[] {
  const normalized = normalizeSignInTexts(texts);
  return SIGN_IN_TEXT_FIELDS.filter(({ locale, kind }) => {
    const text = normalized[locale][kind];
    return text !== null && countCharacters(text) > MAX_LENGTH_OF_KIND[kind];
  }).map(({ locale, kind }) => ({ locale, kind, code: `${kind}_too_long` }));
}

/** `en.tagline`, `es.welcome`: lo que la bitácora nombra, sin el valor. */
function changedFields(
  texts: SignInTexts,
  stored: SignInTexts,
): readonly string[] {
  return SIGN_IN_TEXT_FIELDS.filter(
    ({ locale, kind }) => texts[locale][kind] !== stored[locale][kind],
  ).map(({ locale, kind }) => `${locale}.${kind}`);
}

function recordTextsChanged(
  audit: AuditLogWriter,
  actor: AuditActor,
  fields: readonly string[],
): Promise<void> {
  return recordAuditEvent(audit, {
    actor,
    clubId: actor.clubId,
    action: "club.sign_in_texts_changed",
    entityType: "club",
    entityId: actor.clubId,
    result: "success",
    metadata: { fields },
  });
}

export async function readSignInTexts(
  gateways: SignInTextsGateways,
  request: { readonly callerId: string },
): Promise<SignInTexts> {
  const caller = await findAdministrator(gateways, request.callerId);
  return gateways.signInTexts.findSignInTexts(caller.clubId);
}

/**
 * Valida antes de leer nada y anota después de escribir, como la identidad
 * del club. Sin comprobación de conflicto: los cuatro textos viajan juntos y
 * el último Admin que guarda deja los suyos, que es lo que ve en pantalla.
 */
export async function updateSignInTexts(
  gateways: SignInTextsGateways,
  request: { readonly callerId: string; readonly texts: SignInTexts },
): Promise<SignInTexts> {
  const issues = findSignInTextsIssues(request.texts);
  if (issues.length > 0) {
    throw new SignInTextsValidationError(issues);
  }
  const caller = await findAdministrator(gateways, request.callerId);
  const texts = normalizeSignInTexts(request.texts);
  const stored = await gateways.signInTexts.findSignInTexts(caller.clubId);
  const fields = changedFields(texts, stored);
  if (fields.length === 0) {
    return stored;
  }
  const saved = await gateways.signInTexts.replaceSignInTexts(
    caller.clubId,
    texts,
  );
  await recordTextsChanged(
    gateways.audit,
    { id: request.callerId, clubId: caller.clubId },
    fields,
  );
  return saved;
}
