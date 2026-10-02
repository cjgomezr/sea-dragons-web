"use client";

import Link from "next/link";
import { MemberAvatar } from "@/components/MemberAvatar";
import { describeAttendance } from "@/components/attendance/MemberAttendanceSummary";
import type {
  DirectoryDirection,
  DirectoryListing,
  DirectoryMember,
  DirectorySort,
} from "@/lib/directory/directory";
import { MEMBER_RECORD_PATH } from "@/lib/auth/routes";
import { memberEvaluationHref } from "@/lib/evaluations/member-evaluation-href";
import { formatCalendarDay } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import type { MembershipStatus } from "@/lib/membership/membership";
import { type AufState, type RowMark, aufMarksOf } from "./auf-marks";
import { membershipMarkOf } from "./membership-mark";
import {
  type DirectoryOrder,
  DirectorySortControl,
  SORT_COLUMN_LABELS,
} from "./DirectorySortControl";
import {
  MemberRoleControl,
  type RoleDraftsControl,
  type SaveMemberRole,
  useRoleDrafts,
} from "./MemberRoleControl";
import {
  describeCountry,
  describeExperienceLevel,
  describePosition,
} from "./member-labels";

/**
 * La tabla del directorio (FR-015, FR-019): una fila por socio con su foto o
 * sus iniciales (#245), su nombre, su país, su nivel, su rol, su posición y su
 * asistencia (#396), y cabeceras que piden el orden.
 *
 * La columna de OVR del mockup no está. Del OVR, el directorio sólo cuenta a
 * Admin y Coach quién está sin evaluar (#324): la nota se ve en Evaluaciones,
 * y a un Player o un Committee no le llega nada (FR-055).
 *
 * Ordenar es cosa del servidor, así que pulsar una cabecera no reordena nada
 * aquí: dice por dónde, y la pantalla vuelve a preguntar.
 *
 * Por debajo de 768px la misma tabla se pinta como una lista de tarjetas
 * (#283), sin cabeceras: cada dato lleva entonces su etiqueta, escrita por la
 * hoja de estilos desde su `data-label`, y el orden se elige con
 * `DirectorySortControl`. Es el mismo marcado en los dos anchos para que el
 * servidor no tenga que adivinar cuál pintar, y para que las filas sigan
 * siendo filas para un lector de pantalla.
 *
 * A un Admin la celda del rol le da además el control para cambiarlo (#240).
 * Lo decide la marca de la lista, no un rol leído aparte: el endpoint del
 * cambio de rol lo comprueba igual por su cuenta.
 */

/** El círculo de cada fila, en píxeles; `.directory-avatar` dice lo mismo. */
const DIRECTORY_AVATAR_SIZE = 40;

/** El registro federativo de una fila, que sólo recibe un Admin (BR-008). */
type AufView = AufState & { readonly aufExpiry: string | null };

/** Lo que de una fila sólo recibe un Admin: el registro federativo y el
 * estado de la membresía (#453). */
type AdminView = AufView & {
  readonly membershipStatus: MembershipStatus | null;
};

/** Lo que una fila necesita saber, con lo que sólo un Admin recibe ya
 * resuelto: así la fila no tiene que volver a preguntarse quién la mira. Con
 * `admin` la fila es de Admin: enseña el registro y la membresía, enlaza la
 * ficha (#242) y deja cambiar el rol (#240). `isEvaluated` es null para quien no ve
 * evaluaciones (#324). */
type DirectoryRow = {
  readonly member: DirectoryMember;
  readonly admin: AdminView | null;
  readonly isEvaluated: boolean | null;
};

function rowsOf(listing: DirectoryListing): readonly DirectoryRow[] {
  switch (listing.kind) {
    case "admin":
      return listing.members.map((member) => ({
        member,
        admin: member,
        isEvaluated: member.isEvaluated,
      }));
    case "coach":
      return listing.members.map((member) => ({
        member,
        admin: null,
        isEvaluated: member.isEvaluated,
      }));
    case "member":
      return listing.members.map((member) => ({
        member,
        admin: null,
        isEvaluated: null,
      }));
  }
}

/** La línea del AUF, con el vencimiento escrito en el idioma de la pantalla.
 * Quien no tiene número no tiene registro: se dice, no se deja en blanco. */
function describeAuf(
  translate: Translator,
  locale: Locale,
  auf: AufView,
): string {
  if (auf.aufNumber === null) {
    return translate("directory.aufMissing");
  }
  return auf.aufExpiry === null
    ? translate("directory.aufWithoutExpiry", { number: auf.aufNumber })
    : translate("directory.aufSummary", {
        number: auf.aufNumber,
        date: formatCalendarDay(locale, auf.aufExpiry),
      });
}

/** Sólo la lista de un Admin trae el AUF y la membresía, y es la misma marca que le da el
 * enlace a la ficha y el cambio de rol. */
function isAdminRow(row: DirectoryRow): row is DirectoryRow & {
  readonly admin: AdminView;
} {
  return row.admin !== null;
}

function memberRecordHref(userId: string): string {
  return MEMBER_RECORD_PATH.replace("[id]", userId);
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

/** La flecha del orden es decorativa: lo que un lector de pantalla anuncia es
 * el `aria-sort` de la cabecera, y ahí la dirección ya va dicha con palabras. */
const SORT_ARROWS: Readonly<Record<DirectoryDirection, string>> = {
  asc: "↑",
  desc: "↓",
};

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
  return (
    <th scope="col" aria-sort={isSorted ? ARIA_SORT[order.direction] : "none"}>
      <button
        type="button"
        className="directory-sort"
        onClick={() => onSort(column)}
      >
        {translate(SORT_COLUMN_LABELS[column])}
        <span className="directory-arrow" aria-hidden="true">
          {isSorted ? SORT_ARROWS[order.direction] : ""}
        </span>
      </button>
    </th>
  );
}

/** Lo que distingue a esta fila de las demás: pendiente de activar (#243), de
 * baja (AC-040) y el estado del registro federativo (BR-008, #274), que sólo
 * un Admin recibe. */
function marksOf(translate: Translator, row: DirectoryRow): readonly RowMark[] {
  return [
    ...(row.member.status === "incomplete"
      ? [
          {
            text: translate("directory.mark.pendingActivation"),
            tone: "neutral" as const,
          },
        ]
      : []),
    ...(row.member.status === "inactive"
      ? [
          {
            text: translate("directory.mark.inactive"),
            tone: "neutral" as const,
          },
        ]
      : []),
    ...(row.admin === null
      ? []
      : [
          ...aufMarksOf(translate, row.admin),
          membershipMarkOf(translate, row.admin.membershipStatus),
        ]),
  ];
}

/** La única marca que se pulsa: lleva a crear la evaluación que falta. El
 * tono es el de lo que pide hacer algo, como el AUF vencido. El nombre
 * accesible empieza por el texto visible (WCAG 2.5.3) y dice de quién es. */
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

function RowMarks({
  translate,
  row,
}: {
  translate: Translator;
  row: DirectoryRow;
}): React.JSX.Element | null {
  const marks = marksOf(translate, row);
  const isMarkedUnevaluated = needsEvaluation(row);
  if (marks.length === 0 && !isMarkedUnevaluated) {
    return null;
  }
  return (
    <span className="directory-marks">
      {marks.map((mark) => (
        <span
          key={mark.text}
          className={`directory-mark directory-mark-${mark.tone}`}
        >
          {mark.text}
        </span>
      ))}
      {isMarkedUnevaluated ? (
        <NotEvaluatedMark translate={translate} member={row.member} />
      ) : null}
    </span>
  );
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
  if (!isAdminRow(row)) {
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

function MemberRow({
  translate,
  locale,
  row,
  roleDrafts,
}: {
  translate: Translator;
  locale: Locale;
  row: DirectoryRow;
  roleDrafts: RoleDraftsControl;
}): React.JSX.Element {
  const { member } = row;
  return (
    // El nombre accesible de la fila se declara en vez de dejarlo calcular:
    // el nombre calculado saldría del contenido de las celdas, y ahí van el
    // país, el nivel, las marcas y el rol. Quien recorre la tabla con un
    // lector de pantalla quiere saber de quién es la fila en la que entra.
    <tr aria-label={member.fullName}>
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
            <MemberName translate={translate} row={row} />
            <MemberFacts translate={translate} member={member} />
            {isAdminRow(row) ? (
              <span className="directory-meta">
                {describeAuf(translate, locale, row.admin)}
              </span>
            ) : null}
            <RowMarks translate={translate} row={row} />
          </span>
        </span>
      </th>
      <td
        className="directory-role-cell"
        data-label={translate("directory.column.role")}
      >
        {isAdminRow(row) ? (
          <MemberRoleControl
            translate={translate}
            member={member}
            drafts={roleDrafts}
          />
        ) : (
          translate(`role.${member.role}`)
        )}
      </td>
      <td data-label={translate("directory.column.position")}>
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
    </tr>
  );
}

export function DirectoryTable({
  translate,
  locale,
  listing,
  order,
  onSort,
  onOrderChange,
  onSaveRole,
}: {
  translate: Translator;
  locale: Locale;
  listing: DirectoryListing;
  order: DirectoryOrder;
  /** Lo que pide una cabecera de la tabla: sólo el campo. */
  onSort: (column: DirectorySort) => void;
  /** Lo que pide el selector de la lista de tarjetas: campo y sentido. */
  onOrderChange: (order: DirectoryOrder) => void;
  /** Sólo se llama desde una lista de Admin, que es la única que dibuja el
   * control del rol. */
  onSaveRole: SaveMemberRole;
}): React.JSX.Element {
  const rows = rowsOf(listing);
  const roleDrafts = useRoleDrafts(onSaveRole);
  return (
    <>
      <DirectorySortControl
        translate={translate}
        order={order}
        onChange={onOrderChange}
      />
      {/* La tarjeta es el div y no la tabla: un `border-radius` sobre una
          tabla no recorta las esquinas de su primera y su última fila. */}
      <div className="directory-card">
        <table
          className={
            listing.kind === "admin"
              ? "directory-table directory-table-admin"
              : "directory-table"
          }
        >
          <caption className="directory-count">
            {translate("directory.memberCount", { count: rows.length })}
          </caption>
          <thead>
            <tr>
              <SortableHeader
                translate={translate}
                column="name"
                order={order}
                onSort={onSort}
              />
              <SortableHeader
                translate={translate}
                column="role"
                order={order}
                onSort={onSort}
              />
              <SortableHeader
                translate={translate}
                column="position"
                order={order}
                onSort={onSort}
              />
              <SortableHeader
                translate={translate}
                column="attendance"
                order={order}
                onSort={onSort}
              />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <MemberRow
                key={row.member.userId}
                translate={translate}
                locale={locale}
                row={row}
                roleDrafts={roleDrafts}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
