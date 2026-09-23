import type { Group } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Los campos que comparten la ficha reservada al Admin (#242) y el alta de un
 * miembro (#243): un texto o un desplegable con su aviso, y la lista de
 * grupos del club.
 */

export type SelectOption = { readonly value: string; readonly label: string };

/** Un desplegable obligatorio: empieza en una opción vacía que pide elegir, y
 * su aviso va junto a él. */
export function SelectField({
  id,
  label,
  value,
  options,
  placeholder,
  issueText,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly SelectOption[];
  placeholder: string;
  issueText: string | null;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const issueId = `${id}-aviso`;
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        aria-invalid={issueText !== null}
        aria-describedby={issueText === null ? undefined : issueId}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {issueText === null ? null : (
        <p className="auth-field-error" id={issueId}>
          {issueText}
        </p>
      )}
    </div>
  );
}

export function TextField({
  id,
  label,
  type,
  value,
  issueText,
  hintIds = [],
  onChange,
}: {
  id: string;
  label: string;
  type: "text" | "email" | "date";
  value: string;
  /** El aviso de este campo, o null si no tiene ninguno. */
  issueText: string | null;
  /** Los textos que lo describen además del aviso, en el orden en que se
   * leen. */
  hintIds?: readonly string[];
  onChange: (value: string) => void;
}): React.JSX.Element {
  const issueId = `${id}-aviso`;
  const describedBy = [
    ...(issueText === null ? [] : [issueId]),
    ...hintIds,
  ].join(" ");
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete="off"
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

export function GroupsField({
  translate,
  clubGroups,
  chosen,
  onToggle,
}: {
  translate: Translator;
  clubGroups: readonly Group[];
  chosen: ReadonlySet<string>;
  onToggle: (groupId: string, isChosen: boolean) => void;
}): React.JSX.Element {
  return (
    <fieldset className="member-record-groups">
      <legend>{translate("memberRecord.groups.legend")}</legend>
      {clubGroups.length === 0 ? (
        <p className="admin-empty">{translate("memberRecord.groups.empty")}</p>
      ) : (
        clubGroups.map((group) => {
          const inputId = `ficha-grupo-${group.id}`;
          return (
            <div className="auth-consent" key={group.id}>
              <input
                id={inputId}
                type="checkbox"
                checked={chosen.has(group.id)}
                onChange={(event) => onToggle(group.id, event.target.checked)}
              />
              <label htmlFor={inputId}>{group.name}</label>
            </div>
          );
        })
      )}
    </fieldset>
  );
}
