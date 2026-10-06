"use client";

import { useId } from "react";
import { formatCalendarDay, formatNumber } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { SessionMovementView } from "@/lib/membership/membership-view";
import { formatClubDay } from "./format-club-day";

/**
 * Los movimientos del saldo de un Casual en Pagos (#472, RF-5 del PRD de
 * E13): cada pack comprado y cada entrenamiento que gastó una sesión, del
 * más reciente al más antiguo, con la forma de la tabla del historial de
 * pagos (también se apila en el móvil, ver `.payments-table`).
 */

type ColumnLabels = {
  readonly date: string;
  readonly movement: string;
  readonly sessions: string;
};

function describeMovement(
  translate: Translator,
  movement: SessionMovementView,
): string {
  if (movement.kind === "pack_purchase") {
    return translate("payments.sessions.activity.pack", {
      count: movement.sessions,
    });
  }
  if (movement.training === null) {
    return translate("payments.sessions.activity.trainingUnavailable");
  }
  return translate("payments.sessions.activity.training", {
    date: formatCalendarDay(translate.locale, movement.training.startsOn),
    title: movement.training.title,
  });
}

/** Una compra suma y se escribe con su signo; un descuento ya lo trae. */
function formatSessionDelta(translate: Translator, sessions: number): string {
  const amount = formatNumber(translate.locale, sessions);
  return sessions > 0 ? `+${amount}` : amount;
}

function MovementRow({
  translate,
  movement,
  labels,
}: {
  readonly translate: Translator;
  readonly movement: SessionMovementView;
  readonly labels: ColumnLabels;
}): React.JSX.Element {
  return (
    <tr>
      <td data-label={labels.date} className="payments-cell-data">
        {formatClubDay(translate, movement.date)}
      </td>
      <td data-label={labels.movement}>
        {describeMovement(translate, movement)}
      </td>
      <td data-label={labels.sessions} className="payments-cell-data">
        {formatSessionDelta(translate, movement.sessions)}
      </td>
    </tr>
  );
}

export function SessionActivity({
  translate,
  movements,
}: {
  readonly translate: Translator;
  readonly movements: readonly SessionMovementView[];
}): React.JSX.Element {
  const titleId = useId();
  const labels: ColumnLabels = {
    date: translate("payments.sessions.activity.date"),
    movement: translate("payments.sessions.activity.movement"),
    sessions: translate("payments.sessions.activity.sessions"),
  };
  return (
    <section className="card payments-history" aria-labelledby={titleId}>
      <h2 id={titleId}>{translate("payments.sessions.activity.title")}</h2>
      {movements.length === 0 ? (
        <p>{translate("payments.sessions.activity.empty")}</p>
      ) : (
        <table className="payments-table" aria-labelledby={titleId}>
          <thead>
            <tr>
              <th scope="col">{labels.date}</th>
              <th scope="col">{labels.movement}</th>
              <th scope="col">{labels.sessions}</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((movement) => (
              <MovementRow
                key={movement.id}
                translate={translate}
                movement={movement}
                labels={labels}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
