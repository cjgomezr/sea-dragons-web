"use client";

import { useEffect } from "react";
import type { MembershipCard } from "@/lib/membership/membership";
import type { CheckoutReturn } from "@/lib/membership/checkout-return";
import type { MembershipView } from "@/lib/membership/membership-view";
import { loadMembershipView } from "./payments-client";

/**
 * La espera del webhook al volver de Stripe (#454, #455): Stripe suele
 * mandarlo en segundos, pero puede llegar después que el socio. Mientras
 * tanto la pantalla vuelve a pedir la membresía hasta ver el cambio o
 * cansarse.
 */

/** Cada cuánto se vuelve a preguntar y hasta cuándo. */
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 30_000;

/** Lo que se espera: la suscripción del alta (deja de estar pendiente) o la
 * tarjeta nueva (deja de ser la que había al volver). */
export type WaitTarget =
  | { readonly kind: "subscription" }
  | { readonly kind: "card"; readonly previousCard: MembershipCard | null };

export type Waiting =
  | { readonly kind: "none" }
  | { readonly kind: "polling"; readonly target: WaitTarget }
  | { readonly kind: "timed_out"; readonly target: WaitTarget };

export const NOT_WAITING: Waiting = { kind: "none" };

export type StripeReturns = {
  readonly checkoutReturn: CheckoutReturn | null;
  readonly cardReturn: CheckoutReturn | null;
};

export function isPending(view: MembershipView): boolean {
  return view.membership?.status === "pending";
}

function isSameCard(
  first: MembershipCard | null,
  second: MembershipCard | null,
): boolean {
  if (first === null || second === null) {
    return first === second;
  }
  return (
    first.brand === second.brand &&
    first.last4 === second.last4 &&
    first.expMonth === second.expMonth &&
    first.expYear === second.expYear
  );
}

function hasSettled(target: WaitTarget, view: MembershipView): boolean {
  switch (target.kind) {
    case "subscription":
      return !isPending(view);
    case "card":
      return !isSameCard(target.previousCard, view.membership?.card ?? null);
  }
}

/** Qué esperar según con qué volvió el socio de Stripe, mirando la primera
 * membresía que llega. */
export function initialWaiting(
  view: MembershipView,
  returns: StripeReturns,
): Waiting {
  if (returns.checkoutReturn === "ok" && isPending(view)) {
    return { kind: "polling", target: { kind: "subscription" } };
  }
  if (returns.cardReturn === "ok") {
    return {
      kind: "polling",
      target: { kind: "card", previousCard: view.membership?.card ?? null },
    };
  }
  return NOT_WAITING;
}

/** Vuelve a pedir la membresía mientras se espera. Cada respuesta se pinta;
 * la que trae el cambio termina la espera. Un fallo de una consulta no la
 * corta: la siguiente puede salir bien. */
export function useMembershipWait(
  waiting: Waiting,
  handlers: {
    readonly onLoaded: (view: MembershipView, hasSettled: boolean) => void;
    readonly onTimeout: () => void;
  },
): void {
  const { onLoaded, onTimeout } = handlers;
  useEffect(() => {
    if (waiting.kind !== "polling") {
      return;
    }
    const { target } = waiting;
    let isActive = true;
    const interval = window.setInterval(async () => {
      const load = await loadMembershipView();
      if (isActive && load.kind === "loaded") {
        onLoaded(load.view, hasSettled(target, load.view));
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
  }, [waiting, onLoaded, onTimeout]);
}
