"use client";

import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { MemberAvatar } from "@/components/MemberAvatar";
import { describeAttendance } from "@/components/attendance/MemberAttendanceSummary";
import type { Role } from "@/lib/auth/roles";
import type {
  DirectoryDirection,
  DirectoryListing,
  DirectoryMember,
  DirectorySort,
  MemberContactView,
} from "@/lib/directory/directory";
import { memberRecordHref } from "@/lib/auth/routes";
import { memberEvaluationHref } from "@/lib/evaluations/member-evaluation-href";
import { formatCalendarDay } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import { DirectoryContactCell, type RowContact } from "./DirectoryContactCell";
import {
  type DirectoryOrder,
  DirectorySortControl,
  SORT_ARROWS,
  SORT_COLUMN_LABELS,
} from "./DirectorySortControl";
import {
  describeCountry,
  describeExperienceLevel,
  describePosition,
} from "./member-labels";
import { type StatusDot, statusDotsOf } from "./status-dots";

/**
 * La lista del directorio (FR-015, FR-019), compacta desde el rediseño de
 * E21 (#549, RF-3): una fila por socio con su foto o sus iniciales (#245), su
 * nombre, su país y su nivel, su rol, su posición y su asistencia (#396), y
 * cabeceras que piden el orden. Medidas: "List column" de
 * `docs/design/directorio-admin/README.md`.
 *
 * La fila no cambia el rol: pulsarla la selecciona y abre su ficha rápida en
 * el panel lateral (#550), que es donde el Admin lo cambia. Lo que un Admin
 * ve de más son puntos de estado (el AUF y la membresía) y, bajo el rol, el
 * que el socio pidió. El resto de la ficha reservada está a un clic, en el
 * nombre (#242).
 *
 * Del OVR, el directorio sólo cuenta a Admin y Coach quién está sin evaluar
 * (#324): la nota se ve en Evaluaciones, y a un Player o un Committee no le
 * llega nada (FR-055).
 *
 * Ordenar es cosa del servidor, así que pulsar una cabecera no reordena nada
 * aquí: dice por dónde, y la pantalla vuelve a preguntar.
 *
 * Por debajo de 768px la misma tabla se pinta como la lista del móvil del
 * rediseño (#553, "2b"), sin cabeceras: el avatar, el nombre con sus puntos,
 * "Rol · Posición" debajo, la asistencia y, en la fila que abre la ficha, una
 * flecha. El orden se elige con `DirectorySortControl`. Es el mismo marcado
 * en los dos anchos para que el servidor no tenga que adivinar cuál pintar,
 * y para que las filas sigan siendo filas para un lector de pantalla.
 *
 * Quien ve el contacto de los socios (#499) tiene además una columna
 * "Contacto" al final: Admin y Committee con todo, el Coach con el de
 * emergencia. La marca de la lista dice cuál, igual que con el AUF.
 */

/** El círculo de cada fila, en píxeles; `.directory-avatar` dice lo mismo. */
const DIRECTORY_AVATAR_SIZE = 32;

/** Lo que de una fila sólo recibe un Admin: sus puntos de estado y el rol
 * que el socio pidió, si pidió alguno. */
type AdminRowView = {
  readonly dots: readonly StatusDot[];
  readonly requestedRole: Role | null;
};

/** Lo que una fila necesita saber, con lo que sólo un Admin recibe ya
 * resuelto: así la fila no tiene que volver a preguntarse quién la mira. Con
 * `admin` la fila es de Admin: enlaza la ficha (#242) y enseña puntos y
 * solicitud (#549). `isEvaluated` es null para quien no ve evaluaciones
 * (#324). */
type DirectoryRow = {
  readonly member: DirectoryMember;
  readonly admin: AdminRowView | null;
  readonly isEvaluated: boolean | null;
  readonly contact: RowContact;
};

const NO_DOTS: readonly StatusDot[] = [];

/** El id de la fila de un socio: la pantalla le devuelve el foco cuando el
 * panel se cierra (#550). */
export function memberRowId(userId: string): string {
  return `directorio-fila-${userId}`;
}

/** Un clic en un enlace o un botón de la fila es suyo: no la selecciona. */
function isFromControl(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    target.closest("a, button, input, select, textarea") !== null
  );
}

/** Lo que pide la fila al pulsarla, con el teclado o el ratón: seleccionarse
 * o, si ya lo estaba, dejar de estarlo. */
type RowSelection = {
  readonly selectedUserId: string | null;
  readonly onToggle: (userId: string) => void;
};

/** Las solicitudes de rol pendientes, por socio: lo que pidió cada uno. */
export type RequestedRoles = ReadonlyMap<string, Role>;

const NO_CONTACT: RowContact = { kind: "none" };

function fullContactOf(member: MemberContactView): RowContact {
  return {
    kind: "full",
    email: member.email,
    phone: member.phone,
    emergencyContact: member.emergencyContact,
  };
}

function rowsOf(
  translate: Translator,
  listing: DirectoryListing,
  requestedRoles: RequestedRoles,
): readonly DirectoryRow[] {
  switch (listing.kind) {
    case "admin":
      return listing.members.map((member) => ({
        member,
        admin: {
          dots: statusDotsOf(translate, member),
          requestedRole: requestedRoles.get(member.userId) ?? null,
        },
        isEvaluated: member.isEvaluated,
        contact: fullContactOf(member),
      }));
    case "committee":
      return listing.members.map((member) => ({
        admin: null,
        member,
        isEvaluated: null,
        contact: fullContactOf(member),
      }));
    case "coach":
      return listing.members.map((member) => ({
        admin: null,
        member,
        isEvaluated: member.isEvaluated,
        contact: {
          kind: "emergency",
          emergencyContact: member.emergencyContact,
        },
      }));
    case "member":
      return listing.members.map((member) => ({
        admin: null,
        member,
        isEvaluated: null,
        contact: NO_CONTACT,
      }));
  }
}

/** A un dado de baja no se le marca: no se le puede crear evaluación (RF-1)
 * y Evaluaciones no lo lista. */
function needsEvaluation(row: DirectoryRow): boolean {
  return row.isEvaluated === false && row.member.status !== "inactive";
}

const ARIA_SORT: Readonly<
  Record<DirectoryDirection, "ascending" | "descending">
> = {
  asc: "ascending",
  desc: "descending",
};

/** La cabecera que no cabe en su columna de 64px se abrevia; su nombre
 * accesible sigue siendo el entero. */
const SHORT_COLUMN_LABELS: Readonly<
  Partial<Record<DirectorySort, "directory.column.attendanceShort">>
> = { attendance: "directory.column.attendanceShort" };

const SORTABLE_COLUMNS: readonly DirectorySort[] = [
  "name",
  "role",
  "position",
  "attendance",
];

function SortableHeader({
  translate,
  column,
  order,
  onSort,
}: {
  translate: Translator;
  column: DirectorySort;
  order: DirectoryOrder;
  onSort: (column: DirectorySort) => void;
}): React.JSX.Element {
  const isSorted = order.sort === column;
  const label = translate(SORT_COLUMN_LABELS[column]);
  const shortLabelKey = SHORT_COLUMN_LABELS[column];
  // El nombre entero va en la cabecera y en su botón: la cabecera no lo
  // toma del `aria-label` del botón en todos los lectores.
  const fullLabel = shortLabelKey === undefined ? undefined : label;
  return (
    <th
      scope="col"
      className={`directory-column-${column}`}
      aria-label={fullLabel}
      aria-sort={isSorted ? ARIA_SORT[order.direction] : "none"}
    >
      <button
        type="button"
        className="directory-sort"
        aria-label={fullLabel}
        onClick={() => onSort(column)}
      >
        {shortLabelKey === undefined ? label : translate(shortLabelKey)}
        <span className="directory-arrow" aria-hidden="true">
          {isSorted ? SORT_ARROWS[order.direction] : ""}
        </span>
      </button>
    </th>
  );
}

/** Un punto por cada cosa que un Admin tiene que mirar. Se lee como imagen
 * con su texto, y el `title` lo enseña al pasar el ratón. */
function StatusDots({
  dots,
}: {
  dots: readonly StatusDot[];
}): React.JSX.Element | null {
  if (dots.length === 0) {
    return null;
  }
  return (
    <span className="directory-dots">
      {dots.map((dot) => (
        <span
          key={dot.text}
          role="img"
          aria-label={dot.text}
          title={dot.text}
          className={`directory-dot directory-dot-${dot.tone}`}
        />
      ))}
    </span>
  );
}

/** La única marca que se pulsa: lleva a crear la evaluación que falta. El
 * nombre accesible empieza por el texto visible (WCAG 2.5.3) y dice de quién
 * es. */
function NotEvaluatedMark({
  translate,
  member,
}: {
  translate: Translator;
  member: DirectoryMember;
}): React.JSX.Element {
  return (
    <Link
      href={memberEvaluationHref(member.userId)}
      className="directory-mark directory-mark-warning directory-mark-link"
      aria-label={translate("directory.mark.notEvaluatedLabel", {
        name: member.fullName,
      })}
    >
      {translate("directory.mark.notEvaluated")}
    </Link>
  );
}

/** Las píldoras que van tras el nombre: invitado (#549) y de baja
 * (AC-040). */
function StatusPills({
  translate,
  member,
}: {
  translate: Translator;
  member: DirectoryMember;
}): React.JSX.Element | null {
  if (member.invitedOn !== null) {
    return (
      <span className="directory-pill directory-pill-invited">
        {translate("directory.invited.pill")}
      </span>
    );
  }
  if (member.status === "inactive") {
    return (
      <span className="directory-pill">
        {translate("directory.mark.inactive")}
      </span>
    );
  }
  return null;
}

/** A un Admin el nombre le abre la ficha del miembro (#242). El nombre
 * accesible dice a dónde lleva y contiene el nombre visible (WCAG 2.5.3). */
function MemberName({
  translate,
  row,
}: {
  translate: Translator;
  row: DirectoryRow;
}): React.JSX.Element {
  const { member } = row;
  if (row.admin === null) {
    return <span className="directory-name">{member.fullName}</span>;
  }
  return (
    <Link
      href={memberRecordHref(member.userId)}
      className="directory-name directory-record-link"
      aria-label={translate("memberRecord.openLabel", {
        name: member.fullName,
      })}
    >
      {member.fullName}
    </Link>
  );
}

/** El país y el nivel, que en la tabla se leen juntos bajo el nombre y en la
 * tarjeta cada uno con su etiqueta. El punto que los separa en la tabla sobra
 * en la tarjeta, y la hoja de estilos lo quita. Un dato que falta sigue ahí
 * con su guion: la etiqueta nunca queda sola. */
function MemberFacts({
  translate,
  member,
}: {
  translate: Translator;
  member: DirectoryMember;
}): React.JSX.Element {
  return (
    <span className="directory-meta directory-facts">
      <span
        className="directory-fact"
        data-label={translate("directory.field.country")}
      >
        {describeCountry(translate, member.country)}
      </span>
      <span className="directory-fact-separator"> · </span>
      <span
        className="directory-fact"
        data-label={translate("directory.field.level")}
      >
        {describeExperienceLevel(translate, member.experienceLevel)}
      </span>
    </span>
  );
}

/** Bajo el nombre: el país y el nivel, o, de quien todavía no entró, cuándo
 * se le invitó. */
function MemberMeta({
  translate,
  locale,
  member,
}: {
  translate: Translator;
  locale: Locale;
  member: DirectoryMember;
}): React.JSX.Element {
  if (member.invitedOn === null) {
    return <MemberFacts translate={translate} member={member} />;
  }
  return (
    <span className="directory-meta">
      {translate("directory.invited.line", {
        date: formatCalendarDay(locale, member.invitedOn),
      })}
    </span>
  );
}

function MemberCell({
  translate,
  locale,
  row,
}: {
  translate: Translator;
  locale: Locale;
  row: DirectoryRow;
}): React.JSX.Element {
  const { member } = row;
  return (
    <th scope="row">
      {/* La caja flexible va dentro y no en la celda: un `th` que deja de
          ser `table-cell` no estira con su fila, y el contenido de la más
          alta se sale por debajo del borde. */}
      <span className="directory-member">
        <MemberAvatar
          className="directory-avatar"
          fullName={member.fullName}
          photoUrl={member.photoUrl}
          size={DIRECTORY_AVATAR_SIZE}
          viewer={{ userId: member.userId, translate }}
        />
        <span className="directory-identity">
          <span className="directory-name-line">
            <MemberName translate={translate} row={row} />
            <StatusPills translate={translate} member={member} />
            <StatusDots dots={row.admin === null ? NO_DOTS : row.admin.dots} />
            {needsEvaluation(row) ? (
              <NotEvaluatedMark translate={translate} member={member} />
            ) : null}
          </span>
          <MemberMeta translate={translate} locale={locale} member={member} />
        </span>
        {/* La flecha del móvil dice que la fila lleva a la ficha; desde 768px
            la esconde la hoja de estilos. */}
        {row.admin === null ? null : (
          <span className="directory-row-caret" aria-hidden="true">
            <Icon glyph={CaretRight} />
          </span>
        )}
      </span>
    </th>
  );
}

/** La píldora del rol que el socio pidió (#549). La flecha es para la vista:
 * un lector de pantalla oye la frase entera. */
function RequestedRolePill({
  translate,
  role,
}: {
  translate: Translator;
  role: Role;
}): React.JSX.Element {
  const roleName = translate(`role.${role}`);
  const label = translate("directory.request.label", { role: roleName });
  return (
    <span className="directory-request" title={label}>
      <span aria-hidden="true">
        {translate("directory.request.pill", { role: roleName })}
      </span>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

function RoleCell({
  translate,
  row,
}: {
  translate: Translator;
  row: DirectoryRow;
}): React.JSX.Element {
  const requestedRole = row.admin === null ? null : row.admin.requestedRole;
  return (
    <td
      className="directory-role-cell"
      data-label={translate("directory.column.role")}
    >
      <span className="directory-role-name">
        {translate(`role.${row.member.role}`)}
      </span>
      {requestedRole === null ? null : (
        <>
          {" "}
          <RequestedRolePill translate={translate} role={requestedRole} />
        </>
      )}
    </td>
  );
}

function MemberRow({
  translate,
  locale,
  row,
  selection,
}: {
  translate: Translator;
  locale: Locale;
  row: DirectoryRow;
  selection: RowSelection;
}): React.JSX.Element {
  const { member } = row;
  const isSelected = selection.selectedUserId === member.userId;

  function onKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>): void {
    if (event.target !== event.currentTarget) {
      return;
    }
    const isActivation = event.key === "Enter" || event.key === " ";
    if (isActivation || (event.key === "Escape" && isSelected)) {
      event.preventDefault();
      selection.onToggle(member.userId);
    }
  }

  return (
    // El nombre accesible de la fila se declara en vez de dejarlo calcular:
    // el nombre calculado saldría del contenido de las celdas, y ahí van el
    // país, el nivel, los puntos y el rol. Quien recorre la tabla con un
    // lector de pantalla quiere saber de quién es la fila en la que entra.
    // Se enfoca para que el teclado también abra la ficha (#550), y
    // `aria-current` dice cuál es la que el panel enseña.
    <tr
      id={memberRowId(member.userId)}
      aria-label={member.fullName}
      aria-current={isSelected ? "true" : undefined}
      tabIndex={0}
      className="directory-row"
      onClick={(event) => {
        if (!isFromControl(event.target)) {
          selection.onToggle(member.userId);
        }
      }}
      onKeyDown={onKeyDown}
    >
      <MemberCell translate={translate} locale={locale} row={row} />
      <RoleCell translate={translate} row={row} />
      <td
        className="directory-position-cell"
        data-label={translate("directory.column.position")}
      >
        <span className="directory-position">
          {describePosition(translate, member.position)}
        </span>
      </td>
      <td
        className="directory-attendance-cell"
        data-label={translate("directory.column.attendance")}
      >
        {describeAttendance(translate, locale, member.attendance)}
      </td>
      {row.contact.kind === "none" ? null : (
        <DirectoryContactCell translate={translate} contact={row.contact} />
      )}
    </tr>
  );
}

/** Qué quiere decir cada color de punto. Sólo la ve un Admin, que es quien
 * tiene puntos. */
function DotLegend({
  translate,
}: {
  translate: Translator;
}): React.JSX.Element {
  return (
    <ul
      className="directory-legend"
      aria-label={translate("directory.legend.label")}
    >
      <li>
        <span
          className="directory-dot directory-dot-danger"
          aria-hidden="true"
        />
        {translate("directory.legend.danger")}
      </li>
      <li>
        <span
          className="directory-dot directory-dot-warning"
          aria-hidden="true"
        />
        {translate("directory.legend.warning")}
      </li>
    </ul>
  );
}

/** Las clases de la tabla según lo que trae la lista: la hoja de estilos
 * reparte el ancho distinto con el contacto. */
function tableClassName(listing: DirectoryListing): string {
  return listing.kind === "member"
    ? "directory-table"
    : "directory-table directory-table-contact";
}

/** Las de la lista: con el contacto, el reparto de la tabla cambia; y en la
 * de un Admin, el móvil deja el contacto para la ficha, a la que lleva cada
 * fila (#553). */
function listClassName(listing: DirectoryListing): string {
  switch (listing.kind) {
    case "member":
      return "directory-list";
    case "admin":
      return "directory-list directory-list-contact directory-list-admin";
    case "committee":
    case "coach":
      return "directory-list directory-list-contact";
  }
}

export function DirectoryTable({
  translate,
  locale,
  listing,
  order,
  requestedRoles,
  selection,
  onSort,
}: {
  translate: Translator;
  locale: Locale;
  listing: DirectoryListing;
  order: DirectoryOrder;
  /** Las solicitudes pendientes; sólo se pintan en una lista de Admin. */
  requestedRoles: RequestedRoles;
  /** Qué fila enseña el panel lateral y qué hacer al pulsar una (#550). */
  selection: RowSelection;
  /** Lo que pide una cabecera de la tabla, o la hoja del orden en el
   * móvil: sólo el campo. */
  onSort: (column: DirectorySort) => void;
}): React.JSX.Element {
  const rows = rowsOf(translate, listing, requestedRoles);
  return (
    <div className={listClassName(listing)}>
      <DirectorySortControl
        translate={translate}
        order={order}
        onSort={onSort}
      />
      {/* La tarjeta es el div y no la tabla: un `border-radius` sobre una
          tabla no recorta las esquinas de su primera y su última fila. */}
      <div className="directory-card">
        <table className={tableClassName(listing)}>
          <caption className="directory-count">
            {translate("directory.memberCount", { count: rows.length })}
          </caption>
          <thead>
            <tr>
              {SORTABLE_COLUMNS.map((column) => (
                <SortableHeader
                  key={column}
                  translate={translate}
                  column={column}
                  order={order}
                  onSort={onSort}
                />
              ))}
              {listing.kind === "member" ? null : (
                <th scope="col">
                  <span className="directory-column-title">
                    {translate("directory.column.contact")}
                  </span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <MemberRow
                key={row.member.userId}
                translate={translate}
                locale={locale}
                row={row}
                selection={selection}
              />
            ))}
          </tbody>
        </table>
      </div>
      {listing.kind === "admin" ? <DotLegend translate={translate} /> : null}
    </div>
  );
}
