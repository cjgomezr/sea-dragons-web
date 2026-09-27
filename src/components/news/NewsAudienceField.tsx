import type { Group } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";

/**
 * A quién va una publicación (#330, RF-2): todo el club o los grupos que se
 * marquen, de entre los grupos vigentes del club (E4). "Todo el club" y
 * "estos grupos" son dos opciones y no una lista que puede quedar vacía, como
 * en el dominio (`NewsAudience`).
 *
 * E7 va a necesitar lo mismo al crear un evento. Cuando llegue, este campo
 * es el que tiene que reutilizar o copiar en forma.
 */

export type AudienceChoice = {
  readonly kind: "club" | "groups";
  readonly groupIds: ReadonlySet<string>;
};

const LEGEND_ID = "publicar-audiencia";
const GROUPS_ID = "publicar-audiencia-grupos";

function AudienceOption({
  value,
  label,
  isChecked,
  onChoose,
}: {
  readonly value: AudienceChoice["kind"];
  readonly label: string;
  readonly isChecked: boolean;
  readonly onChoose: () => void;
}): React.JSX.Element {
  const id = `${LEGEND_ID}-${value}`;
  return (
    <div className="auth-consent">
      <input
        id={id}
        type="radio"
        name={LEGEND_ID}
        value={value}
        checked={isChecked}
        onChange={onChoose}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

function GroupChoices({
  translate,
  clubGroups,
  chosen,
  issueText,
  onToggle,
}: {
  readonly translate: Translator;
  readonly clubGroups: readonly Group[];
  readonly chosen: ReadonlySet<string>;
  readonly issueText: string | null;
  readonly onToggle: (groupId: string, isChosen: boolean) => void;
}): React.JSX.Element {
  const issueId = `${GROUPS_ID}-aviso`;
  return (
    <fieldset
      className="member-record-groups news-audience-groups"
      aria-describedby={issueText === null ? undefined : issueId}
      aria-invalid={issueText !== null}
    >
      <legend>{translate("news.publish.audience.groupsLegend")}</legend>
      {clubGroups.map((group) => {
        const inputId = `${GROUPS_ID}-${group.id}`;
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
      })}
      {issueText === null ? null : (
        <p className="auth-field-error" id={issueId}>
          {issueText}
        </p>
      )}
    </fieldset>
  );
}

export function NewsAudienceField({
  translate,
  clubGroups,
  audience,
  issueText,
  onChange,
}: {
  readonly translate: Translator;
  readonly clubGroups: readonly Group[];
  readonly audience: AudienceChoice;
  /** El aviso de los grupos, o null si no tiene ninguno. */
  readonly issueText: string | null;
  readonly onChange: (audience: AudienceChoice) => void;
}): React.JSX.Element {
  function toggleGroup(groupId: string, isChosen: boolean): void {
    const groupIds = new Set(audience.groupIds);
    if (isChosen) {
      groupIds.add(groupId);
    } else {
      groupIds.delete(groupId);
    }
    onChange({ ...audience, groupIds });
  }

  return (
    <fieldset className="member-record-groups news-audience">
      <legend>{translate("news.publish.audience.legend")}</legend>
      <AudienceOption
        value="club"
        label={translate("news.publish.audience.club")}
        isChecked={audience.kind === "club"}
        onChoose={() => onChange({ ...audience, kind: "club" })}
      />
      {clubGroups.length === 0 ? (
        <p className="auth-note">
          {translate("news.publish.audience.noGroups")}
        </p>
      ) : (
        <AudienceOption
          value="groups"
          label={translate("news.publish.audience.groups")}
          isChecked={audience.kind === "groups"}
          onChoose={() => onChange({ ...audience, kind: "groups" })}
        />
      )}
      {audience.kind === "groups" ? (
        <GroupChoices
          translate={translate}
          clubGroups={clubGroups}
          chosen={audience.groupIds}
          issueText={issueText}
          onToggle={toggleGroup}
        />
      ) : null}
    </fieldset>
  );
}
