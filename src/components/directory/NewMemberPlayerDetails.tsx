"use client";

import { CaretDown } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { Lock } from "@phosphor-icons/react/dist/ssr/Lock";
import { useId } from "react";
import { Icon } from "@/components/Icon";
import { type NamedPosition, positionName } from "@/lib/club/club-positions";
import type { CountryOption } from "@/lib/geo/countries";
import type { Translator } from "@/lib/i18n/translator";
import type { NewMemberField } from "@/lib/members/member-invitation";
import { EXPERIENCE_LEVELS, GENDERS } from "@/lib/members/profile-fields";
import {
  FIELD_IDS,
  PLAYER_DETAIL_FIELDS,
  issueIdOf,
} from "./new-member-issues";
import { SelectField, type SelectOption, TextField } from "./record-fields";

/**
 * "Datos de jugador · opcional" del panel de invitar (#862, RF-9 del PRD de
 * E33): país, posición, género, experiencia y AUF. Sale plegado, porque sólo
 * el nombre y el correo son obligatorios (#861) y el socio rellena el resto
 * al entrar. La cabecera dice cuántos hay rellenos, o cuántos por arreglar.
 */

type PlayerDetailField = (typeof PLAYER_DETAIL_FIELDS)[number];

export type PlayerDetailsDraft = Readonly<Record<PlayerDetailField, string>>;

type FieldsProps = {
  readonly translate: Translator;
  readonly draft: PlayerDetailsDraft;
  readonly issueTextFor: (field: NewMemberField) => string | null;
  readonly onChange: (field: PlayerDetailField, value: string) => void;
};

/** Los campos que se ven: sin posiciones activas en el club no hay qué
 * elegir, y el socio nace sin posición. */
function shownFieldsOf(
  positions: readonly NamedPosition[],
): readonly PlayerDetailField[] {
  return positions.length === 0
    ? PLAYER_DETAIL_FIELDS.filter((field) => field !== "positionId")
    : PLAYER_DETAIL_FIELDS;
}

function GenderField({
  translate,
  draft,
  issueTextFor,
  onChange,
}: FieldsProps): React.JSX.Element {
  const id = FIELD_IDS.gender;
  const hintId = `${id}-privado`;
  const issueText = issueTextFor("gender");
  const describedBy =
    issueText === null ? hintId : `${issueIdOf("gender")} ${hintId}`;
  return (
    <div className="auth-field">
      <div className="invite-label-row">
        <label htmlFor={id}>{translate("newMember.gender")}</label>
        <span className="invite-private" id={hintId}>
          <Icon glyph={Lock} />
          {translate("newMember.gender.private")}
        </span>
      </div>
      <select
        id={id}
        value={draft.gender}
        aria-invalid={issueText !== null}
        aria-describedby={describedBy}
        onChange={(event) => onChange("gender", event.target.value)}
      >
        <option value="">{translate("newMember.choose")}</option>
        {GENDERS.map((gender) => (
          <option key={gender} value={gender}>
            {translate(`gender.${gender}`)}
          </option>
        ))}
      </select>
      {issueText === null ? null : (
        <p className="auth-field-error" id={issueIdOf("gender")}>
          {issueText}
        </p>
      )}
    </div>
  );
}

/** Tres segmentos que se desmarcan al volver a pulsar el elegido: el nivel
 * es opcional, y sin esto no habría cómo dejarlo vacío otra vez. */
function ExperienceField({
  translate,
  draft,
  issueTextFor,
  onChange,
}: FieldsProps): React.JSX.Element {
  const labelId = useId();
  const issueText = issueTextFor("experienceLevel");
  return (
    <div className="auth-field">
      <span className="invite-field-label" id={labelId}>
        {translate("newMember.experienceLevel")}
      </span>
      <div
        className="invite-segments"
        role="radiogroup"
        aria-labelledby={labelId}
        aria-invalid={issueText !== null}
        aria-describedby={
          issueText === null ? undefined : issueIdOf("experienceLevel")
        }
      >
        {EXPERIENCE_LEVELS.map((level, index) => (
          <label className="invite-segment" key={level}>
            <input
              id={index === 0 ? FIELD_IDS.experienceLevel : undefined}
              type="radio"
              name={FIELD_IDS.experienceLevel}
              value={level}
              checked={draft.experienceLevel === level}
              onChange={() => onChange("experienceLevel", level)}
              onClick={() => {
                if (draft.experienceLevel === level) {
                  onChange("experienceLevel", "");
                }
              }}
            />
            <span>{translate(`level.${level}`)}</span>
          </label>
        ))}
      </div>
      {issueText === null ? null : (
        <p className="auth-field-error" id={issueIdOf("experienceLevel")}>
          {issueText}
        </p>
      )}
    </div>
  );
}

function AufFields({
  translate,
  draft,
  issueTextFor,
  onChange,
}: FieldsProps): React.JSX.Element {
  return (
    <fieldset className="invite-auf">
      <legend>{translate("newMember.auf.title")}</legend>
      <p className="invite-auf-hint">{translate("newMember.auf.hint")}</p>
      <div className="invite-pair">
        <TextField
          id={FIELD_IDS.aufNumber}
          label={translate("newMember.auf.number")}
          type="text"
          value={draft.aufNumber}
          issueText={issueTextFor("aufNumber")}
          onChange={(value) => onChange("aufNumber", value)}
        />
        <TextField
          id={FIELD_IDS.aufExpiry}
          label={translate("newMember.auf.expiry")}
          type="date"
          value={draft.aufExpiry}
          issueText={issueTextFor("aufExpiry")}
          onChange={(value) => onChange("aufExpiry", value)}
        />
      </div>
    </fieldset>
  );
}

function DetailsFields({
  countries,
  positions,
  ...props
}: FieldsProps & {
  readonly countries: readonly CountryOption[];
  readonly positions: readonly NamedPosition[];
}): React.JSX.Element {
  const { translate, draft, issueTextFor, onChange } = props;
  const select = (
    field: "country" | "positionId",
    options: readonly SelectOption[],
  ): React.JSX.Element => (
    <SelectField
      id={FIELD_IDS[field]}
      label={translate(
        field === "country" ? "newMember.country" : "newMember.position",
      )}
      value={draft[field]}
      options={options}
      placeholder={translate(
        field === "country"
          ? "newMember.countryPlaceholder"
          : "newMember.choose",
      )}
      issueText={issueTextFor(field)}
      onChange={(value) => onChange(field, value)}
    />
  );
  return (
    <>
      <div className="invite-selects">
        {select(
          "country",
          countries.map(({ code, name }) => ({ value: code, label: name })),
        )}
        {positions.length === 0
          ? null
          : select(
              "positionId",
              positions.map(({ id, names }) => ({
                value: id,
                label: positionName(names, translate.locale),
              })),
            )}
        <GenderField {...props} />
      </div>
      <ExperienceField {...props} />
      <AufFields {...props} />
    </>
  );
}

export function NewMemberPlayerDetails({
  firstName,
  isOpen,
  onToggle,
  countries,
  positions,
  ...fieldsProps
}: FieldsProps & {
  /** Null mientras no se ha escrito el nombre. */
  readonly firstName: string | null;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  /** La lista entera, ya ordenada en el idioma de la pantalla. */
  readonly countries: readonly CountryOption[];
  /** Las activas del club, en su orden (#299). */
  readonly positions: readonly NamedPosition[];
}): React.JSX.Element {
  const { translate, draft, issueTextFor } = fieldsProps;
  const regionId = useId();
  const shownFields = shownFieldsOf(positions);
  const toFixCount = shownFields.filter(
    (field) => issueTextFor(field) !== null,
  ).length;
  const filledCount = shownFields.filter((field) => draft[field] !== "").length;
  return (
    <div className="invite-details">
      <button
        type="button"
        className="invite-details-toggle"
        aria-expanded={isOpen}
        aria-controls={regionId}
        onClick={onToggle}
      >
        <span className="invite-details-caret">
          <Icon glyph={isOpen ? CaretDown : CaretRight} />
        </span>
        <span className="invite-details-heading">
          <span className="invite-details-title">
            {translate("newMember.details.title")}
          </span>
          <span className="invite-details-lead">
            {firstName === null
              ? translate("newMember.details.leadUnnamed")
              : translate("newMember.details.leadNamed", { name: firstName })}
          </span>
        </span>
        <span
          className={
            toFixCount > 0
              ? "invite-details-badge invite-details-badge-danger"
              : "invite-details-badge"
          }
        >
          {toFixCount > 0
            ? translate("newMember.details.toFix", { count: toFixCount })
            : translate("newMember.details.filled", {
                filled: filledCount,
                total: shownFields.length,
              })}
        </span>
      </button>
      <div className="invite-details-body" id={regionId} hidden={!isOpen}>
        <DetailsFields
          {...fieldsProps}
          countries={countries}
          positions={positions}
        />
      </div>
    </div>
  );
}
