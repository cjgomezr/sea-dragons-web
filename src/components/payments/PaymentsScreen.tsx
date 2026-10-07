"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MembershipNotice } from "@/components/MembershipNotice";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import type { CheckoutReturn } from "@/lib/membership/checkout-return";
import { membershipBlockOfStatus } from "@/lib/membership/membership";
import type { MembershipView } from "@/lib/membership/membership-view";
import { LevyCharges } from "./LevyCharges";
import { PaymentHistory } from "./PaymentHistory";
import {
  type PaymentsFailure,
  describeLoadFailure,
  loadMembershipView,
} from "./payments-client";
import { PlanCard } from "./PlanCard";
import { SessionActivity } from "./SessionActivity";
import { SessionPackOffer } from "./SessionPackOffer";
import {
  NOT_WAITING,
  type StripeReturns,
  type Waiting,
  initialWaiting,
  useMembershipWait,
} from "./use-membership-wait";

/**
 * Pagos (#454, #455, #456, #479; RF-3, RF-5, RF-6 y RF-7 del PRD de E12):
 * el panel de la membresía del mockup con el plan, su estado, la tarjeta y
 * el historial; el saldo de sesiones de un Casual y sus movimientos (#472);
 * la elección de plan y el alta en Stripe Checkout de quien aún no puso
 * tarjeta; el cambio de plan; y la espera del webhook al volver de Stripe.
 *
 * Es de cliente por los botones y por la espera: la membresía se pide a
 * `GET /api/v1/membership`, el mismo endpoint que leerá la aplicación nativa
 * (CON-002), y se vuelve a pedir mientras el webhook no ha llegado.
 */

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: PaymentsFailure }
  | { readonly kind: "ready"; readonly view: MembershipView };

/** La membresía, pedida al montar, con cada reintento y tras cambiar de
 * plan. La primera que llega decide qué se espera de Stripe. */
function useMembershipLoad(returns: StripeReturns): {
  readonly state: LoadState;
  readonly waiting: Waiting;
  readonly retry: () => void;
  /** La vuelve a pedir sin quitar de la pantalla la que hay. */
  readonly refresh: () => void;
  /** Pinta la que respondió un endpoint que la cambió. */
  readonly replace: (view: MembershipView) => void;
} {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [waiting, setWaiting] = useState<Waiting>(NOT_WAITING);
  const [reloads, setReloads] = useState(0);
  const hasDecidedWaiting = useRef(false);
  const { checkoutReturn, cardReturn, packReturn } = returns;

  useEffect(() => {
    let isCurrent = true;
    void loadMembershipView().then((outcome) => {
      if (!isCurrent) {
        return;
      }
      if (outcome.kind !== "loaded") {
        setState({ kind: "failed", failure: outcome });
        return;
      }
      setState({ kind: "ready", view: outcome.view });
      if (!hasDecidedWaiting.current) {
        hasDecidedWaiting.current = true;
        setWaiting(
          initialWaiting(outcome.view, {
            checkoutReturn,
            cardReturn,
            packReturn,
          }),
        );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [reloads, checkoutReturn, cardReturn, packReturn]);

  const onLoaded = useCallback((view: MembershipView, hasSettled: boolean) => {
    setState({ kind: "ready", view });
    if (hasSettled) {
      setWaiting(NOT_WAITING);
    }
  }, []);
  const onTimeout = useCallback(
    () =>
      setWaiting((current) =>
        current.kind === "polling"
          ? { kind: "timed_out", target: current.target }
          : current,
      ),
    [],
  );
  useMembershipWait(waiting, { onLoaded, onTimeout });

  function refresh(): void {
    setReloads((count) => count + 1);
  }

  function retry(): void {
    setState({ kind: "loading" });
    refresh();
  }

  function replace(view: MembershipView): void {
    setState({ kind: "ready", view });
  }

  return { state, waiting, retry, refresh, replace };
}

function LoadFailure({
  translate,
  failure,
  onRetry,
}: {
  readonly translate: Translator;
  readonly failure: PaymentsFailure;
  readonly onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="admin-load-failure">
      <p className="auth-error" role="alert">
        {describeLoadFailure(translate, failure)}
      </p>
      <button type="button" className="auth-submit" onClick={onRetry}>
        {translate("payments.load.retry")}
      </button>
    </div>
  );
}

/** Lo que se dice al volver de cambiar la tarjeta en Stripe. */
function CardReturnStatus({
  translate,
  waiting,
  cardReturn,
}: {
  readonly translate: Translator;
  readonly waiting: Waiting;
  readonly cardReturn: CheckoutReturn | null;
}): React.JSX.Element | null {
  if (waiting.kind !== "none" && waiting.target.kind === "card") {
    return (
      <p className="payments-status" role="status">
        {translate(
          waiting.kind === "polling"
            ? "payments.card.waiting"
            : "payments.card.timedOut",
        )}
      </p>
    );
  }
  if (cardReturn === "cancelado") {
    return (
      <p className="payments-status" role="status">
        {translate("payments.card.cancelled")}
      </p>
    );
  }
  return null;
}

function MembershipPanel({
  translate,
  view,
  waiting,
  returns,
  onViewReplaced,
  onPlanChanged,
  canSeeLevyPayers,
}: {
  readonly translate: Translator;
  readonly view: MembershipView;
  readonly waiting: Waiting;
  readonly returns: StripeReturns;
  readonly canSeeLevyPayers: boolean;
  readonly onViewReplaced: (view: MembershipView) => void;
  readonly onPlanChanged: () => void;
}): React.JSX.Element {
  const { membership } = view;
  // Sin membresía, el socio está como quien todavía no puso tarjeta.
  const block =
    membership === null
      ? "pending"
      : membershipBlockOfStatus(membership.status);
  return (
    <div className="payments-panel">
      {block === null ? null : (
        <MembershipNotice
          translate={translate}
          block={block}
          linksToPayments={false}
        />
      )}
      <CardReturnStatus
        translate={translate}
        waiting={waiting}
        cardReturn={returns.cardReturn}
      />
      {membership === null ? null : (
        <PlanCard
          translate={translate}
          view={view}
          membership={membership}
          waiting={waiting}
          checkoutReturn={returns.checkoutReturn}
          onViewReplaced={onViewReplaced}
          onPlanChanged={onPlanChanged}
        />
      )}
      {membership?.plan === "Casual" && view.paymentsConfigured ? (
        <SessionPackOffer
          translate={translate}
          waiting={waiting}
          packReturn={returns.packReturn}
        />
      ) : null}
      {view.paymentsConfigured ? (
        <LevyCharges translate={translate} canSeePayers={canSeeLevyPayers} />
      ) : null}
      {membership?.plan === "Casual" ? (
        <SessionActivity
          translate={translate}
          movements={view.sessionBalance.movements}
        />
      ) : null}
      <PaymentHistory translate={translate} payments={view.payments} />
    </div>
  );
}

export function PaymentsScreen({
  locale,
  checkoutReturn,
  cardReturn,
  packReturn,
  canSeeLevyPayers,
}: {
  readonly locale: Locale;
  readonly checkoutReturn: CheckoutReturn | null;
  readonly cardReturn: CheckoutReturn | null;
  readonly packReturn: CheckoutReturn | null;
  /** Si quien mira puede ver quién pagó cada levy (#531): lo decide el
   * servidor con el rol de la sesión, y el endpoint lo vuelve a exigir. */
  readonly canSeeLevyPayers: boolean;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const { state, waiting, retry, refresh, replace } = useMembershipLoad({
    checkoutReturn,
    cardReturn,
    packReturn,
  });
  return (
    <>
      <h1>{translate("nav.label.payments")}</h1>
      {state.kind === "loading" ? (
        <p className="admin-empty" role="status">
          {translate("payments.loading")}
        </p>
      ) : null}
      {state.kind === "failed" ? (
        <LoadFailure
          translate={translate}
          failure={state.failure}
          onRetry={retry}
        />
      ) : null}
      {state.kind === "ready" ? (
        <MembershipPanel
          translate={translate}
          view={state.view}
          waiting={waiting}
          returns={{ checkoutReturn, cardReturn, packReturn }}
          onViewReplaced={replace}
          onPlanChanged={refresh}
          canSeeLevyPayers={canSeeLevyPayers}
        />
      ) : null}
    </>
  );
}
