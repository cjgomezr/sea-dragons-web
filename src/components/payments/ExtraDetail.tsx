"use client";

import { DownloadSimple } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { MemberAvatar } from "@/components/MemberAvatar";
import { saveFile } from "@/components/save-file";
import { formatAudCents, formatClubShortDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import {
  levyPayersCsv,
  levyPayersCsvFilename,
} from "@/lib/membership/levy-payers-csv";
import type { LevyBuyer, LevySale } from "@/lib/membership/levy-sales";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import { type LevyBuyersLoad, loadLevyBuyers } from "./payments-client";

/**
 * El detalle del extra elegido en la pestaña Extras del club (#635, RF-9 del
 * PRD de E23): nombre, precio, lo vendido, quién compró y el CSV. Sin cifras
 * de dinero agregadas (D3) ni lista de faltantes (D1). Los compradores se
 * piden al elegir el extra y se guardan por extra (D7): volver a uno ya visto
 * no los vuelve a pedir. Un fallo no se guarda como respuesta: Reintentar lo
 * vuelve a pedir.
 */

const CSV_TYPE = "text/csv;charset=utf-8";

/** En píxeles: el CSS de `.payments-buyer-avatar` dice lo mismo. */
const BUYER_AVATAR_SIZE = 28;

type BuyersState = { readonly kind: "loading" } | LevyBuyersLoad;

const LOADING: BuyersState = { kind: "loading" };

export type BuyersCache = {
  readonly stateOf: (productId: string) => BuyersState;
  readonly retry: (productId: string) => void;
};

/** Los compradores de cada extra ya elegido, pedidos una sola vez. Vive en
 * la pestaña y no en el panel para que cambiar de extra no lo vacíe. */
export function useBuyersCache(selectedProductId: string): BuyersCache {
  const [loads, setLoads] = useState<ReadonlyMap<string, LevyBuyersLoad>>(
    () => new Map(),
  );
  const [attempt, setAttempt] = useState(0);
  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (requested.current.has(selectedProductId)) {
      return;
    }
    requested.current.add(selectedProductId);
    void loadLevyBuyers(selectedProductId).then((outcome) => {
      setLoads((current) => new Map(current).set(selectedProductId, outcome));
    });
  }, [selectedProductId, attempt]);

  function retry(productId: string): void {
    requested.current.delete(productId);
    setLoads((current) => {
      const next = new Map(current);
      next.delete(productId);
      return next;
    });
    setAttempt((count) => count + 1);
  }

  return {
    stateOf: (productId) => loads.get(productId) ?? LOADING,
    retry,
  };
}

function exportCsv(
  translate: Translator,
  sale: LevySale,
  buyers: readonly LevyBuyer[],
): void {
  saveFile(
    new Blob([levyPayersCsv(buyers, translate)], { type: CSV_TYPE }),
    levyPayersCsvFilename({
      levyName: sale.name,
      todayInClub: clubCalendarDate(new Date()),
      translate,
    }),
  );
}

function SaleTiles({
  translate,
  sale,
}: {
  readonly translate: Translator;
  readonly sale: LevySale;
}): React.JSX.Element {
  const tiles = [
    ["payments.levyPayers.sold", sale.soldQuantity],
    ["payments.levyPayers.buyers", sale.buyerCount],
  ] as const;
  return (
    <dl className="payments-sale-tiles">
      {tiles.map(([label, value]) => (
        <div key={label} className="payments-sale-tile">
          <dt>{translate(label)}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function BuyerItem({
  translate,
  buyer,
}: {
  readonly translate: Translator;
  readonly buyer: LevyBuyer;
}): React.JSX.Element {
  return (
    <li className="payments-buyer">
      <MemberAvatar
        fullName={buyer.fullName}
        photoUrl={null}
        size={BUYER_AVATAR_SIZE}
        className="payments-buyer-avatar"
      />
      <span className="payments-buyer-name">{buyer.fullName}</span>
      {buyer.quantity > 1 ? (
        <span className="payments-buyer-units">
          {translate("payments.levyPayers.units", { count: buyer.quantity })}
        </span>
      ) : null}
      <span className="payments-buyer-date">
        {formatClubShortDay(translate.locale, new Date(buyer.paidAt))}
      </span>
    </li>
  );
}

function BuyersBody({
  translate,
  state,
  titleId,
  onRetry,
}: {
  readonly translate: Translator;
  readonly state: BuyersState;
  readonly titleId: string;
  readonly onRetry: () => void;
}): React.JSX.Element {
  if (state.kind === "loading") {
    return <p role="status">{translate("payments.levyPayers.loading")}</p>;
  }
  if (state.kind === "failed") {
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
  if (state.buyers.length === 0) {
    return <p>{translate("payments.levyPayers.noPayments")}</p>;
  }
  return (
    // Enfocable porque puede tener scroll: sin ratón, las flechas lo mueven.
    <ul className="payments-buyers" aria-labelledby={titleId} tabIndex={0}>
      {state.buyers.map((buyer) => (
        <BuyerItem
          key={`${buyer.userId}-${buyer.paidAt}`}
          translate={translate}
          buyer={buyer}
        />
      ))}
    </ul>
  );
}

export function ExtraDetail({
  translate,
  sale,
  buyers,
}: {
  readonly translate: Translator;
  readonly sale: LevySale;
  readonly buyers: BuyersCache;
}): React.JSX.Element {
  const nameId = useId();
  const buyersTitleId = useId();
  const state = buyers.stateOf(sale.productId);
  const loadedBuyers = state.kind === "loaded" ? state.buyers : [];
  return (
    <section className="payments-sale-detail" aria-labelledby={nameId}>
      <div className="payments-sale-detail-header">
        <h2 id={nameId} className="payments-sale-detail-name">
          {sale.name}
        </h2>
        {sale.description === null ? null : (
          <p className="payments-sale-detail-description">{sale.description}</p>
        )}
        <p className="payments-sale-detail-price">
          {formatAudCents(translate.locale, sale.amountCents)}
        </p>
      </div>
      <SaleTiles translate={translate} sale={sale} />
      <div className="payments-buyers-group">
        <h3 id={buyersTitleId} className="payments-buyers-title">
          {translate("payments.levyPayers.buyers")}
        </h3>
        <BuyersBody
          translate={translate}
          state={state}
          titleId={buyersTitleId}
          onRetry={() => buyers.retry(sale.productId)}
        />
      </div>
      <button
        type="button"
        className="admin-secondary payments-sale-export"
        disabled={loadedBuyers.length === 0}
        onClick={() => exportCsv(translate, sale, loadedBuyers)}
      >
        <Icon glyph={DownloadSimple} />
        <span>{translate("payments.levyPayers.export")}</span>
      </button>
    </section>
  );
}
