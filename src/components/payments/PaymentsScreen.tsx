"use client";

import { useCallback, useEffect, useState } from "react";
import { MembershipNotice } from "@/components/MembershipNotice";
import { formatAudCents, formatCalendarDay } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import type { CheckoutReturn } from "@/lib/membership/checkout-return";
import {
  MONTHLY_PRICE_CENTS,
  type MembershipStatus,
  type RecurringPlan,
  membershipBlockOfStatus,
} from "@/lib/membership/membership";
import type { MembershipView } from "@/lib/membership/membership-view";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import { openCheckout } from "./checkout-navigation";
import {
  type PaymentsFailure,
  describeCheckoutFailure,
  loadMembershipView,
  requestCheckout,
} from "./payments-client";

/**
 * Pagos (#454, RF-3 del PRD de E12): a quien no ha puesto tarjeta le explica
 * su plan y el mes de prueba y lo lleva a Stripe Checkout; al volver, espera
 * a que el webhook (#452) confirme y enseña la prueba. El panel completo, con
 * tarjeta e historial, es #455.
 *
 * Es de cliente por el botón y por la espera: al volver de Checkout el
 * webhook puede no haber llegado, así que vuelve a pedir la membresía a
 * `GET /api/v1/membership` durante un rato.
 */

/** Cada cuánto se vuelve a preguntar y hasta cuándo: Stripe suele mandar el
 * webhook en segundos. */
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 30_000;

type Waiting = "none" | "polling" | "timed_out";

type CheckoutState =
  | { readonly kind: "idle" }
  | { readonly kind: "opening" }
  | { readonly kind: "failed"; readonly failure: PaymentsFailure };

function isRecurringPlan(plan: string | null): plan is RecurringPlan {
  return plan === "Full" || plan === "Student";
}

function initialWaiting(
  view: MembershipView,
  checkoutReturn: CheckoutReturn | null,
): Waiting {
  return checkoutReturn === "ok" && view.membership?.status === "pending"
    ? "polling"
    : "none";
}

/** Vuelve a pedir la membresía hasta que deja de estar pendiente o se acaba
 * el tiempo. Un fallo de una consulta no corta la espera: la siguiente puede
 * salir bien. */
function useWebhookWait(
  waiting: Waiting,
  onSettled: (view: MembershipView) => void,
  onTimeout: () => void,
): void {
  useEffect(() => {
    if (waiting !== "polling") {
      return;
    }
    let isActive = true;
    const interval = window.setInterval(async () => {
      const load = await loadMembershipView();
      if (isActive && load.kind === "loaded" && !isPending(load.view)) {
        onSettled(load.view);
      }
    }, POLL_INTERVAL_MS);
    const timeout = window.setTimeout(() => {
      if (isActive) {
        onTimeout();
      }
    }, POLL_TIMEOUT_MS);
    return () => {
      isActive = false;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [waiting, onSettled, onTimeout]);
}

function isPending(view: MembershipView): boolean {
  return view.membership?.status === "pending";
}

function TrialLine({
  translate,
  trialEnd,
}: {
  readonly translate: Translator;
  readonly trialEnd: string;
}): React.JSX.Element {
  const date = formatCalendarDay(
    translate.locale,
    clubCalendarDate(new Date(trialEnd)),
  );
  return (
    <p className="payments-trial">{translate("payments.trialing", { date })}</p>
  );
}

function CheckoutOffer({
  translate,
  plan,
  hasHadTrial,
}: {
  readonly translate: Translator;
  readonly plan: RecurringPlan;
  readonly hasHadTrial: boolean;
}): React.JSX.Element {
  const [checkout, setCheckout] = useState<CheckoutState>({ kind: "idle" });
  const isOpening = checkout.kind === "opening";

  // Quien vuelve de Stripe con Atrás puede recibir la página guardada en la
  // caché del navegador, con el botón aún en "Abriendo Stripe…".
  useEffect(() => {
    function resetWhenRestored(event: PageTransitionEvent): void {
      if (event.persisted) {
        setCheckout({ kind: "idle" });
      }
    }
    window.addEventListener("pageshow", resetWhenRestored);
    return () => window.removeEventListener("pageshow", resetWhenRestored);
  }, []);

  async function startCheckout(): Promise<void> {
    setCheckout({ kind: "opening" });
    const outcome = await requestCheckout();
    if (outcome.kind === "created") {
      openCheckout(outcome.url);
      return;
    }
    setCheckout({ kind: "failed", failure: outcome });
  }

  return (
    <section className="payments-offer">
      <p className="payments-plan">
        {translate("payments.offer.plan", {
          plan,
          price: formatAudCents(translate.locale, MONTHLY_PRICE_CENTS[plan]),
        })}
      </p>
      <p>
        {translate(
          hasHadTrial ? "payments.offer.noTrial" : "payments.offer.trial",
        )}
      </p>
      <p className="app-lead">{translate("payments.offer.stripe")}</p>
      {checkout.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeCheckoutFailure(translate, checkout.failure)}
        </p>
      ) : null}
      <button
        type="button"
        className="auth-submit"
        disabled={isOpening}
        onClick={startCheckout}
      >
        {translate(offerButtonLabel(checkout))}
      </button>
    </section>
  );
}

function offerButtonLabel(
  checkout: CheckoutState,
):
  "payments.offer.opening" | "payments.offer.retry" | "payments.offer.addCard" {
  switch (checkout.kind) {
    case "opening":
      return "payments.offer.opening";
    case "failed":
      return "payments.offer.retry";
    case "idle":
      return "payments.offer.addCard";
  }
}

/** Lo que se ofrece a quien no ha puesto tarjeta, según su plan y si los
 * pagos están configurados (RF-9). */
function PendingContent({
  translate,
  view,
  waiting,
  checkoutReturn,
}: {
  readonly translate: Translator;
  readonly view: MembershipView;
  readonly waiting: Waiting;
  readonly checkoutReturn: CheckoutReturn | null;
}): React.JSX.Element | null {
  if (waiting !== "none") {
    return (
      <p className="payments-status" role="status">
        {translate(
          waiting === "polling"
            ? "payments.checkout.waiting"
            : "payments.checkout.timedOut",
        )}
      </p>
    );
  }
  const { membership } = view;
  if (membership === null) {
    return null;
  }
  const { plan } = membership;
  if (plan === "Casual") {
    return <p>{translate("payments.offer.casual")}</p>;
  }
  if (!isRecurringPlan(plan)) {
    return null;
  }
  if (!view.paymentsConfigured) {
    return <p>{translate("payments.offer.notConfigured")}</p>;
  }
  return (
    <>
      {checkoutReturn === "cancelado" ? (
        <p className="payments-status" role="status">
          {translate("payments.checkout.cancelled")}
        </p>
      ) : null}
      <CheckoutOffer
        translate={translate}
        plan={plan}
        hasHadTrial={membership.trialEnd !== null}
      />
    </>
  );
}

function statusOf(view: MembershipView): MembershipStatus {
  return view.membership?.status ?? "pending";
}

export function PaymentsScreen({
  locale,
  initialView,
  checkoutReturn,
}: {
  readonly locale: Locale;
  readonly initialView: MembershipView;
  readonly checkoutReturn: CheckoutReturn | null;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [view, setView] = useState(initialView);
  const [waiting, setWaiting] = useState<Waiting>(() =>
    initialWaiting(initialView, checkoutReturn),
  );
  const settle = useCallback((settled: MembershipView) => {
    setView(settled);
    setWaiting("none");
  }, []);
  const timeOut = useCallback(() => setWaiting("timed_out"), []);
  useWebhookWait(waiting, settle, timeOut);

  const status = statusOf(view);
  const block = membershipBlockOfStatus(status);
  const trialEnd = view.membership?.trialEnd ?? null;
  return (
    <>
      <h1>{translate("nav.label.payments")}</h1>
      {status === "trialing" && trialEnd !== null ? (
        <TrialLine translate={translate} trialEnd={trialEnd} />
      ) : null}
      {status === "pending" ? null : (
        <p className="app-lead">{translate("section.underConstruction")}</p>
      )}
      {block === null ? null : (
        <div className="payments-pending">
          <MembershipNotice
            translate={translate}
            block={block}
            linksToPayments={false}
          />
          {status === "pending" ? (
            <PendingContent
              translate={translate}
              view={view}
              waiting={waiting}
              checkoutReturn={checkoutReturn}
            />
          ) : null}
        </div>
      )}
    </>
  );
}
