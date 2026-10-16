"use client";

import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { useEffect, useId, useState } from "react";
import { Icon } from "@/components/Icon";
import { formatAudCents, formatClubShortDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { Levy } from "@/lib/membership/levies";
import { SINGLE_UNIT } from "@/lib/stripe/product-catalog";
import {
  type LeviesLoad,
  loadLevies,
  requestLevyCheckout,
} from "./payments-client";
import { LevyPayers } from "./LevyPayers";
import { StripeSessionButton } from "./StripeSessionButton";

/**
 * Los extras del club en Pagos (#473, #633; RF-7 y D1 del PRD de E23): los
 * levies que el comité crea en Stripe, opcionales, en filas compactas. Cada
 * una dice qué lleva comprado el socio, el importe y Comprar, que lleva a
 * Checkout, o "✓ Comprado" si era de una unidad y ya lo compró. Los ve
 * cualquier socio, al día o no. Sin levies el apartado no se pinta; si no se
 * pudieron leer, lo dice y el resto de Pagos sigue igual. A un Admin o un
 * Committee, además, cada levy le deja ver quién lo pagó (#531).
 */

export type LeviesState = { readonly kind: "loading" } | LeviesLoad;

/** Los levies, pedidos una vez cuando `isEnabled` (hay pagos configurados).
 * Los comparten las dos pestañas de Pagos y la cuenta de la de Extras del
 * club (#627). */
export function useLevies(isEnabled: boolean): LeviesState {
  const [state, setState] = useState<LeviesState>({ kind: "loading" });
  useEffect(() => {
    if (!isEnabled) {
      return;
    }
    let isCurrent = true;
    void loadLevies().then((outcome) => {
      if (isCurrent) {
        setState(outcome);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [isEnabled]);
  return state;
}

/** Cuántos extras hay a la venta: 0 mientras cargan o si fallaron. */
export function countLeviesForSale(state: LeviesState): number {
  return state.kind === "loaded" ? state.levies.length : 0;
}

/** Lo que lleva comprado: la fecha de un extra de una unidad, o cuántas de
 * uno de varias. Vacío si no compró nada. */
function describePurchase(translate: Translator, levy: Levy): string | null {
  if (levy.lastPurchasedAt === null) {
    return null;
  }
  return levy.maxQuantity === SINGLE_UNIT
    ? translate("payments.levies.boughtOn", {
        date: formatClubShortDay(
          translate.locale,
          new Date(levy.lastPurchasedAt),
        ),
      })
    : translate("payments.levies.boughtCount", {
        count: levy.purchasedQuantity,
      });
}

/** Un extra de una unidad ya comprado no se vuelve a comprar; uno de varias
 * sigue a la venta (D2). */
function canBuyMore(levy: Levy): boolean {
  return !levy.isPaid || levy.maxQuantity > SINGLE_UNIT;
}

function LevyAction({
  translate,
  levy,
  nameId,
}: {
  readonly translate: Translator;
  readonly levy: Levy;
  readonly nameId: string;
}): React.JSX.Element {
  if (!canBuyMore(levy)) {
    return (
      <span className="payments-extra-bought-mark">
        <Icon glyph={CheckCircle} />
        <span>{translate("payments.levies.paid")}</span>
      </span>
    );
  }
  return (
    <StripeSessionButton
      translate={translate}
      label={translate("payments.levies.pay")}
      describedBy={nameId}
      requestSession={() => requestLevyCheckout(levy.id)}
    />
  );
}

function LevyItem({
  translate,
  levy,
  canSeePayers,
}: {
  readonly translate: Translator;
  readonly levy: Levy;
  readonly canSeePayers: boolean;
}): React.JSX.Element {
  const nameId = useId();
  return (
    <li className="payments-extra">
      <div className="payments-extra-main">
        <h3 id={nameId} className="payments-extra-name">
          {levy.name}
        </h3>
        {levy.description === null ? null : (
          <p className="payments-extra-description">{levy.description}</p>
        )}
      </div>
      <p className="payments-extra-purchase">
        {describePurchase(translate, levy)}
      </p>
      <p className="payments-extra-price">
        {formatAudCents(translate.locale, levy.amountCents)}
      </p>
      <div className="payments-extra-action">
        <LevyAction translate={translate} levy={levy} nameId={nameId} />
      </div>
      {canSeePayers ? (
        <LevyPayers
          translate={translate}
          priceId={levy.id}
          levyNameId={nameId}
        />
      ) : null}
    </li>
  );
}

function LeviesBody({
  translate,
  state,
  canSeePayers,
}: {
  readonly translate: Translator;
  readonly state: Exclude<LeviesState, { readonly kind: "loading" }>;
  readonly canSeePayers: boolean;
}): React.JSX.Element {
  if (state.kind === "failed") {
    return (
      <p className="auth-error" role="alert">
        {translate("payments.levies.loadFailed")}
      </p>
    );
  }
  return (
    <ul className="payments-extras-list">
      {state.levies.map((levy) => (
        <LevyItem
          key={levy.id}
          translate={translate}
          levy={levy}
          canSeePayers={canSeePayers}
        />
      ))}
    </ul>
  );
}

export function LevyCharges({
  translate,
  state,
  canSeePayers,
}: {
  readonly translate: Translator;
  readonly state: LeviesState;
  /** Si se enseña quién pagó cada levy: sólo en la pestaña Extras del club
   * de un Admin o un Committee (#531, #627). */
  readonly canSeePayers: boolean;
}): React.JSX.Element | null {
  const titleId = useId();
  // Mientras carga no se reserva sitio: casi siempre no hay levies.
  if (
    state.kind === "loading" ||
    (state.kind === "loaded" && state.levies.length === 0)
  ) {
    return null;
  }
  return (
    <section className="payments-extras" aria-labelledby={titleId}>
      <div className="payments-extras-header">
        <h2 id={titleId} className="payments-extras-title">
          {translate("payments.levies.title")}
        </h2>
        <p className="payments-extras-hint">
          {translate("payments.levies.lead")}
        </p>
      </div>
      <LeviesBody
        translate={translate}
        state={state}
        canSeePayers={canSeePayers}
      />
    </section>
  );
}
