"use client";

import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { formatAudCents, formatClubShortDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { LevyReturn } from "@/lib/membership/checkout-return";
import type { Levy } from "@/lib/membership/levies";
import { SINGLE_UNIT } from "@/lib/stripe/product-catalog";
import {
  type LeviesLoad,
  loadLevies,
  requestLevyCheckout,
} from "./payments-client";
import { StripeSessionButton } from "./StripeSessionButton";
import {
  type LevyReturnNotice,
  type LevyWaiting,
  NOT_WAITING_FOR_LEVY,
  initialLevyWaiting,
  useLevyWait,
} from "./use-levy-wait";

/**
 * Los extras del club en Pagos (#473, #633; RF-7 y D1 del PRD de E23): los
 * levies que el comité crea en Stripe, opcionales, en filas compactas. Cada
 * una dice qué lleva comprado el socio, el importe y Comprar, que lleva a
 * Checkout, o "✓ Comprado" si era de una unidad y ya lo compró. Los ve
 * cualquier socio, al día o no. Sin levies el apartado no se pinta; si no se
 * pudieron leer, lo dice y el resto de Pagos sigue igual. Quién compró cada
 * uno lo ve un Admin o un Committee en la pestaña Extras del club (#635).
 */

export type LeviesState = { readonly kind: "loading" } | LeviesLoad;

/** Los levies, pedidos cuando `isEnabled` (hay pagos configurados). Los
 * comparten las dos pestañas de Pagos y la cuenta de la de Extras del club
 * (#627). La primera lista decide si se espera el pago con el que el socio
 * volvió de Stripe (#692); mientras, se vuelven a pedir. */
export function useLevies(
  isEnabled: boolean,
  levyReturn: LevyReturn | null,
): { readonly state: LeviesState; readonly waiting: LevyWaiting } {
  const [state, setState] = useState<LeviesState>({ kind: "loading" });
  const [waiting, setWaiting] = useState<LevyWaiting>(NOT_WAITING_FOR_LEVY);
  const hasDecidedWaiting = useRef(false);
  useEffect(() => {
    if (!isEnabled) {
      return;
    }
    let isCurrent = true;
    void loadLevies().then((outcome) => {
      if (!isCurrent) {
        return;
      }
      setState(outcome);
      if (outcome.kind === "loaded" && !hasDecidedWaiting.current) {
        hasDecidedWaiting.current = true;
        setWaiting(initialLevyWaiting(outcome.levies, levyReturn));
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [isEnabled, levyReturn]);

  const onLoaded = useCallback(
    (levies: readonly Levy[], hasSettled: boolean) => {
      setState({ kind: "loaded", levies });
      if (hasSettled) {
        setWaiting(NOT_WAITING_FOR_LEVY);
      }
    },
    [],
  );
  const onTimeout = useCallback(
    () =>
      setWaiting((current) =>
        current.kind === "polling"
          ? { kind: "timed_out", target: current.target }
          : current,
      ),
    [],
  );
  useLevyWait(waiting, { onLoaded, onTimeout });
  return { state, waiting };
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
}: {
  readonly translate: Translator;
  readonly levy: Levy;
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
    </li>
  );
}

const NOTICE_MESSAGES = {
  waiting: "payments.levies.waiting",
  timed_out: "payments.levies.timedOut",
  cancelled: "payments.levies.cancelled",
} as const;

function LeviesBody({
  translate,
  state,
}: {
  readonly translate: Translator;
  readonly state: Exclude<LeviesState, { readonly kind: "loading" }>;
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
        <LevyItem key={levy.id} translate={translate} levy={levy} />
      ))}
    </ul>
  );
}

export function LevyCharges({
  translate,
  state,
  returnNotice,
}: {
  readonly translate: Translator;
  readonly state: LeviesState;
  /** Lo que se dice al volver de pagar un extra en Stripe (#692): sólo en Mi
   * membresía, que es donde está la compra. */
  readonly returnNotice: LevyReturnNotice | null;
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
      {returnNotice === null ? null : (
        <p className="payments-status" role="status">
          {translate(NOTICE_MESSAGES[returnNotice])}
        </p>
      )}
      <LeviesBody translate={translate} state={state} />
    </section>
  );
}
