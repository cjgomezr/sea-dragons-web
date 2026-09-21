"use client";

import { memberInitials } from "@/lib/auth/member-initials";
import type {
  DirectoryDirection,
  DirectoryListing,
  DirectoryMember,
  DirectorySort,
} from "@/lib/directory/directory";
import type { Translator } from "@/lib/i18n/translator";
import {
  describeCountry,
  describeExperienceLevel,
  describePosition,
} from "./member-labels";

/**
 * La tabla del directorio (FR-015, FR-019): una fila por socio con sus
 * iniciales, su nombre, su país, su nivel, su rol y su posición, y cabeceras
 * que piden el orden.
 *
 * Las columnas de OVR y asistencia del mockup no están: son de E9 y E8, y hoy
 * no hay dato que enseñar.
 *
 * Ordenar es cosa del servidor, así que pulsar una cabecera no reordena nada
 * aquí: dice por dónde, y la pantalla vuelve a preguntar.
 */

/** Lo que una fila necesita saber, con lo que sólo un Admin recibe ya
 * resuelto: así la fila no tiene que volver a preguntarse quién la mira. */
type DirectoryRow = {
  readonly member: DirectoryMember;
  readonly isAufExpired: boolean;
};

function rowsOf(listing: DirectoryListing): readonly DirectoryRow[] {
  return listing.kind === "admin"
    ? listing.members.map((member) => ({
        member,
        isAufExpired: member.isAufExpired,
      }))
    : listing.members.map((member) => ({ member, isAufExpired: false }));
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
  label,
  column,
  sort,
  direction,
  onSort,
}: {
  label: string;
  column: DirectorySort;
  sort: DirectorySort;
  direction: DirectoryDirection;
  onSort: (column: DirectorySort) => void;
}): React.JSX.Element {
  const isSorted = sort === column;
  return (
    <th scope="col" aria-sort={isSorted ? ARIA_SORT[direction] : "none"}>
      <button
        type="button"
        className="directory-sort"
        onClick={() => onSort(column)}
      >
        {label}
        <span className="directory-arrow" aria-hidden="true">
          {isSorted ? SORT_ARROWS[direction] : ""}
        </span>
      </button>
    </th>
  );
}

/** Una marca dice algo de la fila con palabras, nunca sólo con color. El tono
 * separa lo que sólo informa (está de baja) de lo que pide hacer algo: un
 * registro federativo vencido es una advertencia, y se pinta como tal. */
type RowMark = {
  readonly text: string;
  readonly tone: "neutral" | "warning";
};

/** Lo que distingue a esta fila de las demás: de baja (AC-040) y el registro
 * federativo vencido (BR-008), que sólo un Admin recibe. */
function marksOf(translate: Translator, row: DirectoryRow): readonly RowMark[] {
  return [
    ...(row.member.status === "inactive"
      ? [
          {
            text: translate("directory.mark.inactive"),
            tone: "neutral" as const,
          },
        ]
      : []),
    ...(row.isAufExpired
      ? [
          {
            text: translate("directory.mark.aufExpired"),
            tone: "warning" as const,
          },
        ]
      : []),
  ];
}

function RowMarks({
  marks,
}: {
  marks: readonly RowMark[];
}): React.JSX.Element | null {
  if (marks.length === 0) {
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
    </span>
  );
}

function MemberRow({
  translate,
  row,
}: {
  translate: Translator;
  row: DirectoryRow;
}): React.JSX.Element {
  const { member } = row;
  return (
    <tr aria-label={member.fullName}>
      <th scope="row">
        {/* La caja flexible va dentro y no en la celda: un `th` que deja de
            ser `table-cell` no estira con su fila, y el contenido de la más
            alta se sale por debajo del borde. */}
        <span className="directory-member">
          <span className="directory-avatar" aria-hidden="true">
            {memberInitials(member.fullName)}
          </span>
          <span className="directory-identity">
            <span className="directory-name">{member.fullName}</span>
            <span className="directory-meta">
              {`${describeCountry(translate, member.country)} · ${describeExperienceLevel(translate, member.experienceLevel)}`}
            </span>
            <RowMarks marks={marksOf(translate, row)} />
          </span>
        </span>
      </th>
      <td className="directory-role-cell">
        {translate(`role.${member.role}`)}
      </td>
      <td>
        <span className="directory-position">
          {describePosition(translate, member.position)}
        </span>
      </td>
    </tr>
  );
}

export function DirectoryTable({
  translate,
  listing,
  sort,
  direction,
  onSort,
}: {
  translate: Translator;
  listing: DirectoryListing;
  sort: DirectorySort;
  direction: DirectoryDirection;
  onSort: (column: DirectorySort) => void;
}): React.JSX.Element {
  const rows = rowsOf(listing);
  return (
    // La tarjeta es el div y no la tabla: un `border-radius` sobre una tabla
    // no recorta las esquinas de su primera y su última fila.
    <div className="directory-card">
      <table className="directory-table">
        <caption className="directory-count">
          {translate("directory.memberCount", { count: rows.length })}
        </caption>
        <thead>
          <tr>
            <SortableHeader
              label={translate("directory.column.member")}
              column="name"
              sort={sort}
              direction={direction}
              onSort={onSort}
            />
            <SortableHeader
              label={translate("directory.column.role")}
              column="role"
              sort={sort}
              direction={direction}
              onSort={onSort}
            />
            <SortableHeader
              label={translate("directory.column.position")}
              column="position"
              sort={sort}
              direction={direction}
              onSort={onSort}
            />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <MemberRow
              key={row.member.userId}
              translate={translate}
              row={row}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
