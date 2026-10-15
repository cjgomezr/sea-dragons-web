"use client";

import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { Clock } from "@phosphor-icons/react/dist/ssr/Clock";
import { DownloadSimple } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { Receipt } from "@phosphor-icons/react/dist/ssr/Receipt";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import { useId, useState } from "react";
import { Icon } from "@/components/Icon";
import { saveFile } from "@/components/save-file";
import {
  formatAudCents,
  formatCalendarMonth,
  formatClubCompactDay,
} from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type {
  PaymentStatus,
  PaymentView,
} from "@/lib/membership/membership-view";
import {
  type PaymentHistoryFilter,
  type PaymentMonthGroup,
  describePayment,
  describePaymentMethod,
  describePaymentStatus,
  filterPayments,
  groupPaymentsByMonth,
  paymentHistoryCsv,
  paymentHistoryCsvFilename,
  paymentHistoryFilters,
} from "@/lib/membership/payment-history";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import { openReceipt } from "./checkout-navigation";
import { requestPaymentReceipt } from "./payments-client";

/**
 * El historial de pagos (#455, rehecho en #631 con RF-5 del PRD de E23):
 * agrupado por mes, filtrado por estado, con el método y el motivo del fallo,
 * el recibo de Stripe de cada pago cobrado y la exportación a CSV de lo que
 * deja ver el filtro.
 *
 * El escritorio es una tabla y el móvil una lista de filas tocables: las dos
 * se pintan y la hoja de estilos enseña una según el ancho, como el
 * directorio (#553). Una fila de tabla no puede ser un botón.
 */

const CSV_TYPE = "text/csv;charset=utf-8";
const COLUMN_COUNT = 6;

const FILTER_KEYS = {
  all: "payments.history.filter.all",
  paid: "payments.history.filter.paid",
  failed: "payments.history.filter.failed",
  pending: "payments.history.filter.pending",
} as const satisfies Record<PaymentHistoryFilter, string>;

/** El círculo de cada fila en el móvil. */
const STATUS_GLYPHS: Readonly<Record<PaymentStatus, PhosphorGlyph>> = {
  paid: Check,
  failed: X,
  pending: Clock,
};

type ReceiptState =
  | { readonly kind: "idle" }
  | { readonly kind: "opening"; readonly paymentId: string }
  | { readonly kind: "failed" };

type ReceiptRequest = {
  readonly state: ReceiptState;
  readonly open: (paymentId: string) => void;
};

/** La URL del recibo caduca (#630): se pide en cada apertura. */
function useReceipt(): ReceiptRequest {
  const [state, setState] = useState<ReceiptState>({ kind: "idle" });
  async function requestAndOpen(paymentId: string): Promise<void> {
    setState({ kind: "opening", paymentId });
    const outcome = await requestPaymentReceipt(paymentId);
    if (outcome.kind === "found") {
      openReceipt(outcome.url);
      setState({ kind: "idle" });
    } else {
      setState({ kind: "failed" });
    }
  }
  return { state, open: (paymentId) => void requestAndOpen(paymentId) };
}

function isOpening(receipt: ReceiptRequest, payment: PaymentView): boolean {
  return (
    receipt.state.kind === "opening" && receipt.state.paymentId === payment.id
  );
}

function exportCsv(
  payments: readonly PaymentView[],
  translate: Translator,
): void {
  saveFile(
    new Blob([paymentHistoryCsv(payments, translate)], { type: CSV_TYPE }),
    paymentHistoryCsvFilename({
      todayInClub: clubCalendarDate(new Date()),
      translate,
    }),
  );
}

function shortDayOf(translate: Translator, payment: PaymentView): string {
  return formatClubCompactDay(translate.locale, new Date(payment.date));
}

function PaymentStatusLabel({
  translate,
  status,
}: {
  readonly translate: Translator;
  readonly status: PaymentStatus;
}): React.JSX.Element {
  return (
    <span
      className={`payments-payment-status payments-payment-status-${status}`}
    >
      {describePaymentStatus(translate, status)}
    </span>
  );
}

function FailureReason({
  payment,
}: {
  readonly payment: PaymentView;
}): React.JSX.Element | null {
  return payment.failureReason === null ? null : (
    <span className="payments-history-failure">{payment.failureReason}</span>
  );
}

function HistoryToolbar({
  translate,
  filters,
  filter,
  onFilterChange,
  onExport,
}: {
  readonly translate: Translator;
  readonly filters: readonly PaymentHistoryFilter[];
  readonly filter: PaymentHistoryFilter;
  readonly onFilterChange: (filter: PaymentHistoryFilter) => void;
  readonly onExport: () => void;
}): React.JSX.Element {
  const exportLabel = translate("payments.history.export");
  return (
    <div className="payments-history-tools">
      <div
        role="group"
        aria-label={translate("payments.history.filter.label")}
        className="payments-history-filter"
      >
        {filters.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === filter}
            onClick={() => onFilterChange(option)}
          >
            {translate(FILTER_KEYS[option])}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="payments-history-export"
        aria-label={exportLabel}
        title={exportLabel}
        onClick={onExport}
      >
        <Icon glyph={DownloadSimple} />
      </button>
    </div>
  );
}

function TableRow({
  translate,
  payment,
  receipt,
}: {
  readonly translate: Translator;
  readonly payment: PaymentView;
  readonly receipt: ReceiptRequest;
}): React.JSX.Element {
  const description = describePayment(translate, payment);
  return (
    <tr>
      <td className="payments-cell-data">{shortDayOf(translate, payment)}</td>
      <td className="payments-history-description">
        <span>{description}</span>
        <FailureReason payment={payment} />
      </td>
      <td>
        {describePaymentMethod(payment.card) ??
          translate("payments.history.noMethod")}
      </td>
      <td className="payments-cell-data payments-history-amount">
        {formatAudCents(translate.locale, payment.amountCents)}
      </td>
      <td>
        <PaymentStatusLabel translate={translate} status={payment.status} />
      </td>
      <td>
        {payment.status === "paid" ? (
          <button
            type="button"
            className="payments-history-receipt"
            aria-label={translate("payments.history.viewReceipt", {
              description,
            })}
            disabled={isOpening(receipt, payment)}
            onClick={() => receipt.open(payment.id)}
          >
            <Icon glyph={Receipt} />
          </button>
        ) : null}
      </td>
    </tr>
  );
}

function HistoryTable({
  translate,
  titleId,
  groups,
  receipt,
}: {
  readonly translate: Translator;
  readonly titleId: string;
  readonly groups: readonly PaymentMonthGroup[];
  readonly receipt: ReceiptRequest;
}): React.JSX.Element {
  return (
    <table
      className="payments-table payments-history-table"
      aria-labelledby={titleId}
    >
      <thead>
        <tr>
          <th scope="col">{translate("payments.history.date")}</th>
          <th scope="col">{translate("payments.history.description")}</th>
          <th scope="col">{translate("payments.history.method")}</th>
          <th scope="col" className="payments-history-amount">
            {translate("payments.history.amount")}
          </th>
          <th scope="col">{translate("payments.history.status")}</th>
          <th scope="col">
            <span className="visually-hidden">
              {translate("payments.history.receipt")}
            </span>
          </th>
        </tr>
      </thead>
      {groups.map((group) => (
        <tbody key={group.month}>
          <tr className="payments-history-month">
            <th scope="rowgroup" colSpan={COLUMN_COUNT}>
              {formatCalendarMonth(translate.locale, group.month)}
            </th>
          </tr>
          {group.payments.map((payment) => (
            <TableRow
              key={payment.id}
              translate={translate}
              payment={payment}
              receipt={receipt}
            />
          ))}
        </tbody>
      ))}
    </table>
  );
}

function ListRowContent({
  translate,
  payment,
  detailsId,
}: {
  readonly translate: Translator;
  readonly payment: PaymentView;
  readonly detailsId: string;
}): React.JSX.Element {
  return (
    <>
      <span
        className={`payments-history-glyph payments-history-glyph-${payment.status}`}
      >
        <Icon glyph={STATUS_GLYPHS[payment.status]} />
      </span>
      <span className="payments-history-row-main" id={detailsId}>
        <span className="payments-history-row-title">
          {describePayment(translate, payment)}
        </span>
        <span className="payments-history-row-date">
          {shortDayOf(translate, payment)}
        </span>
        <FailureReason payment={payment} />
      </span>
      <span className="payments-history-row-end">
        <span className="payments-cell-data">
          {formatAudCents(translate.locale, payment.amountCents)}
        </span>
        <PaymentStatusLabel translate={translate} status={payment.status} />
      </span>
    </>
  );
}

/** En el móvil, la fila de un pago cobrado entera abre su recibo. */
function ListRow({
  translate,
  payment,
  receipt,
}: {
  readonly translate: Translator;
  readonly payment: PaymentView;
  readonly receipt: ReceiptRequest;
}): React.JSX.Element {
  const detailsId = useId();
  const content = (
    <ListRowContent
      translate={translate}
      payment={payment}
      detailsId={detailsId}
    />
  );
  if (payment.status !== "paid") {
    return <div className="payments-history-row">{content}</div>;
  }
  return (
    <button
      type="button"
      className="payments-history-row"
      aria-label={translate("payments.history.viewReceipt", {
        description: describePayment(translate, payment),
      })}
      aria-describedby={detailsId}
      disabled={isOpening(receipt, payment)}
      onClick={() => receipt.open(payment.id)}
    >
      {content}
    </button>
  );
}

function HistoryList({
  translate,
  groups,
  receipt,
}: {
  readonly translate: Translator;
  readonly groups: readonly PaymentMonthGroup[];
  readonly receipt: ReceiptRequest;
}): React.JSX.Element {
  return (
    <section
      className="payments-history-list"
      aria-label={translate("payments.history.byMonth")}
    >
      {groups.map((group) => (
        <div key={group.month} className="payments-history-list-month">
          <h3>{formatCalendarMonth(translate.locale, group.month)}</h3>
          <ul>
            {group.payments.map((payment) => (
              <li key={payment.id}>
                <ListRow
                  translate={translate}
                  payment={payment}
                  receipt={receipt}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function FilteredHistory({
  translate,
  titleId,
  payments,
  receipt,
}: {
  readonly translate: Translator;
  readonly titleId: string;
  readonly payments: readonly PaymentView[];
  readonly receipt: ReceiptRequest;
}): React.JSX.Element {
  if (payments.length === 0) {
    return (
      <p className="payments-history-message">
        {translate("payments.history.noMatches")}
      </p>
    );
  }
  const groups = groupPaymentsByMonth(payments);
  return (
    <>
      <HistoryTable
        translate={translate}
        titleId={titleId}
        groups={groups}
        receipt={receipt}
      />
      <HistoryList translate={translate} groups={groups} receipt={receipt} />
    </>
  );
}

export function PaymentHistory({
  translate,
  payments,
}: {
  readonly translate: Translator;
  readonly payments: readonly PaymentView[];
}): React.JSX.Element {
  const titleId = useId();
  const [filter, setFilter] = useState<PaymentHistoryFilter>("all");
  const receipt = useReceipt();
  const visiblePayments = filterPayments(payments, filter);
  const hasPayments = payments.length > 0;
  return (
    <section className="card payments-history" aria-labelledby={titleId}>
      <div className="payments-history-header">
        <h2 id={titleId}>{translate("payments.history.title")}</h2>
        {hasPayments ? (
          <HistoryToolbar
            translate={translate}
            filters={paymentHistoryFilters(payments)}
            filter={filter}
            onFilterChange={setFilter}
            onExport={() => exportCsv(visiblePayments, translate)}
          />
        ) : null}
      </div>
      {receipt.state.kind === "failed" ? (
        <p className="auth-error payments-history-message" role="alert">
          {translate("payments.history.receiptFailed")}
        </p>
      ) : null}
      {hasPayments ? (
        <FilteredHistory
          translate={translate}
          titleId={titleId}
          payments={visiblePayments}
          receipt={receipt}
        />
      ) : (
        <p className="payments-history-message">
          {translate("payments.history.empty")}
        </p>
      )}
    </section>
  );
}
