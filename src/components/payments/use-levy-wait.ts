"use client";

import { useEffect } from "react";
import type { LevyReturn } from "@/lib/membership/checkout-return";
import type { Levy } from "@/lib/membership/levies";
import { loadLevies } from "./payments-client";
import { POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "./use-membership-wait";

/**
 * La espera del webhook al volver de pagar un extra (#692), como la de la
 * membresía: Stripe devuelve al socio antes de que el pago se guarde, así que
 * la pantalla vuelve a pedir los extras hasta ver subir las unidades del que
 * pagó, o cansarse a los 30 s.
 */

/** El extra pagado y las unidades que tenía al abrir Checkout. */
export type LevyWaitTarget = {
  readonly productId: string;
  readonly purchasedBefore: number;
};

export type LevyWaiting =
  | { readonly kind: "none" }
  | { readonly kind: "polling"; readonly target: LevyWaitTarget }
  | { readonly kind: "timed_out"; readonly target: LevyWaitTarget };

export const NOT_WAITING_FOR_LEVY: LevyWaiting = { kind: "none" };

/** Lo que dice la sección de extras al volver de Stripe. */
export type LevyReturnNotice = "waiting" | "timed_out" | "cancelled";

export function hasLevySettled(
  target: LevyWaitTarget,
  levies: readonly Levy[],
): boolean {
  const levy = levies.find(({ productId }) => productId === target.productId);
  return levy !== undefined && levy.purchasedQuantity > target.purchasedBefore;
}

/** Qué esperar mirando la primera lista que llega. Un producto que no está
 * en ella no se espera: la dirección no dice nada que se pueda comprobar. */
export function initialLevyWaiting(
  levies: readonly Levy[],
  levyReturn: LevyReturn | null,
): LevyWaiting {
  if (levyReturn?.kind !== "paid") {
    return NOT_WAITING_FOR_LEVY;
  }
  const target: LevyWaitTarget = {
    productId: levyReturn.productId,
    purchasedBefore: levyReturn.purchasedBefore,
  };
  const isListed = levies.some(
    ({ productId }) => productId === target.productId,
  );
  if (!isListed || hasLevySettled(target, levies)) {
    return NOT_WAITING_FOR_LEVY;
  }
  return { kind: "polling", target };
}

export function levyReturnNotice(
  waiting: LevyWaiting,
  levyReturn: LevyReturn | null,
): LevyReturnNotice | null {
  if (waiting.kind === "polling") {
    return "waiting";
  }
  if (waiting.kind === "timed_out") {
    return "timed_out";
  }
  return levyReturn?.kind === "cancelled" ? "cancelled" : null;
}

/** Vuelve a pedir los extras mientras se espera. Cada lista se pinta; la que
 * trae las unidades nuevas termina la espera. Un fallo de una consulta no la
 * corta: la siguiente puede salir bien. */
export function useLevyWait(
  waiting: LevyWaiting,
  handlers: {
    readonly onLoaded: (levies: readonly Levy[], hasSettled: boolean) => void;
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
      const load = await loadLevies();
      if (isActive && load.kind === "loaded") {
        onLoaded(load.levies, hasLevySettled(target, load.levies));
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
