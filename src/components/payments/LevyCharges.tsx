"use client";

import { useEffect, useId, useState } from "react";
import { formatAudCents } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { Levy } from "@/lib/membership/levies";
import {
  type LeviesLoad,
  loadLevies,
  requestLevyCheckout,
} from "./payments-client";
import { LevyPayers } from "./LevyPayers";
import { StripeSessionButton } from "./StripeSessionButton";

/**
 * Los cobros del club en Pagos (#473, RF-6 del PRD de E13, D4): los levies
 * que el comité crea en Stripe, cada uno con su importe y un botón que lleva
 * a Checkout, o "Pagado" si ya lo pagó. Los ve cualquier socio, al día o no.
 * Sin levies la sección no se pinta; si no se pudieron leer, lo dice y el
 * resto de Pagos sigue igual. A un Admin o un Committee, además, cada levy
 * le deja ver quién lo pagó y quién falta (#531).
 */

type LeviesState = { readonly kind: "loading" } | LeviesLoad;

function useLevies(): LeviesState {
  const [state, setState] = useState<LeviesState>({ kind: "loading" });
  useEffect(() => {
    let isCurrent = true;
    void loadLevies().then((outcome) => {
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
    <li className="payments-levy">
      <div className="payments-levy-details">
        <h3 id={nameId} className="payments-levy-name">
          {levy.name}
        </h3>
        {levy.description === null ? null : <p>{levy.description}</p>}
        <p className="payments-levy-price">
          {formatAudCents(translate.locale, levy.amountCents)}
        </p>
      </div>
      <div className="payments-levy-action">
        {levy.isPaid ? (
          <span className="payments-chip payments-chip-positive">
            {translate("payments.levies.paid")}
          </span>
        ) : (
          <StripeSessionButton
            translate={translate}
            label={translate("payments.levies.pay")}
            describedBy={nameId}
            requestSession={() => requestLevyCheckout(levy.id)}
          />
        )}
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
    <ul className="payments-levies">
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
  canSeePayers,
}: {
  readonly translate: Translator;
  /** Si quien mira es Admin o Committee (#531). */
  readonly canSeePayers: boolean;
}): React.JSX.Element | null {
  const titleId = useId();
  const state = useLevies();
  // Mientras carga no se reserva sitio: casi siempre no hay levies.
  if (
    state.kind === "loading" ||
    (state.kind === "loaded" && state.levies.length === 0)
  ) {
    return null;
  }
  return (
    <section className="card payments-plan-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="payments-eyebrow">
        {translate("payments.levies.title")}
      </h2>
      <p className="app-lead">{translate("payments.levies.lead")}</p>
      <LeviesBody
        translate={translate}
        state={state}
        canSeePayers={canSeePayers}
      />
    </section>
  );
}
