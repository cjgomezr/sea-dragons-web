"use client";

import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { useId, useState } from "react";
import { Icon } from "@/components/Icon";
import { BottomSheet } from "@/components/directory/BottomSheet";
import { formatAudCents } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { LevySale } from "@/lib/membership/levy-sales";
import {
  type BuyersCache,
  ExtraDetailBody,
  ExtraDetailHeader,
  useBuyersCache,
} from "./ExtraDetail";

/**
 * La pestaña Extras del club en el móvil (#636, RF-10 del PRD de E23;
 * "#2b Club extras (admin)" y "#2c Extra detail" del handoff de pagos): una
 * lista de filas y, al tocar una, su detalle en una hoja que sube desde
 * abajo sobre la lista atenuada. Nada empieza elegido: sin hoja abierta no
 * se piden compradores. Sin lo recaudado (D3).
 */

function rowIdOf(listId: string, productId: string): string {
  return `${listId}-${productId}`;
}

function PhoneSaleRow({
  translate,
  sale,
  rowId,
  onOpen,
}: {
  readonly translate: Translator;
  readonly sale: LevySale;
  readonly rowId: string;
  readonly onOpen: (productId: string) => void;
}): React.JSX.Element {
  return (
    <li>
      <button
        id={rowId}
        type="button"
        className="payments-phone-sale"
        onClick={() => onOpen(sale.productId)}
      >
        <span className="payments-phone-sale-extra">
          <span className="payments-phone-sale-name">{sale.name}</span>
          <span className="payments-phone-sale-price">
            {formatAudCents(translate.locale, sale.amountCents)}
          </span>
        </span>
        <span className="payments-phone-sale-sold">
          {translate("payments.levySales.soldCount", {
            count: sale.soldQuantity,
          })}
        </span>
        <span className="payments-phone-sale-caret">
          <Icon glyph={CaretRight} />
        </span>
      </button>
    </li>
  );
}

type RowList = {
  readonly translate: Translator;
  readonly listId: string;
  readonly onOpen: (productId: string) => void;
};

function PhoneSaleRows({
  rows,
  sales,
  labelledBy,
}: {
  readonly rows: RowList;
  readonly sales: readonly LevySale[];
  readonly labelledBy: string;
}): React.JSX.Element {
  return (
    <ul className="payments-phone-sales" aria-labelledby={labelledBy}>
      {sales.map((sale) => (
        <PhoneSaleRow
          key={sale.productId}
          translate={rows.translate}
          sale={sale}
          rowId={rowIdOf(rows.listId, sale.productId)}
          onOpen={rows.onOpen}
        />
      ))}
    </ul>
  );
}

function PhoneSalesList({
  rows,
  sales,
}: {
  readonly rows: RowList;
  readonly sales: readonly LevySale[];
}): React.JSX.Element {
  const leadId = useId();
  const closedTitleId = useId();
  const open = sales.filter(({ status }) => status === "open");
  const closed = sales.filter(({ status }) => status === "closed");
  return (
    <div className="payments-sales-list">
      <p id={leadId} className="payments-sales-lead">
        {rows.translate("payments.levySales.lead", { count: open.length })}
      </p>
      {open.length === 0 ? null : (
        <PhoneSaleRows rows={rows} sales={open} labelledBy={leadId} />
      )}
      {closed.length === 0 ? null : (
        <section
          className="payments-sales-closed"
          aria-labelledby={closedTitleId}
        >
          <h2 id={closedTitleId} className="payments-sales-closed-title">
            {rows.translate("payments.levySales.closedTitle")}
          </h2>
          <PhoneSaleRows
            rows={rows}
            sales={closed}
            labelledBy={closedTitleId}
          />
        </section>
      )}
    </div>
  );
}

function ExtraSheet({
  translate,
  sale,
  buyers,
  onClosed,
}: {
  readonly translate: Translator;
  readonly sale: LevySale;
  readonly buyers: BuyersCache;
  readonly onClosed: () => void;
}): React.JSX.Element {
  return (
    <BottomSheet
      title={(titleId) => (
        <ExtraDetailHeader translate={translate} sale={sale} nameId={titleId} />
      )}
      gripLabel={translate("payments.levySales.sheetClose")}
      onClosed={onClosed}
    >
      {() => (
        <div className="payments-sale-sheet">
          <ExtraDetailBody translate={translate} sale={sale} buyers={buyers} />
        </div>
      )}
    </BottomSheet>
  );
}

/** Devuelve el foco a la fila que abrió la hoja, si sigue en la página:
 * quien la cerró sigue donde estaba. */
function focusRow(rowId: string): void {
  const row = document.getElementById(rowId);
  if (row !== null) {
    row.focus();
  }
}

export function PhoneSalesWorkspace({
  translate,
  sales,
}: {
  readonly translate: Translator;
  readonly sales: readonly LevySale[];
}): React.JSX.Element {
  const listId = useId();
  const [openProductId, setOpenProductId] = useState<string | null>(null);
  const openSale =
    sales.find(({ productId }) => productId === openProductId) ?? null;
  const buyers = useBuyersCache(openSale?.productId ?? null);

  function closeSheet(productId: string): void {
    setOpenProductId(null);
    focusRow(rowIdOf(listId, productId));
  }

  return (
    <div className="payments-sales">
      <PhoneSalesList
        rows={{ translate, listId, onOpen: setOpenProductId }}
        sales={sales}
      />
      {openSale === null ? null : (
        <ExtraSheet
          key={openSale.productId}
          translate={translate}
          sale={openSale}
          buyers={buyers}
          onClosed={() => closeSheet(openSale.productId)}
        />
      )}
    </div>
  );
}
