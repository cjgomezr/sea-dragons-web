"use client";

import { useEffect, useState } from "react";
import type { Translator } from "@/lib/i18n/translator";
import { openCheckout } from "./checkout-navigation";
import {
  type PaymentsFailure,
  type StripeSessionOutcome,
  describeCheckoutFailure,
} from "./payments-client";

type SessionState =
  | { readonly kind: "idle" }
  | { readonly kind: "opening" }
  | { readonly kind: "failed"; readonly failure: PaymentsFailure };

/**
 * Un botón que pide una sesión de Stripe Checkout y lleva allí al socio:
 * poner la tarjeta, cambiarla o volver a suscribirse (#454, #455). Se
 * desactiva mientras abre, para que un doble toque no pida dos, y si falla
 * dice por qué y ofrece reintentar.
 */
export function StripeSessionButton({
  translate,
  label,
  requestSession,
  describeFailure = describeCheckoutFailure,
}: {
  readonly translate: Translator;
  /** Lo que dice en reposo, ya traducido: para qué abre Stripe. */
  readonly label: string;
  readonly requestSession: () => Promise<StripeSessionOutcome>;
  /** Por qué no se abrió. Sin él, los fallos de abrir Checkout. */
  readonly describeFailure?: (
    translate: Translator,
    failure: PaymentsFailure,
  ) => string;
}): React.JSX.Element {
  const [session, setSession] = useState<SessionState>({ kind: "idle" });

  // Quien vuelve de Stripe con Atrás puede recibir la página guardada en la
  // caché del navegador, con el botón aún en "Abriendo Stripe…".
  useEffect(() => {
    function resetWhenRestored(event: PageTransitionEvent): void {
      if (event.persisted) {
        setSession({ kind: "idle" });
      }
    }
    window.addEventListener("pageshow", resetWhenRestored);
    return () => window.removeEventListener("pageshow", resetWhenRestored);
  }, []);

  async function openSession(): Promise<void> {
    setSession({ kind: "opening" });
    const outcome = await requestSession();
    if (outcome.kind === "created") {
      openCheckout(outcome.url);
      return;
    }
    setSession({ kind: "failed", failure: outcome });
  }

  return (
    <>
      {session.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeFailure(translate, session.failure)}
        </p>
      ) : null}
      <button
        type="button"
        className="auth-submit"
        disabled={session.kind === "opening"}
        onClick={openSession}
      >
        {session.kind === "idle" ? label : translate(busyLabel(session))}
      </button>
    </>
  );
}

function busyLabel(
  session: Exclude<SessionState, { readonly kind: "idle" }>,
): "payments.offer.opening" | "payments.offer.retry" {
  return session.kind === "opening"
    ? "payments.offer.opening"
    : "payments.offer.retry";
}
