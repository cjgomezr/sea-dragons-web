import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { Icon } from "@/components/Icon";
import { MemberAvatar } from "@/components/MemberAvatar";
import { positionName } from "@/lib/club/club-positions";
import { formatClubShortDay, formatOverallRating } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { ScreenRosterEntry } from "./evaluations-client";
import type { EvaluationsLayout } from "./evaluations-layout";

/**
 * La tabla de jugadores de Evaluaciones (#818, RF-2 del PRD de E31): cada
 * fila es un botón con el avatar, el nombre y la posición, el OVR y cuándo se
 * actualizó, o que está sin evaluar. Recibe la lista ya filtrada y ordenada;
 * el pie dice cuántos enseña de cuántos y cómo se calcula el OVR (D3).
 *
 * La cabecera de columnas es sólo para la vista: cada fila ya lleva escrito
 * para el lector de pantalla qué es cada dato.
 *
 * En el móvil (#822) no hay columnas: la fila lleva el nombre en hasta dos
 * líneas, debajo "posición · fecha" (o Sin evaluar), el OVR y una flecha.
 */

/** Lo que mide el avatar de cada fila; `.evaluation-row-avatar` dice igual. */
const ROW_AVATAR_SIZE: Readonly<Record<EvaluationsLayout, number>> = {
  desktop: 36,
  compact: 40,
};

/** El id del botón de cada miembro: la ficha devuelve el foco ahí al volver. */
export function rosterButtonId(userId: string): string {
  return `evaluation-member-${userId}`;
}

function RowOverall({
  translate,
  member,
}: {
  translate: Translator;
  member: ScreenRosterEntry;
}): React.JSX.Element {
  // Sin evaluación y sin ninguna categoría son dos casos distintos, pero
  // ninguno tiene nota: los dos llevan la raya de vacío.
  const overall = member.status === "evaluated" ? member.overall : null;
  if (overall === null) {
    return (
      <span className="evaluation-row-overall" data-empty="true">
        <span aria-hidden="true">—</span>
        <span className="visually-hidden">
          {translate("evaluations.table.noOverall")}
        </span>
      </span>
    );
  }
  return (
    <span className="evaluation-row-overall">
      <span className="visually-hidden">
        {translate("evaluations.table.overall")}{" "}
      </span>
      {formatOverallRating(translate.locale, overall)}
    </span>
  );
}

function RowUpdated({
  translate,
  member,
}: {
  translate: Translator;
  member: ScreenRosterEntry;
}): React.JSX.Element {
  if (member.status === "not_evaluated") {
    return (
      <span className="evaluation-row-updated" data-pending="true">
        {translate("evaluations.list.notEvaluated")}
      </span>
    );
  }
  return (
    <span className="evaluation-row-updated">
      <span className="visually-hidden">
        {translate("evaluations.table.updatedOn")}{" "}
      </span>
      {formatClubShortDay(translate.locale, new Date(member.updatedAt))}
    </span>
  );
}

function RowPosition({
  translate,
  member,
}: {
  translate: Translator;
  member: ScreenRosterEntry;
}): React.JSX.Element | null {
  return member.position === null ? null : (
    <span className="evaluation-row-position">
      {positionName(member.position.names, translate.locale)}
    </span>
  );
}

/** Escritorio: nombre y posición, OVR y fecha en sus columnas. */
function DesktopRowCells({
  translate,
  member,
}: {
  translate: Translator;
  member: ScreenRosterEntry;
}): React.JSX.Element {
  return (
    <>
      <span className="evaluation-row-identity">
        <span className="evaluation-row-name">{member.fullName}</span>
        <RowPosition translate={translate} member={member} />
      </span>
      <RowOverall translate={translate} member={member} />
      <RowUpdated translate={translate} member={member} />
    </>
  );
}

/** Móvil: la fecha va con la posición, bajo el nombre. */
function CompactRowCells({
  translate,
  member,
}: {
  translate: Translator;
  member: ScreenRosterEntry;
}): React.JSX.Element {
  return (
    <>
      <span className="evaluation-row-identity">
        <span className="evaluation-row-name">{member.fullName}</span>
        <span className="evaluation-row-detail">
          <RowPosition translate={translate} member={member} />
          {member.position === null ? null : " · "}
          <RowUpdated translate={translate} member={member} />
        </span>
      </span>
      <RowOverall translate={translate} member={member} />
      <span className="evaluation-row-caret">
        <Icon glyph={CaretRight} />
      </span>
    </>
  );
}

function RosterRow({
  translate,
  member,
  isSelected,
  layout,
  onSelect,
}: {
  translate: Translator;
  member: ScreenRosterEntry;
  isSelected: boolean;
  layout: EvaluationsLayout;
  onSelect: (userId: string) => void;
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        id={rosterButtonId(member.userId)}
        className="evaluation-row"
        aria-current={isSelected ? "true" : undefined}
        onClick={() => onSelect(member.userId)}
      >
        <MemberAvatar
          fullName={member.fullName}
          photoUrl={member.photoUrl}
          size={ROW_AVATAR_SIZE[layout]}
          className="evaluation-row-avatar"
        />
        {layout === "compact" ? (
          <CompactRowCells translate={translate} member={member} />
        ) : (
          <DesktopRowCells translate={translate} member={member} />
        )}
      </button>
    </li>
  );
}

function NoMatches({
  translate,
  onClearFilters,
}: {
  translate: Translator;
  onClearFilters: () => void;
}): React.JSX.Element {
  return (
    <div className="evaluation-table-empty">
      <p>{translate("evaluations.table.noMatches")}</p>
      <button
        type="button"
        className="evaluation-table-clear"
        onClick={onClearFilters}
      >
        {translate("evaluations.table.clearFilters")}
      </button>
    </div>
  );
}

export function EvaluationRoster({
  translate,
  members,
  totalCount,
  selectedId,
  layout,
  onSelect,
  onClearFilters,
}: {
  translate: Translator;
  /** Los que pasan los filtros, en el orden elegido. */
  members: readonly ScreenRosterEntry[];
  /** Todos los de la plantilla, para el pie. */
  totalCount: number;
  selectedId: string | null;
  layout: EvaluationsLayout;
  onSelect: (userId: string) => void;
  onClearFilters: () => void;
}): React.JSX.Element {
  return (
    <div className="evaluation-table">
      <div className="evaluation-table-head" aria-hidden="true">
        <span />
        <span>{translate("evaluations.table.player")}</span>
        <span>{translate("evaluations.table.overall")}</span>
        <span>{translate("evaluations.table.updated")}</span>
      </div>
      {members.length === 0 ? (
        <NoMatches translate={translate} onClearFilters={onClearFilters} />
      ) : (
        <ul
          className="evaluation-table-rows"
          aria-label={translate("evaluations.table.label")}
        >
          {members.map((member) => (
            <RosterRow
              key={member.userId}
              translate={translate}
              member={member}
              isSelected={member.userId === selectedId}
              layout={layout}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
      <div className="evaluation-table-foot">
        <span>
          {translate("evaluations.table.count", {
            shown: members.length,
            total: totalCount,
          })}
        </span>
        <span>{translate("evaluations.table.overallRule")}</span>
      </div>
    </div>
  );
}
