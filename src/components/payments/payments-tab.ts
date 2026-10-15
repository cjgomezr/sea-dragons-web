/**
 * La pestaña de Pagos (#627) y cómo va en la dirección: Mi membresía no
 * lleva parámetro y Extras del club es `?tab=extras`. Ante un valor que no
 * se conoce, la pestaña es Mi membresía. Quien no puede ver quién pagó cada
 * levy no tiene pestañas: la dirección no se le lee.
 */

export const PAYMENTS_TABS = ["membership", "extras"] as const;

export type PaymentsTab = (typeof PAYMENTS_TABS)[number];

export const PAYMENTS_TAB_QUERY_PARAM = "tab";

const EXTRAS_QUERY_VALUE = "extras";

export function readPaymentsTab(queryValue: string | null): PaymentsTab {
  return queryValue === EXTRAS_QUERY_VALUE ? "extras" : "membership";
}

/** La búsqueda de la dirección con `tab`, sin tocar los demás parámetros
 * (los de vuelta de Stripe). Vacía si no queda ninguno. */
export function searchWithPaymentsTab(
  current: URLSearchParams,
  tab: PaymentsTab,
): string {
  const next = new URLSearchParams(current);
  if (tab === "extras") {
    next.set(PAYMENTS_TAB_QUERY_PARAM, EXTRAS_QUERY_VALUE);
  } else {
    next.delete(PAYMENTS_TAB_QUERY_PARAM);
  }
  const search = next.toString();
  return search === "" ? "" : `?${search}`;
}
