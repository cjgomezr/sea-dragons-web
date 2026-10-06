"use client";

import type { Translator } from "@/lib/i18n/translator";
import type { MembershipPlan } from "@/lib/membership/membership";
import type { SessionBalanceView } from "@/lib/membership/membership-view";

/**
 * El saldo de sesiones en la tarjeta del plan (#472; RF-5 y RF-3 del PRD de
 * E13). A un Casual le dice cuántas le quedan, con un aviso cuando no le
 * queda ninguna (FR-065). A un Full o un Student con saldo le dice que está
 * congelado y cuándo vuelve a valer (FR-087); sin saldo, nada.
 */

function CasualBalance({
  translate,
  sessions,
}: {
  readonly translate: Translator;
  readonly sessions: number;
}): React.JSX.Element {
  const hasSessions = sessions > 0;
  return (
    <div
      className={
        hasSessions
          ? "payments-session-balance"
          : "payments-session-balance payments-session-balance-empty"
      }
    >
      <p className="payments-session-count">
        {translate("payments.sessions.left", { count: sessions })}
      </p>
      {hasSessions ? null : <p>{translate("payments.sessions.empty")}</p>}
    </div>
  );
}

function FrozenBalance({
  translate,
  sessions,
}: {
  readonly translate: Translator;
  readonly sessions: number;
}): React.JSX.Element {
  return (
    <div className="payments-session-balance">
      <p className="payments-session-count">
        {translate("payments.sessions.frozen", { count: sessions })}
      </p>
      <p>{translate("payments.sessions.frozenHint")}</p>
    </div>
  );
}

export function SessionBalanceSummary({
  translate,
  plan,
  sessionBalance,
}: {
  readonly translate: Translator;
  readonly plan: MembershipPlan | null;
  readonly sessionBalance: SessionBalanceView;
}): React.JSX.Element | null {
  const { sessions } = sessionBalance;
  if (plan === "Casual") {
    return <CasualBalance translate={translate} sessions={sessions} />;
  }
  if (plan !== null && sessions > 0) {
    return <FrozenBalance translate={translate} sessions={sessions} />;
  }
  return null;
}
