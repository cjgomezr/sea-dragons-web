import { type CsvCell, encodeCsv } from "@/lib/directory/directory-csv";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import { formatCardBrand } from "./card-brand";
import { asDollars } from "./levy-payers-csv";
import type {
  PaymentCard,
  PaymentStatus,
  PaymentView,
} from "./membership-view";

/**
 * El historial de pagos del socio (#631, RF-5 del PRD de E23): agrupado por
 * el mes de Melbourne (NFR-003), filtrado por estado y exportado a CSV con lo
 * que deja ver el filtro. El CSV usa el codificador del directorio (BOM,
 * comillas y escape de fórmulas).
 */

export type PaymentHistoryFilter = "all" | PaymentStatus;

export type PaymentMonthGroup = {
  /** YYYY-MM, el mes del club en que cae el pago. */
  readonly month: string;
  readonly payments: readonly PaymentView[];
};

const ISO_MONTH_LENGTH = "YYYY-MM".length;

/** Siempre están; Pendientes sólo cuando hay algo pendiente que filtrar. */
const ALWAYS_OFFERED_FILTERS: readonly PaymentHistoryFilter[] = [
  "all",
  "paid",
  "failed",
];

const STATUS_KEYS = {
  paid: "payments.history.paid",
  failed: "payments.history.failed",
  pending: "payments.history.pending",
} as const satisfies Record<PaymentStatus, MessageKey>;

function clubMonthOf(payment: PaymentView): string {
  return clubCalendarDate(new Date(payment.date)).slice(0, ISO_MONTH_LENGTH);
}

function byNewestFirst(left: PaymentView, right: PaymentView): number {
  return Date.parse(right.date) - Date.parse(left.date);
}

export function groupPaymentsByMonth(
  payments: readonly PaymentView[],
): readonly PaymentMonthGroup[] {
  const groups: { month: string; payments: PaymentView[] }[] = [];
  for (const payment of [...payments].sort(byNewestFirst)) {
    const month = clubMonthOf(payment);
    const current = groups.at(-1);
    if (current?.month === month) {
      current.payments.push(payment);
    } else {
      groups.push({ month, payments: [payment] });
    }
  }
  return groups;
}

export function paymentHistoryFilters(
  payments: readonly PaymentView[],
): readonly PaymentHistoryFilter[] {
  const hasPending = payments.some(({ status }) => status === "pending");
  return hasPending
    ? [...ALWAYS_OFFERED_FILTERS, "pending"]
    : ALWAYS_OFFERED_FILTERS;
}

export function filterPayments(
  payments: readonly PaymentView[],
  filter: PaymentHistoryFilter,
): readonly PaymentView[] {
  return filter === "all"
    ? payments
    : payments.filter(({ status }) => status === filter);
}

/** "Visa •••• 4242"; nulo sin tarjeta guardada (D4 del PRD de E23). */
export function describePaymentMethod(card: PaymentCard | null): string | null {
  return card === null
    ? null
    : `${formatCardBrand(card.brand)} •••• ${card.last4}`;
}

export function describePayment(
  translate: Translator,
  payment: PaymentView,
): string {
  return (
    payment.description ?? translate("payments.history.defaultDescription")
  );
}

export function describePaymentStatus(
  translate: Translator,
  status: PaymentStatus,
): string {
  return translate(STATUS_KEYS[status]);
}

export function paymentHistoryCsv(
  payments: readonly PaymentView[],
  translate: Translator,
): string {
  const rows: (readonly CsvCell[])[] = [
    [
      translate("payments.history.csv.column.date"),
      translate("payments.history.csv.column.description"),
      translate("payments.history.csv.column.method"),
      translate("payments.history.csv.column.amount"),
      translate("payments.history.csv.column.status"),
    ],
    ...payments.map((payment) => [
      // El día de Melbourne (NFR-003), el mismo que enseña la pantalla.
      clubCalendarDate(new Date(payment.date)),
      describePayment(translate, payment),
      describePaymentMethod(payment.card),
      asDollars(payment.amountCents),
      describePaymentStatus(translate, payment.status),
    ]),
  ];
  return encodeCsv(rows);
}

export function paymentHistoryCsvFilename({
  todayInClub,
  translate,
}: {
  /** El día de Melbourne (NFR-003), no el de UTC. */
  readonly todayInClub: string;
  readonly translate: Translator;
}): string {
  return `${translate("payments.history.csv.fileName")}-${todayInClub}.csv`;
}
