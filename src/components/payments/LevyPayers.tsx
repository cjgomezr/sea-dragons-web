"use client";

import { useEffect, useId, useState } from "react";
import { saveFile } from "@/components/save-file";
import { formatAudCents, formatCalendarDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { LevyPayersReport } from "@/lib/membership/levy-payers";
import {
  levyPayersCsv,
  levyPayersCsvFilename,
} from "@/lib/membership/levy-payers-csv";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import { type LevyPayersLoad, loadLevyPayers } from "./payments-client";

/**
 * Quién pagó un levy y quién falta (#531), desplegado bajo el levy. Sólo lo
 * pinta la pantalla de un Admin o un Committee, y el endpoint responde 403 a
 * los demás. La lista se pide al abrirla, no al cargar Pagos: casi nadie la
 * mira. El CSV se arma con la lista que se está viendo, sin otra petición.
 */

const CSV_TYPE = "text/csv;charset=utf-8";

type PayersState = { readonly kind: "loading" } | LevyPayersLoad;

/** La lista, pedida al abrirse y con cada reintento. */
function useLevyPayers(priceId: string): {
  readonly state: PayersState;
  readonly retry: () => void;
} {
  const [state, setState] = useState<PayersState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let isCurrent = true;
    void loadLevyPayers(priceId).then((outcome) => {
      if (isCurrent) {
        setState(outcome);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [priceId, attempt]);
  function retry(): void {
    setState({ kind: "loading" });
    setAttempt((count) => count + 1);
  }
  return { state, retry };
}

function exportCsv(report: LevyPayersReport, translate: Translator): void {
  const csv = levyPayersCsv(report, translate);
  saveFile(
    new Blob([csv], { type: CSV_TYPE }),
    levyPayersCsvFilename({
      levyName: report.levy.name,
      todayInClub: clubCalendarDate(new Date()),
      translate,
    }),
  );
}

function PayersSummary({
  translate,
  summary,
}: {
  readonly translate: Translator;
  readonly summary: LevyPayersReport["summary"];
}): React.JSX.Element {
  const items = [
    ["payments.levyPayers.summary.paid", String(summary.paidCount)],
    ["payments.levyPayers.summary.missing", String(summary.missingCount)],
    [
      "payments.levyPayers.summary.collected",
      formatAudCents(translate.locale, summary.collectedCents),
    ],
  ] as const;
  return (
    <ul
      className="payments-levy-summary"
      aria-label={translate("payments.levyPayers.summary.title")}
    >
      {items.map(([label, value]) => (
        <li key={label}>
          <span className="payments-levy-summary-label">
            {translate(label)}
          </span>{" "}
          <span className="payments-levy-summary-value">{value}</span>
        </li>
      ))}
    </ul>
  );
}

function PaidTable({
  translate,
  payers,
}: {
  readonly translate: Translator;
  readonly payers: LevyPayersReport["payers"];
}): React.JSX.Element {
  const titleId = useId();
  const { locale } = translate;
  const labels = {
    name: translate("payments.levyPayers.column.name"),
    date: translate("payments.levyPayers.column.date"),
    amount: translate("payments.levyPayers.column.amount"),
  };
  return (
    <div className="payments-levy-group">
      <h4 id={titleId}>{translate("payments.levyPayers.paidTitle")}</h4>
      {payers.length === 0 ? (
        <p>{translate("payments.levyPayers.noPayments")}</p>
      ) : (
        <table className="payments-table" aria-labelledby={titleId}>
          <thead>
            <tr>
              <th scope="col">{labels.name}</th>
              <th scope="col">{labels.date}</th>
              <th scope="col">{labels.amount}</th>
            </tr>
          </thead>
          <tbody>
            {payers.map((payer) => (
              <tr key={payer.userId}>
                <td data-label={labels.name} className="payments-levy-payer">
                  {payer.fullName}
                </td>
                <td data-label={labels.date} className="payments-cell-data">
                  {formatCalendarDay(
                    locale,
                    clubCalendarDate(new Date(payer.paidAt)),
                  )}
                </td>
                <td data-label={labels.amount} className="payments-cell-data">
                  {formatAudCents(locale, payer.amountCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MissingList({
  translate,
  missing,
}: {
  readonly translate: Translator;
  readonly missing: LevyPayersReport["missing"];
}): React.JSX.Element {
  const titleId = useId();
  return (
    <div className="payments-levy-group">
      <h4 id={titleId}>{translate("payments.levyPayers.missingTitle")}</h4>
      {missing.length === 0 ? (
        <p>{translate("payments.levyPayers.noneMissing")}</p>
      ) : (
        <ul className="payments-levy-missing" aria-labelledby={titleId}>
          {missing.map((member) => (
            <li key={member.userId}>{member.fullName}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PayersBody({
  translate,
  state,
  onRetry,
}: {
  readonly translate: Translator;
  readonly state: PayersState;
  readonly onRetry: () => void;
}): React.JSX.Element {
  if (state.kind === "loading") {
    return <p role="status">{translate("payments.levyPayers.loading")}</p>;
  }
  if (state.kind !== "loaded") {
    return (
      <div className="payments-levy-action">
        <p className="auth-error" role="alert">
          {translate("payments.levyPayers.loadFailed")}
        </p>
        <button type="button" className="admin-secondary" onClick={onRetry}>
          {translate("payments.levyPayers.retry")}
        </button>
      </div>
    );
  }
  const { report } = state;
  return (
    <>
      <PayersSummary translate={translate} summary={report.summary} />
      <PaidTable translate={translate} payers={report.payers} />
      <MissingList translate={translate} missing={report.missing} />
      <button
        type="button"
        className="admin-secondary payments-levy-export"
        onClick={() => exportCsv(report, translate)}
      >
        {translate("payments.levyPayers.export")}
      </button>
    </>
  );
}

function PayersPanel({
  translate,
  priceId,
  panelId,
  labelledBy,
}: {
  readonly translate: Translator;
  readonly priceId: string;
  readonly panelId: string;
  readonly labelledBy: string;
}): React.JSX.Element {
  const { state, retry } = useLevyPayers(priceId);
  return (
    <section
      id={panelId}
      className="payments-levy-payers"
      aria-labelledby={labelledBy}
    >
      <PayersBody translate={translate} state={state} onRetry={retry} />
    </section>
  );
}

export function LevyPayers({
  translate,
  priceId,
  levyNameId,
}: {
  readonly translate: Translator;
  readonly priceId: string;
  /** El título del levy: describe el botón y nombra la lista. */
  readonly levyNameId: string;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const toggleId = useId();
  const panelId = useId();
  return (
    <div className="payments-levy-payers-open">
      <button
        type="button"
        id={toggleId}
        className="admin-secondary"
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-describedby={levyNameId}
        onClick={() => setIsOpen((wasOpen) => !wasOpen)}
      >
        {translate("payments.levyPayers.toggle")}
      </button>
      {isOpen ? (
        <PayersPanel
          translate={translate}
          priceId={priceId}
          panelId={panelId}
          labelledBy={`${toggleId} ${levyNameId}`}
        />
      ) : null}
    </div>
  );
}
