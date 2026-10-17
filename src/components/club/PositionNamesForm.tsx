"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import {
  type PositionIssueCode,
  type PositionNamesInput,
  findPositionNameIssues,
} from "@/lib/club/manage-club-positions";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import {
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
 * El formulario no tiene caja propia (`display: contents`): sus celdas son
 * celdas de la fila. Lo que va detrás de los nombres (el rol, la pista, los
 * botones) lo pone quien lo usa.
 *
 * Un fallo que no es de un campo, como uno de red, se queda aquí con todo lo
 * escrito: reintentar es volver a pulsar el botón.
 */

/** Qué pasó con lo que se mandó. `done` vacía el formulario (al crear) o lo
 * cierra (al renombrar). `null` es que había otra acción en vuelo. */
export type PositionFormOutcome =
  { readonly kind: "done" } | ApiRequestFailure | null;

type Draft = { readonly [L in Locale]: string };

const FIELD_OF_ISSUE: Readonly<Record<PositionIssueCode, Locale>> = {
  // Sin ningún nombre, el aviso va en el primer campo: es por donde se empieza.
  name_required: "en",
  name_en_too_long: "en",
  name_en_taken: "en",
  name_es_too_long: "es",
  name_es_taken: "es",
};

const LOCALES = ["en", "es"] as const satisfies readonly Locale[];

function toDraft(names: PositionNamesInput): Draft {
  return { en: names.en ?? "", es: names.es ?? "" };
}

/** Un campo en blanco viaja como `null`, que es "sin nombre en ese idioma". */
function toNames(draft: Draft): PositionNamesInput {
  const blankAsNull = (name: string): string | null =>
    name.trim() === "" ? null : name.trim();
  return { en: blankAsNull(draft.en), es: blankAsNull(draft.es) };
}

function hasAnyName(draft: Draft): boolean {
  return LOCALES.some((locale) => draft[locale].trim() !== "");
}

/** Un nombre de 32 px: la etiqueta no cabe en la fila y se lee, no se ve. */
function NameField({
  id,
  label,
  placeholder,
  value,
  issueText,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  issueText: string | null;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const issueId = `${id}-aviso`;
  return (
    <div className="club-positions-name-field">
      <label className="visually-hidden" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="club-positions-input"
        type="text"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={issueText !== null}
        aria-describedby={issueText === null ? undefined : issueId}
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
  isDisabled,
  shouldFocusOnOpen = false,
  onSubmit,
  children,
}: {
  translate: Translator;
  /** El nombre accesible del formulario. */
  formLabel: string;
  placeholders: Readonly<Record<Locale, string>>;
  initialNames: PositionNamesInput;
  /** Hay una acción en vuelo, sea esta o cualquier otra de la sección. */
  isDisabled: boolean;
  /** Al abrir el de renombrar, el foco va al primer campo. */
  shouldFocusOnOpen?: boolean;
  onSubmit: (names: PositionNamesInput) => Promise<PositionFormOutcome>;
  /** Las celdas que siguen a los nombres; saben si hay alguno escrito. */
  children: (hasName: boolean) => React.ReactNode;
}): React.JSX.Element {
  const idPrefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initialNames));
  const [issueCode, setIssueCode] = useState<PositionIssueCode | null>(null);
  const [failure, setFailure] = useState<ApiRequestFailure | null>(null);

  useEffect(() => {
    if (shouldFocusOnOpen) {
      formRef.current?.querySelector("input")?.focus();
    }
  }, [shouldFocusOnOpen]);

  function update(locale: Locale, name: string): void {
    setDraft((current) => ({ ...current, [locale]: name }));
    setIssueCode(null);
    setFailure(null);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const names = toNames(draft);
    const [localIssue] = findPositionNameIssues(names);
    if (localIssue !== undefined) {
      setIssueCode(localIssue.code);
      return;
    }
    const outcome = await onSubmit(names);
    if (outcome === null) {
      return;
    }
    if (outcome.kind === "done") {
      setDraft(toDraft(initialNames));
      setIssueCode(null);
      setFailure(null);
      return;
    }
    const code = readPositionIssueCode(outcome);
    setIssueCode(code);
    setFailure(code === null ? outcome : null);
  }

  const issueTextFor = (locale: Locale): string | null =>
    issueCode !== null && FIELD_OF_ISSUE[issueCode] === locale
      ? describePositionIssue(translate, issueCode)
      : null;

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
          {LOCALES.map((locale) => (
            <NameField
              key={locale}
              id={`${idPrefix}-${locale}`}
              label={translate(`clubSettings.positions.name.${locale}`)}
              placeholder={placeholders[locale]}
              value={draft[locale]}
              issueText={issueTextFor(locale)}
              onChange={(name) => update(locale, name)}
            />
          ))}
        </fieldset>
        {failure === null ? null : (
          <p className="auth-error" role="alert">
            {describePositionsFailure(translate, failure)}
          </p>
        )}
      </div>
      {children(hasAnyName(draft))}
    </form>
  );
}
