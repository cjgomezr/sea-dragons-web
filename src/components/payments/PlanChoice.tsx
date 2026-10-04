"use client";

import { useId, useState } from "react";
import { MEMBERSHIP_TYPES } from "@/lib/auth/registration";
import { formatAudCents } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { MembershipPlan } from "@/lib/membership/membership";
import type {
  MembershipPanelView,
  MembershipView,
} from "@/lib/membership/membership-view";
import {
  type PaymentsFailure,
  describePlanChoiceFailure,
  requestPlanChoice,
} from "./payments-client";

/**
 * Elegir el tipo de membresía antes del primer pago (#479, D8 del PRD de
 * E12): las tres opciones como tarjetas con su precio de Stripe (#486), la
 * guardada marcada. Elegir la guarda en el momento con
 * `PUT /api/v1/membership/plan`, y Pagos enseña la membresía que responde,
 * que es la que decide qué se ofrece debajo: Checkout o los packs.
 */

type Submission =
  | { readonly kind: "idle" }
  | { readonly kind: "sending"; readonly plan: MembershipPlan }
  | { readonly kind: "failed"; readonly failure: PaymentsFailure };

/** El precio de cada opción, o que no está disponible: nunca uno inventado. */
function describePrice(
  translate: Translator,
  plan: MembershipPlan,
  membership: MembershipPanelView,
): string {
  const priceCents =
    plan === "Casual"
      ? membership.casualSessionPriceCents
      : membership.planPrices[plan];
  if (priceCents === null) {
    return translate("payments.plan.priceUnavailable");
  }
  const price = formatAudCents(translate.locale, priceCents);
  return plan === "Casual"
    ? translate("payments.choice.sessionPrice", { price })
    : translate("payments.plan.monthlyPrice", { price });
}

function PlanOption({
  translate,
  plan,
  membership,
  checked,
  onChoose,
}: {
  readonly translate: Translator;
  readonly plan: MembershipPlan;
  readonly membership: MembershipPanelView;
  readonly checked: boolean;
  readonly onChoose: (plan: MembershipPlan) => void;
}): React.JSX.Element {
  return (
    <label className="payments-choice-option">
      <input
        type="radio"
        name="membership-plan"
        value={plan}
        checked={checked}
        onChange={() => onChoose(plan)}
      />
      {/* Los espacios separan las partes en el nombre accesible del radio:
          las líneas son bloques sólo para la vista. */}
      <span className="payments-choice-name">{plan}</span>{" "}
      <span className="payments-choice-price">
        {describePrice(translate, plan, membership)}
      </span>{" "}
      <span className="payments-choice-note">
        {translate(
          plan === "Casual" ? "payments.choice.packs" : "payments.choice.trial",
        )}
      </span>
    </label>
  );
}

function SubmissionFeedback({
  translate,
  submission,
}: {
  readonly translate: Translator;
  readonly submission: Submission;
}): React.JSX.Element | null {
  switch (submission.kind) {
    case "idle":
      return null;
    case "sending":
      return (
        <p className="payments-status" role="status">
          {translate("payments.choice.saving")}
        </p>
      );
    case "failed":
      return (
        <p className="auth-error" role="alert">
          {describePlanChoiceFailure(translate, submission.failure)}
        </p>
      );
  }
}

export function PlanChoice({
  translate,
  membership,
  onSaved,
}: {
  readonly translate: Translator;
  readonly membership: MembershipPanelView;
  /** Pagos pinta la membresía que responde el endpoint. */
  readonly onSaved: (view: MembershipView) => void;
}): React.JSX.Element {
  const [submission, setSubmission] = useState<Submission>({ kind: "idle" });
  const legendId = useId();
  const markedPlan =
    submission.kind === "sending" ? submission.plan : membership.plan;

  async function choose(plan: MembershipPlan): Promise<void> {
    if (submission.kind === "sending") {
      return;
    }
    setSubmission({ kind: "sending", plan });
    const outcome = await requestPlanChoice(plan);
    if (outcome.kind !== "saved") {
      setSubmission({ kind: "failed", failure: outcome });
      return;
    }
    setSubmission({ kind: "idle" });
    onSaved(outcome.view);
  }

  return (
    <fieldset
      className="payments-choice"
      aria-labelledby={legendId}
      aria-busy={submission.kind === "sending"}
    >
      <legend id={legendId} className="payments-eyebrow">
        {translate("payments.choice.title")}
      </legend>
      <p className="app-lead">{translate("payments.choice.hint")}</p>
      <div className="payments-choice-options">
        {MEMBERSHIP_TYPES.map((plan) => (
          <PlanOption
            key={plan}
            translate={translate}
            plan={plan}
            membership={membership}
            checked={markedPlan === plan}
            onChoose={(chosen) => void choose(chosen)}
          />
        ))}
      </div>
      <SubmissionFeedback translate={translate} submission={submission} />
    </fieldset>
  );
}
