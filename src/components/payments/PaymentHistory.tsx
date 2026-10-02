"use client";

import { useId } from "react";
import { formatAudCents, formatCalendarDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type {
  PaymentStatus,
  PaymentView,
} from "@/lib/membership/membership-view";
import { clubCalendarDate } from "@/lib/time/club-calendar";

/**
 * El historial de pagos del mockup de Pagos (#455, RF-7 del PRD de E12,
 * FR-068): fecha, descripción, importe y estado, tal como Stripe los informó
 * y en el orden en que los sirve el endpoint, del más reciente al más
 * antiguo. En el móvil cada fila se apila como una tarjeta (ver
 * `.payments-table` en `globals.css`), así que cada celda lleva el nombre de
 * su columna.
 */

const PAYMENT_STATUS_KEYS = {
  paid: "payments.history.paid",
  failed: "payments.history.failed",
  pending: "payments.history.pending",
} as const satisfies Record<PaymentStatus, string>;

type ColumnLabels = {
  readonly date: string;
  readonly description: string;
  readonly amount: string;
  readonly status: string;
};

function PaymentRow({
  translate,
  payment,
  labels,
}: {
  readonly translate: Translator;
  readonly payment: PaymentView;
  readonly labels: ColumnLabels;
}): React.JSX.Element {
  const { locale } = translate;
  return (
    <tr>
      <td data-label={labels.date} className="payments-cell-data">
        {formatCalendarDay(locale, clubCalendarDate(new Date(payment.date)))}
      </td>
      <td data-label={labels.description}>
        {payment.description ??
          translate("payments.history.defaultDescription")}
      </td>
      <td data-label={labels.amount} className="payments-cell-data">
        {formatAudCents(locale, payment.amountCents)}
      </td>
      <td data-label={labels.status}>
        <span className={`payments-payment-status-${payment.status}`}>
          {translate(PAYMENT_STATUS_KEYS[payment.status])}
        </span>
      </td>
    </tr>
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
  const labels: ColumnLabels = {
    date: translate("payments.history.date"),
    description: translate("payments.history.description"),
    amount: translate("payments.history.amount"),
    status: translate("payments.history.status"),
  };
  return (
    <section className="card payments-history" aria-labelledby={titleId}>
      <h2 id={titleId}>{translate("payments.history.title")}</h2>
      {payments.length === 0 ? (
        <p>{translate("payments.history.empty")}</p>
      ) : (
        <table className="payments-table" aria-labelledby={titleId}>
          <thead>
            <tr>
              <th scope="col">{labels.date}</th>
              <th scope="col">{labels.description}</th>
              <th scope="col">{labels.amount}</th>
              <th scope="col">{labels.status}</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <PaymentRow
                key={payment.id}
                translate={translate}
                payment={payment}
                labels={labels}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
