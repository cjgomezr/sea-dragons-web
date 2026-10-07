"use client";

import { useId } from "react";
import { formatClubDay } from "@/components/payments/format-club-day";
import {
  describePaymentRetryFailure,
  requestPaymentRetry,
} from "@/components/payments/payments-client";
import { StripeSessionButton } from "@/components/payments/StripeSessionButton";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * La alerta de pago fallido (#474, FR-070) arriba de toda pantalla. El
 * botón lleva a la página de Stripe de la factura abierta: allí se paga, y
 * el webhook devuelve la membresía a `active` (FR-071). Es de cliente por el
 * botón, que pide la dirección y cuenta por qué no se abrió.
 */
export function FailedPaymentNotice({
  locale,
  failedAt,
}: {
  readonly locale: Locale;
  /** ISO 8601 del último cobro fallido; nulo si todavía no consta. */
  readonly failedAt: string | null;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const titleId = useId();
  return (
    <section className="failed-payment-alert" aria-labelledby={titleId}>
      <div className="failed-payment-alert-text">
        <strong id={titleId}>{translate("failedPayment.title")}</strong>
        <p>
          {failedAt === null
            ? translate("failedPayment.undated")
            : translate("failedPayment.dated", {
                date: formatClubDay(translate, failedAt),
              })}
        </p>
      </div>
      <StripeSessionButton
        translate={translate}
        label={translate("failedPayment.retry")}
        requestSession={requestPaymentRetry}
        describeFailure={describePaymentRetryFailure}
      />
    </section>
  );
}
