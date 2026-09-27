import type { EvaluationRosterEntry } from "@/lib/evaluations/evaluation-roster";
import { formatOverallRating } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { matchesNameSearch } from "@/lib/text/name-search";

/**
 * La lista de la pantalla de Evaluaciones (#322): cada miembro con su OVR, o
 * marcado sin evaluar, y la búsqueda por nombre. Filtra aquí y no en el
 * servidor porque la lista llega entera: el club tiene decenas de miembros.
 */

const SEARCH_FIELD_ID = "evaluations-search";
const LIST_HEADING_ID = "evaluations-members";

/** El id del botón de cada miembro: la ficha devuelve el foco ahí al volver. */
export function rosterButtonId(userId: string): string {
  return `evaluation-member-${userId}`;
}

function RosterMark({
  translate,
  member,
}: {
  translate: Translator;
  member: EvaluationRosterEntry;
}): React.JSX.Element {
  if (member.status === "not_evaluated") {
    return (
      <span className="evaluation-roster-pending">
        {translate("evaluations.list.notEvaluated")}
      </span>
    );
  }
  const rating =
    member.overallRating === null
      ? translate("evaluations.overall.noData")
      : formatOverallRating(translate.locale, member.overallRating);
  return (
    <span className="evaluation-roster-ovr">
      {translate("evaluations.list.overall", { rating })}
    </span>
  );
}

function RosterMembers({
  translate,
  members,
  selectedId,
  onSelect,
}: {
  translate: Translator;
  members: readonly EvaluationRosterEntry[];
  selectedId: string | null;
  onSelect: (userId: string) => void;
}): React.JSX.Element {
  return (
    <ul className="evaluation-roster-list" aria-labelledby={LIST_HEADING_ID}>
      {members.map((member) => (
        <li key={member.userId}>
          <button
            type="button"
            id={rosterButtonId(member.userId)}
            className="evaluation-roster-member"
            aria-current={member.userId === selectedId ? "true" : undefined}
            onClick={() => onSelect(member.userId)}
          >
            <span className="evaluation-roster-name">{member.fullName}</span>
            <RosterMark translate={translate} member={member} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function EvaluationRoster({
  translate,
  members,
  search,
  onSearchChange,
  selectedId,
  onSelect,
}: {
  translate: Translator;
  members: readonly EvaluationRosterEntry[];
  search: string;
  onSearchChange: (search: string) => void;
  selectedId: string | null;
  onSelect: (userId: string) => void;
}): React.JSX.Element {
  const visible = members.filter((member) =>
    matchesNameSearch(member.fullName, search.trim()),
  );
  return (
    <section className="evaluation-roster" aria-labelledby={LIST_HEADING_ID}>
      <h2 id={LIST_HEADING_ID}>{translate("evaluations.list.title")}</h2>
      {members.length === 0 ? (
        <p className="admin-empty">{translate("evaluations.list.empty")}</p>
      ) : (
        <>
          <div className="auth-field">
            <label htmlFor={SEARCH_FIELD_ID}>
              {translate("evaluations.search.label")}
            </label>
            <input
              id={SEARCH_FIELD_ID}
              type="search"
              value={search}
              placeholder={translate("evaluations.search.placeholder")}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </div>
          {visible.length === 0 ? (
            <p className="admin-empty">
              {translate("evaluations.list.noMatches")}
            </p>
          ) : (
            <RosterMembers
              translate={translate}
              members={visible}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          )}
        </>
      )}
    </section>
  );
}
