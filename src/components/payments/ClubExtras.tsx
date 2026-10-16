"use client";

import { useEffect, useId, useState } from "react";
import { useIsPhone } from "@/components/use-is-phone";
import { formatAudCents } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { LevySale } from "@/lib/membership/levy-sales";
import { ExtraDetail, useBuyersCache } from "./ExtraDetail";
import { PhoneSalesWorkspace } from "./PhoneSales";
import { type LevySalesLoad, loadLevySales } from "./payments-client";

/**
 * La pestaña Extras del club de un Admin o un Committee (#635, RF-9 del PRD
 * de E23; "Tab: Club extras" del handoff de pagos): a la izquierda la tabla
 * de los extras a la venta con lo vendido de cada uno, y debajo los cerrados
 * que vendieron algo (D5); a la derecha, el detalle del elegido. El primero
 * empieza elegido. No enseña lo recaudado (D3): para el dinero está Stripe.
 *
 * En el móvil, la lista y una hoja con el detalle (#636, `PhoneSales`).
 *
 * Lo vendido de todos llega en una sola llamada (D7), y se pide la primera
 * vez que se abre la pestaña, no al cargar Pagos.
 */

/** Por qué el endpoint dice que no hay pagos: lo mismo que
 * `paymentsConfigured: false`. */
const STRIPE_NOT_CONFIGURED = "stripe_not_configured";

type SalesState = { readonly kind: "loading" } | LevySalesLoad;

function useLevySales(): {
  readonly state: SalesState;
  readonly retry: () => void;
} {
  const [state, setState] = useState<SalesState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let isCurrent = true;
    void loadLevySales().then((outcome) => {
      if (isCurrent) {
        setState(outcome);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [attempt]);
  function retry(): void {
    setState({ kind: "loading" });
    setAttempt((count) => count + 1);
  }
  return { state, retry };
}

type Selection = {
  readonly selectedProductId: string;
  readonly onSelect: (productId: string) => void;
};

function SaleRow({
  translate,
  sale,
  selection,
}: {
  readonly translate: Translator;
  readonly sale: LevySale;
  readonly selection: Selection;
}): React.JSX.Element {
  const isSelected = sale.productId === selection.selectedProductId;
  return (
    <tr className="payments-sale-row">
      <td className="payments-sale-extra">
        {/* El botón cubre la fila entera (su `::after`): un clic en el
            precio también la elige, y el teclado tiene un control de
            verdad con Enter y Espacio. */}
        <button
          type="button"
          className="payments-sale-select"
          aria-current={isSelected ? "true" : undefined}
          onClick={() => selection.onSelect(sale.productId)}
        >
          {sale.name}
        </button>
        {sale.description === null ? null : (
          <span className="payments-sale-description">{sale.description}</span>
        )}
      </td>
      <td className="payments-sale-number">
        {formatAudCents(translate.locale, sale.amountCents)}
      </td>
      <td className="payments-sale-number">{sale.soldQuantity}</td>
    </tr>
  );
}

function SalesTable({
  translate,
  sales,
  labelledBy,
  selection,
}: {
  readonly translate: Translator;
  readonly sales: readonly LevySale[];
  readonly labelledBy: string;
  readonly selection: Selection;
}): React.JSX.Element {
  return (
    <table className="payments-sales-table" aria-labelledby={labelledBy}>
      <thead>
        <tr>
          <th scope="col">{translate("payments.levySales.column.extra")}</th>
          <th scope="col">{translate("payments.levySales.column.price")}</th>
          <th scope="col">{translate("payments.levySales.column.sold")}</th>
        </tr>
      </thead>
      <tbody>
        {sales.map((sale) => (
          <SaleRow
            key={sale.productId}
            translate={translate}
            sale={sale}
            selection={selection}
          />
        ))}
      </tbody>
    </table>
  );
}

function SalesList({
  translate,
  sales,
  selection,
}: {
  readonly translate: Translator;
  readonly sales: readonly LevySale[];
  readonly selection: Selection;
}): React.JSX.Element {
  const leadId = useId();
  const closedTitleId = useId();
  const open = sales.filter(({ status }) => status === "open");
  const closed = sales.filter(({ status }) => status === "closed");
  return (
    <div className="payments-sales-list">
      <p id={leadId} className="payments-sales-lead">
        {translate("payments.levySales.lead", { count: open.length })}
      </p>
      {open.length === 0 ? null : (
        <SalesTable
          translate={translate}
          sales={open}
          labelledBy={leadId}
          selection={selection}
        />
      )}
      {closed.length === 0 ? null : (
        <section
          className="payments-sales-closed"
          aria-labelledby={closedTitleId}
        >
          <h2 id={closedTitleId} className="payments-sales-closed-title">
            {translate("payments.levySales.closedTitle")}
          </h2>
          <SalesTable
            translate={translate}
            sales={closed}
            labelledBy={closedTitleId}
            selection={selection}
          />
        </section>
      )}
    </div>
  );
}

/** La lista y el detalle. Sin elegir nada todavía, el elegido es el primero:
 * el primero a la venta o, si no hay, el primer cerrado (el endpoint los da
 * en ese orden). */
function DesktopSalesWorkspace({
  translate,
  sales,
}: {
  readonly translate: Translator;
  readonly sales: readonly [LevySale, ...LevySale[]];
}): React.JSX.Element {
  const [chosenProductId, setChosenProductId] = useState<string | null>(null);
  const selected =
    sales.find(({ productId }) => productId === chosenProductId) ?? sales[0];
  const buyers = useBuyersCache(selected.productId);
  return (
    <div className="payments-sales">
      <SalesList
        translate={translate}
        sales={sales}
        selection={{
          selectedProductId: selected.productId,
          onSelect: setChosenProductId,
        }}
      />
      <ExtraDetail translate={translate} sale={selected} buyers={buyers} />
    </div>
  );
}

function SalesWorkspace({
  translate,
  sales,
}: {
  readonly translate: Translator;
  readonly sales: readonly [LevySale, ...LevySale[]];
}): React.JSX.Element {
  const isPhone = useIsPhone();
  return isPhone ? (
    <PhoneSalesWorkspace translate={translate} sales={sales} />
  ) : (
    <DesktopSalesWorkspace translate={translate} sales={sales} />
  );
}

function hasAnySale(
  sales: readonly LevySale[],
): sales is readonly [LevySale, ...LevySale[]] {
  return sales.length > 0;
}

function SalesFailure({
  translate,
  onRetry,
}: {
  readonly translate: Translator;
  readonly onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="admin-load-failure">
      <p className="auth-error" role="alert">
        {translate("payments.levySales.loadFailed")}
      </p>
      <button type="button" className="auth-submit" onClick={onRetry}>
        {translate("payments.levyPayers.retry")}
      </button>
    </div>
  );
}

function NotConfigured({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <p className="admin-empty">
      {translate("payments.levySales.notConfigured")}
    </p>
  );
}

function LoadedClubExtras({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  const { state, retry } = useLevySales();
  if (state.kind === "loading") {
    return (
      <p className="admin-empty" role="status">
        {translate("payments.levySales.loading")}
      </p>
    );
  }
  if (state.kind === "failed") {
    return state.reason === STRIPE_NOT_CONFIGURED ? (
      <NotConfigured translate={translate} />
    ) : (
      <SalesFailure translate={translate} onRetry={retry} />
    );
  }
  if (!hasAnySale(state.sales)) {
    return (
      <p className="admin-empty">{translate("payments.levySales.empty")}</p>
    );
  }
  return <SalesWorkspace translate={translate} sales={state.sales} />;
}

export function ClubExtras({
  translate,
  paymentsConfigured,
}: {
  readonly translate: Translator;
  /** Sin Stripe no hay extras: ni se piden. */
  readonly paymentsConfigured: boolean;
}): React.JSX.Element {
  return (
    <div className="payments-club-extras">
      {paymentsConfigured ? (
        <LoadedClubExtras translate={translate} />
      ) : (
        <NotConfigured translate={translate} />
      )}
    </div>
  );
}
