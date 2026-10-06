"use client";

import { useEffect, useId, useState } from "react";
import type { SessionPackOffers } from "@/lib/club/session-packs";
import { formatAudCents } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { CheckoutReturn } from "@/lib/membership/checkout-return";
import type { ClubPrice } from "@/lib/membership/stripe-prices";
import {
  type SessionPackOffersLoad,
  loadSessionPackOffers,
  requestSessionPackCheckout,
} from "./payments-client";
import { StripeSessionButton } from "./StripeSessionButton";
import type { Waiting } from "./use-membership-wait";

/**
 * Los packs de sesiones de un Casual en Pagos (#471, RF-5 del PRD de E13):
 * un botón por cada pack que el club ofrece (#469), con sus sesiones y su
 * precio, que lleva a Stripe Checkout. Al volver, dice qué pasa con el pago
 * mientras el webhook no llega. El saldo y sus movimientos son de otro
 * ticket.
 */

type PacksState = { readonly kind: "loading" } | SessionPackOffersLoad;

function useSessionPackOffers(): PacksState {
  const [state, setState] = useState<PacksState>({ kind: "loading" });
  useEffect(() => {
    let isCurrent = true;
    void loadSessionPackOffers().then((outcome) => {
      if (isCurrent) {
        setState(outcome);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, []);
  return state;
}

/** El precio lo calcula el endpoint desde Stripe (#486); si no lo da, se
 * dice en vez de inventarlo. */
function describePrice(translate: Translator, price: ClubPrice): string {
  return price.amountCents === null
    ? translate("payments.plan.priceUnavailable")
    : formatAudCents(translate.locale, price.amountCents);
}

function PackButtons({
  translate,
  packs,
}: {
  readonly translate: Translator;
  readonly packs: SessionPackOffers;
}): React.JSX.Element {
  return (
    <ul className="payments-packs">
      {packs.map((pack) => (
        <li key={pack.sessions}>
          <StripeSessionButton
            translate={translate}
            label={translate("payments.packs.buy", {
              pack: translate("clubSettings.sessionPacks.pack", {
                count: pack.sessions,
              }),
              price: describePrice(translate, pack.price),
            })}
            requestSession={() => requestSessionPackCheckout(pack.sessions)}
          />
        </li>
      ))}
    </ul>
  );
}

function PacksBody({
  translate,
  state,
}: {
  readonly translate: Translator;
  readonly state: PacksState;
}): React.JSX.Element {
  switch (state.kind) {
    case "loading":
      return <p role="status">{translate("payments.packs.loading")}</p>;
    case "loaded":
      return <PackButtons translate={translate} packs={state.packs} />;
    case "failed":
      return (
        <p className="auth-error" role="alert">
          {translate("payments.packs.loadFailed")}
        </p>
      );
  }
}

function isWaitingForPack(waiting: Waiting): boolean {
  return waiting.kind !== "none" && waiting.target.kind === "pack";
}

/** Lo que se dice al volver de Checkout: mientras el webhook no llega, la
 * espera; después, que las sesiones se suman al confirmar, o que salió sin
 * comprar. */
function PackReturnStatus({
  translate,
  waiting,
  packReturn,
}: {
  readonly translate: Translator;
  readonly waiting: Waiting;
  readonly packReturn: CheckoutReturn | null;
}): React.JSX.Element | null {
  if (isWaitingForPack(waiting)) {
    return (
      <p className="payments-status" role="status">
        {translate(
          waiting.kind === "polling"
            ? "payments.packs.waiting"
            : "payments.checkout.timedOut",
        )}
      </p>
    );
  }
  if (packReturn === null) {
    return null;
  }
  return (
    <p className="payments-status" role="status">
      {translate(
        packReturn === "ok"
          ? "payments.packs.paid"
          : "payments.packs.cancelled",
      )}
    </p>
  );
}

export function SessionPackOffer({
  translate,
  waiting,
  packReturn,
}: {
  readonly translate: Translator;
  readonly waiting: Waiting;
  readonly packReturn: CheckoutReturn | null;
}): React.JSX.Element {
  const titleId = useId();
  const state = useSessionPackOffers();
  return (
    <section className="card payments-plan-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="payments-eyebrow">
        {translate("payments.packs.title")}
      </h2>
      <p className="app-lead">{translate("payments.packs.lead")}</p>
      <PackReturnStatus
        translate={translate}
        waiting={waiting}
        packReturn={packReturn}
      />
      {/* Mientras se espera el pago no se ofrece comprar otro. */}
      {isWaitingForPack(waiting) && waiting.kind === "polling" ? null : (
        <PacksBody translate={translate} state={state} />
      )}
    </section>
  );
}
