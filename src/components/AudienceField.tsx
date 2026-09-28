import type { Group } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";

/**
 * A quién va algo: todo el club o los grupos que se marquen, de entre los
 * grupos vigentes del club (E4). "Todo el club" y "estos grupos" son dos
 * opciones y no una lista que puede quedar vacía, como en el dominio
 * (`ClubAudience`).
 *
 * Nació para publicar noticias (#330) y lo reutiliza el diálogo de eventos
 * (#313). Cada uno pone su propia leyenda: una noticia se "ve" y a un evento
 * se "invita".
 */

export type AudienceChoice = {
  readonly kind: "club" | "groups";
  readonly groupIds: ReadonlySet<string>;
};

const LEGEND_ID = "audiencia";
const GROUPS_ID = "audiencia-grupos";

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
      <legend>{translate("audience.groupsLegend")}</legend>
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

export function AudienceField({
  translate,
  legend,
  clubGroups,
  audience,
  issueText,
  onChange,
}: {
  readonly translate: Translator;
  readonly legend: string;
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
      <legend>{legend}</legend>
      <AudienceOption
        value="club"
        label={translate("audience.club")}
        isChecked={audience.kind === "club"}
        onChoose={() => onChange({ ...audience, kind: "club" })}
      />
      {clubGroups.length === 0 ? (
        <p className="auth-note">{translate("audience.noGroups")}</p>
      ) : (
        <AudienceOption
          value="groups"
          label={translate("audience.groups")}
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
