"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import { positionShortName } from "@/lib/club/club-positions";
import {
  POSITION_SHORT_NAME_MAX_LENGTH,
  type PositionNamesInput,
  findPositionNameIssues,
} from "@/lib/club/manage-club-positions";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import {
  type PositionFormIssueCode,
  describePositionIssue,
  describePositionsFailure,
  readPositionIssueCode,
} from "./club-positions-admin-client";

/**
 * Los nombres de una posición, uno por idioma (#300), en una fila de la
 * tabla de posiciones (#723): el mismo formulario para la fila de añadir y
 * para renombrar en la fila. Valida lo que puede sin el servidor, y lo que
 * sólo sabe el servidor (el nombre repetido) lo pone junto al campo de su
 * idioma.
 *
 * Al renombrar, cada nombre lleva al lado su abreviatura (#887, D6 del PRD
 * de E34): la de las fichas de los equipos. Vacía, el campo sugiere la que
 * se usará, que sale del nombre.
 *
 * El formulario no tiene caja propia (`display: contents`): sus celdas son
 * celdas de la fila. Lo que va detrás de los nombres (el mínimo, la pista,
 * los botones) lo pone quien lo usa.
 *
 * Un fallo que no es de un campo, como uno de red, se queda aquí con todo lo
 * escrito: reintentar es volver a pulsar el botón.
 *
 * En el móvil (#724) es también el de la hoja de una posición, con las
 * etiquetas a la vista, y el de añadir, con un solo campo: el del idioma de
 * la pantalla.
 */

/** Qué pasó con lo que se mandó. `done` vacía el formulario (al crear) o lo
 * cierra (al renombrar). `null` es que había otra acción en vuelo. */
export type PositionFormOutcome =
  { readonly kind: "done" } | ApiRequestFailure | null;

type Texts = { readonly [L in Locale]: string };

type Draft = {
  readonly names: Texts;
  readonly shortNames: Texts;
};

type Field = "name" | "shortName";

type IssueField = { readonly field: Field; readonly locale: Locale };

const FIELD_OF_ISSUE: Readonly<Record<PositionFormIssueCode, IssueField>> = {
  // Sin ningún nombre, el aviso va en el primer campo: es por donde se empieza.
  name_required: { field: "name", locale: "en" },
  name_en_too_long: { field: "name", locale: "en" },
  name_en_taken: { field: "name", locale: "en" },
  name_es_too_long: { field: "name", locale: "es" },
  name_es_taken: { field: "name", locale: "es" },
  short_name_en_too_long: { field: "shortName", locale: "en" },
  short_name_en_without_name: { field: "shortName", locale: "en" },
  short_name_es_too_long: { field: "shortName", locale: "es" },
  short_name_es_without_name: { field: "shortName", locale: "es" },
};

const SHORT_NAME_WITHOUT_NAME_ISSUE: Readonly<
  Record<Locale, PositionFormIssueCode>
> = {
  en: "short_name_en_without_name",
  es: "short_name_es_without_name",
};

const LOCALES = ["en", "es"] as const satisfies readonly Locale[];

const NO_TEXTS: PositionNamesInput = { en: null, es: null };

function toTexts(values: PositionNamesInput): Texts {
  return { en: values.en ?? "", es: values.es ?? "" };
}

/** Un campo en blanco viaja como `null`, que es "sin nombre en ese idioma". */
function toValues(texts: Texts): PositionNamesInput {
  const blankAsNull = (text: string): string | null =>
    text.trim() === "" ? null : text.trim();
  return { en: blankAsNull(texts.en), es: blankAsNull(texts.es) };
}

function hasAnyName(names: Texts): boolean {
  return LOCALES.some((locale) => names[locale].trim() !== "");
}

/** Lo que se ve sin pedírselo al servidor: los nombres, y una abreviatura en
 * un idioma que se queda sin nombre. */
function findLocalIssue(
  names: PositionNamesInput,
  shortNames: PositionNamesInput,
): PositionFormIssueCode | null {
  const [nameIssue] = findPositionNameIssues(names);
  if (nameIssue !== undefined) {
    return nameIssue.code;
  }
  const orphan = LOCALES.find(
    (locale) => shortNames[locale] !== null && names[locale] === null,
  );
  return orphan === undefined ? null : SHORT_NAME_WITHOUT_NAME_ISSUE[orphan];
}

/** La que se usará si el campo se queda vacío; sin ningún nombre, ninguna. */
function suggestedShortName(names: Texts, locale: Locale): string {
  if (!hasAnyName(names)) {
    return "";
  }
  return positionShortName(
    { names: toValues(names), shortNames: NO_TEXTS },
    locale,
  ).text;
}

/** En la fila de la tabla la etiqueta no cabe y se lee, no se ve; en la hoja
 * del móvil se ve. Si la que se ve es más corta que la que se lee, ésta va
 * en `accessibleLabel`. */
function TextField({
  id,
  label,
  visibleLabel,
  accessibleLabel,
  placeholder,
  value,
  maxLength,
  hintId,
  issueText,
  className,
  onChange,
}: {
  id: string;
  label: string;
  visibleLabel: string | null;
  accessibleLabel?: string;
  placeholder: string;
  value: string;
  maxLength?: number;
  hintId?: string;
  issueText: string | null;
  className: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const issueId = `${id}-aviso`;
  const describedBy = [issueText === null ? null : issueId, hintId ?? null]
    .filter((describer) => describer !== null)
    .join(" ");
  return (
    <div className={className}>
      <label
        className={
          visibleLabel === null
            ? "visually-hidden"
            : "club-positions-name-label"
        }
        htmlFor={id}
      >
        {visibleLabel ?? label}
      </label>
      <input
        id={id}
        className="club-positions-input"
        type="text"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        aria-label={accessibleLabel}
        aria-invalid={issueText !== null}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
      {issueText === null ? null : (
        <p className="auth-field-error" id={issueId}>
          {issueText}
        </p>
      )}
    </div>
  );
}

export function PositionNamesForm({
  translate,
  formLabel,
  placeholders,
  initialNames,
  initialShortNames,
  isDisabled,
  shouldFocusOnOpen = false,
  locales = LOCALES,
  visibleLabels,
  onSubmit,
  children,
}: {
  translate: Translator;
  /** El nombre accesible del formulario. */
  formLabel: string;
  placeholders: Readonly<Record<Locale, string>>;
  initialNames: PositionNamesInput;
  /** Con ellas, cada nombre lleva al lado el campo de su abreviatura. */
  initialShortNames?: PositionNamesInput;
  /** Hay una acción en vuelo, sea esta o cualquier otra de la sección. */
  isDisabled: boolean;
  /** Al abrir el de renombrar, el foco va al primer campo. */
  shouldFocusOnOpen?: boolean;
  /** Los idiomas que tienen campo; el de un idioma sin campo viaja vacío. */
  locales?: readonly [Locale, ...Locale[]];
  /** Con ellas, las etiquetas se ven, y son estas en vez de las de siempre. */
  visibleLabels?: Readonly<Record<Locale, string>>;
  /** Sin campos de abreviatura, las abreviaturas viajan como llegaron. */
  onSubmit: (
    names: PositionNamesInput,
    shortNames: PositionNamesInput,
  ) => Promise<PositionFormOutcome>;
  /** Las celdas que siguen a los nombres; saben si hay alguno escrito. */
  children: (hasName: boolean) => React.ReactNode;
}): React.JSX.Element {
  const idPrefix = useId();
  const shortNameHintId = `${idPrefix}-abreviatura`;
  const formRef = useRef<HTMLFormElement>(null);
  const toDraft = (): Draft => ({
    names: toTexts(initialNames),
    shortNames: toTexts(initialShortNames ?? NO_TEXTS),
  });
  const [draft, setDraft] = useState<Draft>(toDraft);
  const [issueCode, setIssueCode] = useState<PositionFormIssueCode | null>(
    null,
  );
  const [failure, setFailure] = useState<ApiRequestFailure | null>(null);
  const hasShortNames = initialShortNames !== undefined;

  useEffect(() => {
    if (shouldFocusOnOpen) {
      formRef.current?.querySelector("input")?.focus();
    }
  }, [shouldFocusOnOpen]);

  function update(field: Field, locale: Locale, text: string): void {
    const key = field === "name" ? "names" : "shortNames";
    setDraft((current) => ({
      ...current,
      [key]: { ...current[key], [locale]: text },
    }));
    setIssueCode(null);
    setFailure(null);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const names = toValues(draft.names);
    const shortNames = toValues(draft.shortNames);
    const localIssue = findLocalIssue(names, shortNames);
    if (localIssue !== null) {
      setIssueCode(localIssue);
      return;
    }
    const outcome = await onSubmit(names, shortNames);
    if (outcome === null) {
      return;
    }
    if (outcome.kind === "done") {
      setDraft(toDraft());
      setIssueCode(null);
      setFailure(null);
      return;
    }
    const code = readPositionIssueCode(outcome);
    setIssueCode(code);
    setFailure(code === null ? outcome : null);
  }

  /** Si el campo de un aviso no está, el aviso va en el primero que hay. */
  const fieldOfIssue = (code: PositionFormIssueCode): IssueField => {
    const issueField = FIELD_OF_ISSUE[code];
    return locales.includes(issueField.locale)
      ? issueField
      : { field: "name", locale: locales[0] };
  };

  const issueTextFor = (field: Field, locale: Locale): string | null => {
    if (issueCode === null) {
      return null;
    }
    const issueField = fieldOfIssue(issueCode);
    return issueField.field === field && issueField.locale === locale
      ? describePositionIssue(translate, issueCode)
      : null;
  };

  function renderShortNameField(locale: Locale): React.JSX.Element {
    const label = translate(`clubSettings.positions.shortName.${locale}`);
    const isLabelVisible = visibleLabels !== undefined;
    return (
      <TextField
        id={`${idPrefix}-${locale}-abreviatura`}
        className="club-positions-short-field"
        label={label}
        visibleLabel={
          isLabelVisible
            ? translate("clubSettings.positions.shortName.visible")
            : null
        }
        accessibleLabel={isLabelVisible ? label : undefined}
        placeholder={suggestedShortName(draft.names, locale)}
        value={draft.shortNames[locale]}
        maxLength={POSITION_SHORT_NAME_MAX_LENGTH}
        hintId={shortNameHintId}
        issueText={issueTextFor("shortName", locale)}
        onChange={(text) => update("shortName", locale, text)}
      />
    );
  }

  function renderLocaleFields(locale: Locale): React.JSX.Element {
    const nameField = (
      <TextField
        id={`${idPrefix}-${locale}`}
        className="club-positions-name-field"
        label={
          visibleLabels?.[locale] ??
          translate(`clubSettings.positions.name.${locale}`)
        }
        visibleLabel={visibleLabels?.[locale] ?? null}
        placeholder={placeholders[locale]}
        value={draft.names[locale]}
        issueText={issueTextFor("name", locale)}
        onChange={(text) => update("name", locale, text)}
      />
    );
    if (!hasShortNames) {
      return <Fragment key={locale}>{nameField}</Fragment>;
    }
    return (
      <div key={locale} className="club-positions-locale-fields">
        {nameField}
        {renderShortNameField(locale)}
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      className="club-positions-form"
      aria-label={formLabel}
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <div className="club-positions-cell club-positions-names-cell">
        <fieldset className="club-positions-fields" disabled={isDisabled}>
          {locales.map(renderLocaleFields)}
        </fieldset>
        {hasShortNames ? (
          <p className="club-positions-short-hint" id={shortNameHintId}>
            {translate("clubSettings.positions.shortName.hint", {
              max: POSITION_SHORT_NAME_MAX_LENGTH,
            })}
          </p>
        ) : null}
        {failure === null ? null : (
          <p className="auth-error" role="alert">
            {describePositionsFailure(translate, failure)}
          </p>
        )}
      </div>
      {children(hasAnyName(draft.names))}
    </form>
  );
}
