"use client";

import Link from "next/link";
import { MemberAvatar } from "@/components/MemberAvatar";
import type {
  DirectoryDirection,
  DirectoryListing,
  DirectoryMember,
  DirectorySort,
} from "@/lib/directory/directory";
import { MEMBER_RECORD_PATH } from "@/lib/auth/routes";
import { formatCalendarDay } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
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
 * sus iniciales (#245), su nombre, su país, su nivel, su rol y su posición, y cabeceras
 * que piden el orden.
 *
 * Las columnas de OVR y asistencia del mockup no están: son de E9 y E8, y hoy
 * no hay dato que enseñar.
 *
 * Ordenar es cosa del servidor, así que pulsar una cabecera no reordena nada
 * aquí: dice por dónde, y la pantalla vuelve a preguntar.
 *
 * A un Admin la celda del rol le da además el control para cambiarlo (#240).
 * Lo decide la marca de la lista, no un rol leído aparte: el endpoint del
 * cambio de rol lo comprueba igual por su cuenta.
 */

/** El círculo de cada fila, en píxeles; `.directory-avatar` dice lo mismo. */
const DIRECTORY_AVATAR_SIZE = 40;

/** El registro federativo de una fila, que sólo recibe un Admin (BR-008). */
type AufView = {
  readonly aufNumber: string | null;
  readonly aufExpiry: string | null;
  readonly isAufExpired: boolean;
};

/** Lo que una fila necesita saber, con lo que sólo un Admin recibe ya
 * resuelto: así la fila no tiene que volver a preguntarse quién la mira. Con
 * `auf` la fila es de Admin: enseña el registro, enlaza la ficha (#242) y
 * deja cambiar el rol (#240). */
type DirectoryRow = {
  readonly member: DirectoryMember;
  readonly auf: AufView | null;
};

function rowsOf(listing: DirectoryListing): readonly DirectoryRow[] {
  return listing.kind === "admin"
    ? listing.members.map((member) => ({ member, auf: member }))
    : listing.members.map((member) => ({ member, auf: null }));
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

/** Sólo la lista de un Admin trae el AUF, y es la misma marca que le da el
 * enlace a la ficha y el cambio de rol. */
function isAdminRow(row: DirectoryRow): row is DirectoryRow & {
  readonly auf: AufView;
} {
  return row.auf !== null;
}

function memberRecordHref(userId: string): string {
  return MEMBER_RECORD_PATH.replace("[id]", userId);
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

/** Lo que distingue a esta fila de las demás: pendiente de activar (#243), de
 * baja (AC-040) y el registro federativo vencido (BR-008), que sólo un Admin
 * recibe. */
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
    ...(row.auf?.isAufExpired === true
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
          />
          <span className="directory-identity">
            <MemberName translate={translate} row={row} />
            <span className="directory-meta">
              {`${describeCountry(translate, member.country)} · ${describeExperienceLevel(translate, member.experienceLevel)}`}
            </span>
            {isAdminRow(row) ? (
              <span className="directory-meta">
                {describeAuf(translate, locale, row.auf)}
              </span>
            ) : null}
            <RowMarks marks={marksOf(translate, row)} />
          </span>
        </span>
      </th>
      <td className="directory-role-cell">
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
  locale,
  listing,
  sort,
  direction,
  onSort,
  onSaveRole,
}: {
  translate: Translator;
  locale: Locale;
  listing: DirectoryListing;
  sort: DirectorySort;
  direction: DirectoryDirection;
  onSort: (column: DirectorySort) => void;
  /** Sólo se llama desde una lista de Admin, que es la única que dibuja el
   * control del rol. */
  onSaveRole: SaveMemberRole;
}): React.JSX.Element {
  const rows = rowsOf(listing);
  const roleDrafts = useRoleDrafts(onSaveRole);
  return (
    // La tarjeta es el div y no la tabla: un `border-radius` sobre una tabla
    // no recorta las esquinas de su primera y su última fila.
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
              locale={locale}
              row={row}
              roleDrafts={roleDrafts}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
