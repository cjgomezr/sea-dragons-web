"use client";

import { useSearchParams } from "next/navigation";
import { useRef } from "react";
import type { Translator } from "@/lib/i18n/translator";
import {
  PAYMENTS_TABS,
  PAYMENTS_TAB_QUERY_PARAM,
  type PaymentsTab,
  readPaymentsTab,
  searchWithPaymentsTab,
} from "./payments-tab";

/**
 * La barra de pestañas de Pagos (#627): Mi membresía | Extras del club, con
 * cuántos extras hay a la venta. Sólo la ve un Admin o un Committee. En el
 * escritorio es una barra subrayada y en el móvil un control segmentado; lo
 * decide el CSS.
 *
 * La pestaña vive en la dirección. Se cambia con `pushState`, que el router
 * de Next.js sigue desde `useSearchParams`: así no se pide la página otra vez
 * y el atrás del navegador vuelve a la pestaña anterior.
 */

const OTHER_TAB: Readonly<Record<PaymentsTab, PaymentsTab>> = {
  membership: "extras",
  extras: "membership",
};

/** La pestaña a la que lleva cada tecla. Con dos, las flechas dan la vuelta
 * siempre hacia la otra. */
function tabForKey(key: string, current: PaymentsTab): PaymentsTab | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowLeft":
      return OTHER_TAB[current];
    case "Home":
      return "membership";
    case "End":
      return "extras";
    default:
      return null;
  }
}

export function paymentsTabId(idPrefix: string, tab: PaymentsTab): string {
  return `${idPrefix}-pestana-${tab}`;
}

export function paymentsPanelId(idPrefix: string, tab: PaymentsTab): string {
  return `${idPrefix}-panel-${tab}`;
}

/** La pestaña que dice la dirección y cómo cambiarla. */
export function usePaymentsTab(): {
  readonly activeTab: PaymentsTab;
  readonly selectTab: (tab: PaymentsTab) => void;
} {
  const searchParams = useSearchParams();
  const activeTab = readPaymentsTab(searchParams.get(PAYMENTS_TAB_QUERY_PARAM));
  function selectTab(tab: PaymentsTab): void {
    if (tab === activeTab) {
      return;
    }
    const search = searchWithPaymentsTab(searchParams, tab);
    window.history.pushState(null, "", `${window.location.pathname}${search}`);
  }
  return { activeTab, selectTab };
}

function ExtrasCount({
  translate,
  count,
}: {
  readonly translate: Translator;
  readonly count: number;
}): React.JSX.Element | null {
  if (count === 0) {
    return null;
  }
  return (
    <>
      {" "}
      <span className="payments-tab-badge" aria-hidden="true">
        {count}
      </span>
      <span className="visually-hidden">
        {translate("payments.tabs.extrasForSale", { count })}
      </span>
    </>
  );
}

export function PaymentsTabs({
  translate,
  idPrefix,
  activeTab,
  extrasForSale,
  onSelect,
}: {
  readonly translate: Translator;
  readonly idPrefix: string;
  readonly activeTab: PaymentsTab;
  /** Los extras que lista `GET /api/v1/levies`; 0 mientras no llegan. */
  readonly extrasForSale: number;
  readonly onSelect: (tab: PaymentsTab) => void;
}): React.JSX.Element {
  const tabRefs = useRef<Partial<Record<PaymentsTab, HTMLButtonElement>>>({});

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const next = tabForKey(event.key, activeTab);
    if (next === null) {
      return;
    }
    event.preventDefault();
    onSelect(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div
      className="payments-tabs"
      role="tablist"
      aria-label={translate("payments.tabs.label")}
      onKeyDown={handleKeyDown}
    >
      {PAYMENTS_TABS.map((tab) => {
        const isActive = tab === activeTab;
        return (
          <button
            key={tab}
            ref={(element) => {
              tabRefs.current[tab] = element ?? undefined;
            }}
            type="button"
            role="tab"
            id={paymentsTabId(idPrefix, tab)}
            className="payments-tab"
            aria-selected={isActive}
            aria-controls={paymentsPanelId(idPrefix, tab)}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(tab)}
          >
            {translate(`payments.tabs.${tab}`)}
            {tab === "extras" ? (
              <ExtrasCount translate={translate} count={extrasForSale} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
