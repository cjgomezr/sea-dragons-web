import type { AccountStatus } from "@/lib/auth/account-status";
import { positionName } from "@/lib/club/club-positions";
import { countryName } from "@/lib/geo/countries";
import type { MessageKey } from "@/lib/i18n/message";
import type { MessageParams, Translator } from "@/lib/i18n/translator";
import type { MembershipStatus } from "@/lib/membership/membership";
import type {
  AdminDirectoryMember,
  CommitteeDirectoryMember,
} from "./directory";

/**
 * El directorio en CSV (#500, RF-5 del PRD de E19): la lista que ve un Admin
 * o un Committee, con las columnas de su pantalla, lista para abrirla en
 * Excel sin ninguna librería.
 *
 * Los valores van en el idioma de quien exporta, como las cabeceras. Lo que
 * falta deja la celda vacía y no el guion de la pantalla: en una hoja de
 * cálculo, una celda vacía se filtra y se cuenta; un guion es un texto más.
 */

/** Sin ella, Excel lee el archivo en la codificación del sistema y los
 * acentos salen rotos. */
export const CSV_BYTE_ORDER_MARK = "\uFEFF";

/** RFC 4180 separa las filas con CRLF. */
const ROW_SEPARATOR = "\r\n";

/** Lo que Excel toma por el principio de una fórmula (OWASP, CSV injection):
 * los cuatro de siempre, más el tabulador y el retorno de carro. */
const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"] as const;

/** Lo que obliga a entrecomillar una celda (RFC 4180). */
const NEEDS_QUOTES = /[",\r\n]/;

export type CsvCell = string | number | null;

/** El apóstrofo delante hace que Excel lo lea como texto. Un número no se
 * toca: lo escribe este módulo, no un socio. */
function neutralizeFormula(value: string): string {
  return FORMULA_TRIGGERS.some((trigger) => value.startsWith(trigger))
    ? `'${value}`
    : value;
}

function encodeCell(cell: CsvCell): string {
  if (cell === null) {
    return "";
  }
  if (typeof cell === "number") {
    return String(cell);
  }
  const text = neutralizeFormula(cell);
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function encodeCsv(rows: readonly (readonly CsvCell[])[]): string {
  const lines = rows.map(
    (row) => row.map(encodeCell).join(",") + ROW_SEPARATOR,
  );
  return CSV_BYTE_ORDER_MARK + lines.join("");
}

/** Las listas que se exportan: las de quien ve el contacto de todos (D6). */
export type ExportableListing =
  | {
      readonly kind: "admin";
      readonly members: readonly AdminDirectoryMember[];
    }
  | {
      readonly kind: "committee";
      readonly members: readonly CommitteeDirectoryMember[];
    };

/** Una cabecera es un texto fijo: ningún mensaje con datos que rellenar. */
type HeaderKey = {
  [Key in MessageKey]: keyof MessageParams<Key> extends never ? Key : never;
}[MessageKey];

type Column<Member> = {
  readonly header: HeaderKey;
  readonly value: (member: Member, translate: Translator) => CsvCell;
};

const ACCOUNT_STATUS_KEYS = {
  incomplete: "directory.export.status.incomplete",
  active: "directory.export.status.active",
  inactive: "directory.export.status.inactive",
} as const satisfies Record<AccountStatus, MessageKey>;

const MEMBERSHIP_KEYS = {
  pending: "directory.mark.membership.pending",
  trialing: "directory.mark.membership.trialing",
  active: "directory.mark.membership.active",
  past_due: "directory.mark.membership.pastDue",
  cancelled: "directory.mark.membership.cancelled",
  waived: "directory.mark.membership.waived",
} as const satisfies Record<MembershipStatus, MessageKey>;

function yesOrNo(translate: Translator, value: boolean): string {
  return translate(value ? "directory.export.yes" : "directory.export.no");
}

/** Un código que el catálogo no conoce sale tal cual, como en la pantalla. */
function countryOf(
  { country }: CommitteeDirectoryMember,
  translate: Translator,
): CsvCell {
  return country === null
    ? null
    : (countryName(translate.locale, country) ?? country);
}

const IDENTITY_COLUMNS: readonly Column<CommitteeDirectoryMember>[] = [
  {
    header: "directory.export.column.name",
    value: (member) => member.fullName,
  },
  { header: "directory.field.country", value: countryOf },
  {
    header: "directory.field.level",
    value: ({ experienceLevel }, translate) =>
      experienceLevel === null ? null : translate(`level.${experienceLevel}`),
  },
];

const AUF_COLUMNS: readonly Column<AdminDirectoryMember>[] = [
  {
    header: "directory.export.column.aufNumber",
    value: (member) => member.aufNumber,
  },
  {
    header: "directory.export.column.aufExpiry",
    value: (member) => member.aufExpiry,
  },
  {
    header: "directory.export.column.aufVerified",
    value: (member, translate) => yesOrNo(translate, member.isAufVerified),
  },
];

const ACCOUNT_STATUS_COLUMN: Column<CommitteeDirectoryMember> = {
  header: "directory.export.column.accountStatus",
  value: ({ status }, translate) => translate(ACCOUNT_STATUS_KEYS[status]),
};

const ADMIN_MARK_COLUMNS: readonly Column<AdminDirectoryMember>[] = [
  {
    header: "directory.export.column.membership",
    value: ({ membershipStatus }, translate) =>
      translate(
        membershipStatus === null
          ? "directory.mark.membership.none"
          : MEMBERSHIP_KEYS[membershipStatus],
      ),
  },
  {
    header: "directory.export.column.evaluated",
    value: (member, translate) => yesOrNo(translate, member.isEvaluated),
  },
];

/** Las columnas de la tabla y la del contacto, abierta en sus partes para
 * que cada una se pueda filtrar en la hoja. */
const CLUB_COLUMNS: readonly Column<CommitteeDirectoryMember>[] = [
  {
    header: "directory.column.role",
    value: ({ role }, translate) => translate(`role.${role}`),
  },
  {
    header: "directory.column.position",
    value: ({ position }, translate) =>
      position === null ? null : positionName(position.names, translate.locale),
  },
  {
    header: "directory.export.column.attendance",
    value: ({ attendance }) =>
      attendance.kind === "rate" ? attendance.percent : null,
  },
  { header: "directory.contact.email", value: (member) => member.email },
  { header: "directory.contact.phone", value: (member) => member.phone },
  {
    header: "directory.export.column.emergencyName",
    value: ({ emergencyContact }) => emergencyContact?.name ?? null,
  },
  {
    header: "directory.export.column.emergencyPhone",
    value: ({ emergencyContact }) => emergencyContact?.phone ?? null,
  },
  {
    header: "directory.export.column.emergencyRelationship",
    value: ({ emergencyContact }) => emergencyContact?.relationship ?? null,
  },
];

/** En el orden en que la fila del directorio enseña cada dato: nombre, país
 * y nivel; lo del Admin bajo ellos; las marcas; y luego las columnas. */
const COMMITTEE_COLUMNS: readonly Column<CommitteeDirectoryMember>[] = [
  ...IDENTITY_COLUMNS,
  ACCOUNT_STATUS_COLUMN,
  ...CLUB_COLUMNS,
];

const ADMIN_COLUMNS: readonly Column<AdminDirectoryMember>[] = [
  ...IDENTITY_COLUMNS,
  ...AUF_COLUMNS,
  ACCOUNT_STATUS_COLUMN,
  ...ADMIN_MARK_COLUMNS,
  ...CLUB_COLUMNS,
];

function tableOf<Member>(
  columns: readonly Column<Member>[],
  members: readonly Member[],
  translate: Translator,
): readonly (readonly CsvCell[])[] {
  return [
    columns.map((column) => translate(column.header)),
    ...members.map((member) =>
      columns.map((column) => column.value(member, translate)),
    ),
  ];
}

export function directoryCsv(
  listing: ExportableListing,
  translate: Translator,
): string {
  return encodeCsv(
    listing.kind === "admin"
      ? tableOf(ADMIN_COLUMNS, listing.members, translate)
      : tableOf(COMMITTEE_COLUMNS, listing.members, translate),
  );
}

/** Sin acentos ni signos: el nombre tiene que servir en cualquier sistema de
 * archivos y en la cabecera `Content-Disposition` sin codificarlo. */
export function asFileNamePart(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function directoryCsvFilename({
  clubName,
  todayInClub,
  translate,
}: {
  readonly clubName: string;
  /** El día de Melbourne (NFR-003), no el de UTC. */
  readonly todayInClub: string;
  readonly translate: Translator;
}): string {
  const parts = [
    asFileNamePart(clubName),
    translate("directory.export.fileName"),
    todayInClub,
  ];
  // Un nombre de club sin letras latinas no deja nada: sin él, el archivo
  // empezaría por un guion.
  return `${parts.filter((part) => part !== "").join("-")}.csv`;
}
