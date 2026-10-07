import {
  type CsvCell,
  asFileNamePart,
  encodeCsv,
} from "@/lib/directory/directory-csv";
import type { Translator } from "@/lib/i18n/translator";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import type { LevyPayersReport } from "./levy-payers";

/**
 * Quién pagó un levy en CSV (#531): una fila por socio, primero los que
 * pagaron y luego los que faltan, con el codificador del directorio (BOM,
 * comillas y escape de fórmulas). Las cabeceras van en el idioma de la
 * pantalla; el nombre del levy es el de Stripe.
 */

const CENTS_PER_DOLLAR = 100;

/** Con sus dos decimales y sin símbolo: la hoja de cálculo lo lee como un
 * número y lo puede sumar. */
function asDollars(cents: number): string {
  return (cents / CENTS_PER_DOLLAR).toFixed(2);
}

export function levyPayersCsv(
  report: LevyPayersReport,
  translate: Translator,
): string {
  const yes = translate("payments.levyPayers.csv.yes");
  const no = translate("payments.levyPayers.csv.no");
  const rows: (readonly CsvCell[])[] = [
    [
      translate("payments.levyPayers.csv.column.name"),
      translate("payments.levyPayers.csv.column.email"),
      translate("payments.levyPayers.csv.column.paid"),
      translate("payments.levyPayers.csv.column.date"),
      translate("payments.levyPayers.csv.column.amount"),
    ],
    ...report.payers.map((payer) => [
      payer.fullName,
      payer.email,
      yes,
      // El día de Melbourne (NFR-003), el mismo que enseña la pantalla.
      clubCalendarDate(new Date(payer.paidAt)),
      asDollars(payer.amountCents),
    ]),
    ...report.missing.map((member) => [
      member.fullName,
      member.email,
      no,
      null,
      null,
    ]),
  ];
  return encodeCsv(rows);
}

export function levyPayersCsvFilename({
  levyName,
  todayInClub,
  translate,
}: {
  readonly levyName: string;
  /** El día de Melbourne (NFR-003), no el de UTC. */
  readonly todayInClub: string;
  readonly translate: Translator;
}): string {
  const parts = [
    asFileNamePart(levyName),
    translate("payments.levyPayers.csv.fileName"),
    todayInClub,
  ];
  return `${parts.filter((part) => part !== "").join("-")}.csv`;
}
