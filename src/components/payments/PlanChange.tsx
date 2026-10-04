"use client";

import { useEffect, useId, useState } from "react";
import { MEMBERSHIP_TYPES } from "@/lib/auth/registration";
import { formatAudCents } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { MembershipPlan } from "@/lib/membership/membership";
import type {
  MembershipPanelView,
  PlanPrices,
  ScheduledPlanChangeView,
} from "@/lib/membership/membership-view";
import { openCheckout } from "./checkout-navigation";
import { formatClubDay } from "./format-club-day";
import {
  type PaymentsFailure,
  describePlanChangeFailure,
  requestPlanChange,
  requestPlanChangeCancellation,
} from "./payments-client";

/**
 * Cambiar de plan desde Pagos (#456, RF-6 del PRD de E12, D5): elegir otro
 * plan y confirmarlo, o ver el cambio programado y anularlo. El botón se
 * desactiva mientras la petición va, para que un doble toque mande una sola;
 * si Stripe no contesta, lo dice y ofrece reintentar. Cuando el cambio sale
 * bien, Pagos vuelve a leer la membresía, que es quien lo enseña.
 */

type Submission =
  | { readonly kind: "idle" }
  | { readonly kind: "sending" }
  | { readonly kind: "failed"; readonly failure: PaymentsFailure };

const IDLE: Submission = { kind: "idle" };

/** El botón dice que guarda mientras va, y que se puede reintentar si
 * falló. */
function submitLabel(
  translate: Translator,
  submission: Submission,
  idleLabel: string,
): string {
  switch (submission.kind) {
    case "idle":
      return idleLabel;
    case "sending":
      return translate("payments.planChange.saving");
    case "failed":
      return translate("payments.planChange.retry");
  }
}

function SubmissionError({
  translate,
  submission,
}: {
  readonly translate: Translator;
  readonly submission: Submission;
}): React.JSX.Element | null {
  if (submission.kind !== "failed") {
    return null;
  }
  return (
    <p className="auth-error" role="alert">
      {describePlanChangeFailure(translate, submission.failure)}
    </p>
  );
}

/** El precio sale de Stripe (#486); sin él, la opción lo dice en vez de
 * inventar un importe. */
function describeOption(
  translate: Translator,
  plan: MembershipPlan,
  planPrices: PlanPrices,
): string {
  if (plan === "Casual") {
    return translate("payments.planChange.casualOption");
  }
  const priceCents = planPrices[plan];
  if (priceCents === null) {
    return translate("payments.planChange.recurringOptionPriceUnavailable", {
      plan,
    });
  }
  return translate("payments.planChange.recurringOption", {
    plan,
    price: formatAudCents(translate.locale, priceCents),
  });
}

function describeScheduledChange(
  translate: Translator,
  change: ScheduledPlanChangeView,
): string {
  const date = formatClubDay(translate, change.effectiveAt);
  return change.plan === "Casual"
    ? translate("payments.planChange.scheduledCasual", { date })
    : translate("payments.planChange.scheduled", { plan: change.plan, date });
}

function ScheduledChange({
  translate,
  change,
  onChanged,
}: {
  readonly translate: Translator;
  readonly change: ScheduledPlanChangeView;
  readonly onChanged: () => void;
}): React.JSX.Element {
  const [submission, setSubmission] = useState<Submission>(IDLE);

  async function cancelChange(): Promise<void> {
    setSubmission({ kind: "sending" });
    const outcome = await requestPlanChangeCancellation();
    if (outcome.kind === "failed") {
      setSubmission({ kind: "failed", failure: outcome });
      return;
    }
    onChanged();
  }

  return (
    <>
      <p className="payments-status" role="status">
        {describeScheduledChange(translate, change)}
      </p>
      <SubmissionError translate={translate} submission={submission} />
      <div className="payments-plan-actions">
        <button
          type="button"
          className="auth-secondary"
          disabled={submission.kind === "sending"}
          onClick={cancelChange}
        >
          {submitLabel(
            translate,
            submission,
            translate("payments.planChange.cancel"),
          )}
        </button>
      </div>
    </>
  );
}

function PlanPicker({
  translate,
  currentPlan,
  planPrices,
  onChanged,
}: {
  readonly translate: Translator;
  readonly currentPlan: MembershipPlan | null;
  readonly planPrices: PlanPrices;
  readonly onChanged: () => void;
}): React.JSX.Element {
  const [chosen, setChosen] = useState<MembershipPlan | null>(null);
  const [submission, setSubmission] = useState<Submission>(IDLE);
  const legendId = useId();
  const options = MEMBERSHIP_TYPES.filter((plan) => plan !== currentPlan);

  // Quien vuelve de Checkout con Atrás puede recibir la página guardada en
  // la caché del navegador, con el botón aún en "Guardando…".
  useEffect(() => {
    function resetWhenRestored(event: PageTransitionEvent): void {
      if (event.persisted) {
        setSubmission(IDLE);
      }
    }
    window.addEventListener("pageshow", resetWhenRestored);
    return () => window.removeEventListener("pageshow", resetWhenRestored);
  }, []);

  async function confirmChange(plan: MembershipPlan): Promise<void> {
    setSubmission({ kind: "sending" });
    const outcome = await requestPlanChange(plan);
    switch (outcome.kind) {
      case "failed":
        setSubmission({ kind: "failed", failure: outcome });
        return;
      case "checkout":
        openCheckout(outcome.url);
        return;
      case "scheduled":
        onChanged();
    }
  }

  return (
    <fieldset className="payments-plan-picker" aria-labelledby={legendId}>
      <legend id={legendId} className="payments-eyebrow">
        {translate("payments.planChange.title")}
      </legend>
      <p className="app-lead">
        {translate(
          currentPlan === "Casual"
            ? "payments.planChange.casualHint"
            : "payments.planChange.hint",
        )}
      </p>
      <div className="payments-plan-options">
        {options.map((plan) => (
          <label key={plan} className="payments-plan-option">
            <input
              type="radio"
              name="plan"
              value={plan}
              checked={chosen === plan}
              onChange={() => setChosen(plan)}
            />
            {describeOption(translate, plan, planPrices)}
          </label>
        ))}
      </div>
      <SubmissionError translate={translate} submission={submission} />
      <div className="payments-plan-actions">
        <button
          type="button"
          className="auth-submit"
          disabled={chosen === null || submission.kind === "sending"}
          onClick={() => {
            if (chosen !== null) {
              void confirmChange(chosen);
            }
          }}
        >
          {submitLabel(
            translate,
            submission,
            translate("payments.planChange.confirm"),
          )}
        </button>
      </div>
    </fieldset>
  );
}

/** El cambio programado o el selector, según la membresía; nada si no
 * puede cambiar de plan. */
export function PlanChange({
  translate,
  membership,
  onChanged,
}: {
  readonly translate: Translator;
  readonly membership: MembershipPanelView;
  readonly onChanged: () => void;
}): React.JSX.Element | null {
  if (membership.scheduledChange === null && !membership.canChangePlan) {
    return null;
  }
  return (
    <div className="payments-plan-change">
      {membership.scheduledChange === null ? (
        <PlanPicker
          translate={translate}
          currentPlan={membership.plan}
          planPrices={membership.planPrices}
          onChanged={onChanged}
        />
      ) : (
        <ScheduledChange
          translate={translate}
          change={membership.scheduledChange}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
