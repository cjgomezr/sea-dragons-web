import {
  type CsvCell,
  asFileNamePart,
  encodeCsv,
} from "@/lib/directory/directory-csv";
import type { Translator } from "@/lib/i18n/translator";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import type { LevyBuyer } from "./levy-sales";

/**
 * Los compradores de un extra en CSV (#531, #634): una fila por compra, con
 * sus unidades y sin faltantes (D1 del PRD de E23), con el codificador del
 * directorio (BOM, comillas y escape de fórmulas). Las cabeceras van en el idioma de la
 * pantalla; el nombre del levy es el de Stripe.
 */

const CENTS_PER_DOLLAR = 100;

/** Con sus dos decimales y sin símbolo: la hoja de cálculo lo lee como un
 * número y lo puede sumar. */
function asDollars(cents: number): string {
  return (cents / CENTS_PER_DOLLAR).toFixed(2);
}

export function levyPayersCsv(
  buyers: readonly LevyBuyer[],
  translate: Translator,
): string {
  const rows: (readonly CsvCell[])[] = [
    [
      translate("payments.levyPayers.csv.column.name"),
      translate("payments.levyPayers.csv.column.email"),
      translate("payments.levyPayers.csv.column.units"),
      translate("payments.levyPayers.csv.column.date"),
      translate("payments.levyPayers.csv.column.amount"),
    ],
    ...buyers.map((buyer) => [
      buyer.fullName,
      buyer.email,
      buyer.quantity,
      // El día de Melbourne (NFR-003), el mismo que enseña la pantalla.
      clubCalendarDate(new Date(buyer.paidAt)),
      asDollars(buyer.amountCents),
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
