"use client";

import { useRef, useState } from "react";
import { type NamedPosition, positionName } from "@/lib/club/club-positions";
import type { CountryOption } from "@/lib/geo/countries";
import type { Group } from "@/lib/groups/groups";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import type { Locale } from "@/lib/i18n/locale";
import {
  type NewMemberField,
  type NewMemberIssue,
  type NewMemberIssueCode,
  type NewMemberSubmission,
  listNewMemberIssues,
} from "@/lib/members/member-invitation";
import { EXPERIENCE_LEVELS, GENDERS } from "@/lib/members/profile-fields";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import {
  type CreatedMemberView,
  type NewMemberFailure,
  createMember,
  describeNewMemberFailure,
  describeNewMemberIssue,
  isEmailTaken,
  readNewMemberIssueCode,
} from "./new-member-client";
import {
  GroupsField,
  SelectField,
  type SelectOption,
  TextField,
} from "./record-fields";

/**
 * El formulario del alta de un miembro (#243, FR-020): sus datos, su registro
 * AUF y sus grupos, en una sola petición.
 *
 * Marca todos los campos que faltan antes de enviar, con la misma regla que
 * el servidor. Lo que sólo sabe el servidor, como un correo que ya tiene
 * cuenta, se enseña junto a su campo cuando responde.
 */

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "sending" }
  | NewMemberFailure;

type Draft = Omit<NewMemberSubmission, "groupIds"> & {
  readonly groupIds: ReadonlySet<string>;
};

type TextDraftField = Exclude<keyof Draft, "groupIds">;

const EMPTY_DRAFT: Draft = {
  fullName: "",
  email: "",
  country: "",
  positionId: "",
  experienceLevel: "",
  gender: "",
  aufNumber: "",
  aufExpiry: "",
  groupIds: new Set(),
};

/** Los ids de los controles, que los avisos usan para describirlos. */
const FIELD_IDS: Readonly<Record<NewMemberField, string>> = {
  fullName: "alta-nombre",
  email: "alta-correo",
  country: "alta-pais",
  positionId: "alta-posicion",
  experienceLevel: "alta-nivel",
  gender: "alta-genero",
  aufNumber: "alta-auf-numero",
  aufExpiry: "alta-auf-vencimiento",
};

/** De qué campo habla cada código, para colocar el aviso que manda el
 * servidor, que sólo trae el código. */
const FIELD_OF_ISSUE: Readonly<Record<NewMemberIssueCode, NewMemberField>> = {
  full_name_missing: "fullName",
  email_malformed: "email",
  country_unknown: "country",
  position_unknown: "positionId",
  experience_level_unknown: "experienceLevel",
  gender_unknown: "gender",
  auf_number_missing: "aufNumber",
  auf_number_too_long: "aufNumber",
  auf_expiry_not_a_date: "aufExpiry",
  auf_expiry_before_joined: "aufExpiry",
};

function toSubmission(draft: Draft): NewMemberSubmission {
  return { ...draft, groupIds: [...draft.groupIds] };
}

/** Las claves se arman con el valor del catálogo, así que el compilador
 * comprueba que cada mensaje exista en los dos idiomas. */
function catalogOptions(translate: Translator): {
  readonly experienceLevels: readonly SelectOption[];
  readonly genders: readonly SelectOption[];
} {
  return {
    experienceLevels: EXPERIENCE_LEVELS.map((value) => ({
      value,
      label: translate(`level.${value}`),
    })),
    genders: GENDERS.map((value) => ({
      value,
      label: translate(`gender.${value}`),
    })),
  };
}

/** Los avisos de campo a la vista: los de antes de enviar, o el que trajo la
 * respuesta del servidor. */
function fieldIssuesOf(
  localIssues: readonly NewMemberIssue[],
  status: Status,
): readonly NewMemberIssue[] {
  if (localIssues.length > 0 || status.kind !== "failed") {
    return localIssues;
  }
  const code = readNewMemberIssueCode(status);
  return code === null ? [] : [{ field: FIELD_OF_ISSUE[code], code }];
}

function isFieldFailure(status: Status): boolean {
  return (
    status.kind === "failed" &&
    (readNewMemberIssueCode(status) !== null || isEmailTaken(status))
  );
}

function SubmitFailure({
  translate,
  status,
}: {
  translate: Translator;
  status: Status;
}): React.JSX.Element | null {
  // Un fallo de un campo ya se enseña junto a ese campo.
  if (status.kind !== "failed" || isFieldFailure(status)) {
    return null;
  }
  return (
    <p className="auth-error" role="alert">
      {describeNewMemberFailure(translate, status)}
    </p>
  );
}

type FieldProps = {
  readonly translate: Translator;
  readonly draft: Draft;
  readonly issueTextFor: (field: NewMemberField) => string | null;
  readonly onChange: (field: TextDraftField, value: string) => void;
};

/** La etiqueta de cada desplegable. La posición se manda por su id (#299),
 * pero se sigue llamando "posición". */
const SELECT_LABEL_KEYS = {
  country: "newMember.country",
  positionId: "newMember.position",
  experienceLevel: "newMember.experienceLevel",
  gender: "newMember.gender",
} as const;

function DetailsFields({
  translate,
  draft,
  issueTextFor,
  onChange,
  countries,
  positions,
}: FieldProps & {
  readonly countries: readonly CountryOption[];
  readonly positions: readonly NamedPosition[];
}): React.JSX.Element {
  const options = catalogOptions(translate);
  const select = (
    field: keyof typeof SELECT_LABEL_KEYS,
    fieldOptions: readonly SelectOption[],
  ): React.JSX.Element => (
    <SelectField
      id={FIELD_IDS[field]}
      label={translate(SELECT_LABEL_KEYS[field])}
      value={draft[field]}
      options={fieldOptions}
      placeholder={translate("newMember.choose")}
      issueText={issueTextFor(field)}
      onChange={(value) => onChange(field, value)}
    />
  );
  return (
    <section className="auth-fields" aria-labelledby="alta-datos">
      <h2 id="alta-datos">{translate("newMember.details.title")}</h2>
      <TextField
        id={FIELD_IDS.fullName}
        label={translate("newMember.fullName")}
        type="text"
        value={draft.fullName}
        issueText={issueTextFor("fullName")}
        onChange={(value) => onChange("fullName", value)}
      />
      <TextField
        id={FIELD_IDS.email}
        label={translate("newMember.email")}
        type="email"
        value={draft.email}
        issueText={issueTextFor("email")}
        onChange={(value) => onChange("email", value)}
      />
      {select(
        "country",
        countries.map(({ code, name }) => ({ value: code, label: name })),
      )}
      {/* Si el club no ofrece ninguna, no hay qué elegir: nace sin posición. */}
      {positions.length === 0
        ? null
        : select(
            "positionId",
            positions.map(({ id, names }) => ({
              value: id,
              label: positionName(names, translate.locale),
            })),
          )}
      {select("experienceLevel", options.experienceLevels)}
      {select("gender", options.genders)}
    </section>
  );
}

function AufFields({
  translate,
  draft,
  issueTextFor,
  onChange,
}: FieldProps): React.JSX.Element {
  return (
    <section className="auth-fields" aria-labelledby="alta-auf">
      <h2 id="alta-auf">{translate("newMember.auf.title")}</h2>
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
    </section>
  );
}

export function NewMemberForm({
  locale,
  countries,
  clubGroups,
  positions,
  onCreated,
}: {
  locale: Locale;
  countries: readonly CountryOption[];
  clubGroups: readonly Group[];
  /** Las activas del club, en su orden (#299). */
  positions: readonly NamedPosition[];
  onCreated: (created: CreatedMemberView) => void;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [status, setStatus] = useState<Status>({ kind: "editing" });
  const [localIssues, setLocalIssues] = useState<readonly NewMemberIssue[]>([]);
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isSendingRef = useRef(false);

  function update(change: Partial<Draft>): void {
    setDraft((current) => ({ ...current, ...change }));
    setLocalIssues([]);
    // Un aviso habla del envío anterior. Mientras se envía no se toca, o el
    // botón volvería a activarse.
    setStatus((current) =>
      current.kind === "sending" ? current : { kind: "editing" },
    );
  }

  function toggleGroup(groupId: string, isChosen: boolean): void {
    const groupIds = new Set(draft.groupIds);
    if (isChosen) {
      groupIds.add(groupId);
    } else {
      groupIds.delete(groupId);
    }
    update({ groupIds });
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (isSendingRef.current) {
      return;
    }
    const submission = toSubmission(draft);
    const issues = listNewMemberIssues(submission, {
      todayInClub: clubCalendarDate(new Date()),
      positionChoices: positions,
    });
    if (issues.length > 0) {
      setLocalIssues(issues);
      return;
    }
    isSendingRef.current = true;
    setStatus({ kind: "sending" });
    const result = await createMember(submission);
    isSendingRef.current = false;
    if (result.kind === "failed") {
      setStatus(result);
      return;
    }
    onCreated(result.created);
  }

  const fieldIssues = fieldIssuesOf(localIssues, status);
  const issueTextFor = (field: NewMemberField): string | null => {
    const issue = fieldIssues.find((candidate) => candidate.field === field);
    if (issue !== undefined) {
      return describeNewMemberIssue(translate, issue.code);
    }
    return field === "email" && status.kind === "failed" && isEmailTaken(status)
      ? translate("newMember.error.emailTaken")
      : null;
  };
  const isSending = status.kind === "sending";
  const fieldProps: FieldProps = {
    translate,
    draft,
    issueTextFor,
    onChange: (field, value) => update({ [field]: value }),
  };

  return (
    <form
      className="auth-pending member-record-form"
      onSubmit={handleSubmit}
      noValidate
    >
      <fieldset className="member-record-fields" disabled={isSending}>
        <DetailsFields
          {...fieldProps}
          countries={countries}
          positions={positions}
        />
        <AufFields {...fieldProps} />
        <GroupsField
          translate={translate}
          clubGroups={clubGroups}
          chosen={draft.groupIds}
          onToggle={toggleGroup}
        />
      </fieldset>
      <SubmitFailure translate={translate} status={status} />
      <button type="submit" className="auth-submit" disabled={isSending}>
        {translate(isSending ? "newMember.sending" : "newMember.submit")}
      </button>
    </form>
  );
}
