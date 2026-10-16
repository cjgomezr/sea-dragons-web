import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentsScreen } from "@/components/payments/PaymentsScreen";
import type { Locale } from "@/lib/i18n/locale";
import type {
  CheckoutReturn,
  LevyReturn,
} from "@/lib/membership/checkout-return";
import type { MembershipView } from "@/lib/membership/membership-view";
import { visit } from "../../support/location-search-params";

/**
 * Las pestañas de Pagos (#627, RF-1 del PRD de E23): Mi membresía para todos
 * y Extras del club sólo para Admin y Committee, con la pestaña en `?tab=`.
 * Los endpoints van doblados con `fetch` y la dirección es la de jsdom.
 */

vi.mock(
  "next/navigation",
  async () => await import("../../support/location-search-params"),
);

const MEMBERSHIP_PATH = "/api/v1/membership";
const LEVIES_PATH = "/api/v1/levies";
const SALES_PATH = "/api/v1/levies/sales";
const MEMBERSHIP_TAB = /^(My membership|Mi membresía)$/;
const EXTRAS_TAB = /^(Club extras|Extras del club)/;
const HISTORY_HEADING = /^(Payment history|Historial de pagos)$/;

const ACTIVE_FULL: MembershipView = {
  paymentsConfigured: true,
  membership: {
    plan: "Full",
    status: "active",
    monthlyPriceCents: 4500,
    trialEnd: null,
    nextChargeAt: "2026-11-01T09:00:00.000Z",
    card: { brand: "visa", last4: "4242", expMonth: 8, expYear: 2028 },
    waiver: null,
    scheduledChange: null,
    canChangePlan: false,
    planPrices: { Full: 4500, Student: 3675 },
    canChoosePlan: false,
    casualSessionPriceCents: null,
    subscriptionEndsAt: null,
  },
  payments: [],
  sessionBalance: { sessions: 0, movements: [] },
};

function levy(id: string, name: string): object {
  return {
    id,
    productId: id.replace("price_", "prod_"),
    name,
    description: null,
    amountCents: 8000,
    maxQuantity: 1,
    purchasedQuantity: 0,
    lastPurchasedAt: null,
    isPaid: false,
  };
}

const THREE_LEVIES = [
  levy("price_nationals", "Nationals 2026"),
  levy("price_camp", "Winter camp"),
  levy("price_pool", "Extra pool hire"),
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(
  levies: readonly object[] = THREE_LEVIES,
): ReturnType<typeof vi.fn> {
  const fetchDouble = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === MEMBERSHIP_PATH) {
      return jsonResponse({ data: ACTIVE_FULL });
    }
    if (path === LEVIES_PATH) {
      return jsonResponse({ data: { levies } });
    }
    if (path === SALES_PATH) {
      return jsonResponse({ data: { sales: [] } });
    }
    throw new Error(`petición inesperada a ${path}`);
  });
  vi.stubGlobal("fetch", fetchDouble);
  return fetchDouble;
}

type RenderOptions = {
  readonly canSeeLevyPayers: boolean;
  readonly locale?: Locale;
  readonly cardReturn?: CheckoutReturn | null;
  readonly levyReturn?: LevyReturn | null;
};

async function renderLoaded(options: RenderOptions): Promise<void> {
  render(
    <PaymentsScreen
      locale={options.locale ?? "en"}
      checkoutReturn={null}
      cardReturn={options.cardReturn ?? null}
      packReturn={null}
      levyReturn={options.levyReturn ?? null}
      canSeeLevyPayers={options.canSeeLevyPayers}
    />,
  );
  await screen.findByRole("heading", { level: 1 });
  await waitFor(() =>
    expect(
      screen
        .getAllByRole("button", { hidden: true })
        .some((button) => /^(Buy|Comprar)$/.test(button.textContent ?? "")),
    ).toBe(true),
  );
}

function salesRequests(fetchDouble: ReturnType<typeof vi.fn>): number {
  return fetchDouble.mock.calls.filter(
    ([input]) => String(input) === SALES_PATH,
  ).length;
}

function membershipTab(): HTMLElement {
  return screen.getByRole("tab", { name: MEMBERSHIP_TAB });
}

function extrasTab(): HTMLElement {
  return screen.getByRole("tab", { name: EXTRAS_TAB });
}

beforeEach(() => {
  visit("/pagos");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PaymentsScreen: pestañas de un Admin o un Committee (#627)", () => {
  it("pinta el título y las dos pestañas con Mi membresía activa", async () => {
    stubFetch();
    await renderLoaded({ canSeeLevyPayers: true });

    expect(
      screen.getByRole("heading", { level: 1, name: "Payments" }),
    ).toBeInTheDocument();
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "My membership",
      expect.stringMatching(/^Club extras/),
    ]);
    expect(membershipTab()).toHaveAttribute("aria-selected", "true");
    expect(extrasTab()).toHaveAttribute("aria-selected", "false");
  });

  it("dice el título y las pestañas en español", async () => {
    stubFetch();
    await renderLoaded({ canSeeLevyPayers: true, locale: "es" });

    expect(
      screen.getByRole("heading", { level: 1, name: "Pagos" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Mi membresía" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Extras del club 3 a la venta" }),
    ).toBeInTheDocument();
  });

  it("cuenta en la pestaña Extras del club los extras a la venta", async () => {
    stubFetch(THREE_LEVIES);
    await renderLoaded({ canSeeLevyPayers: true });

    expect(
      await screen.findByRole("tab", { name: "Club extras 3 for sale" }),
    ).toBeInTheDocument();
  });

  it("no lleva insignia si no hay extras a la venta", async () => {
    const fetchDouble = stubFetch([]);
    render(
      <PaymentsScreen
        locale="en"
        checkoutReturn={null}
        cardReturn={null}
        packReturn={null}
        levyReturn={null}
        canSeeLevyPayers
      />,
    );

    await screen.findByRole("heading", { level: 2, name: HISTORY_HEADING });
    await waitFor(() =>
      expect(
        fetchDouble.mock.calls.some(([input]) => String(input) === LEVIES_PATH),
      ).toBe(true),
    );
    expect(extrasTab()).toHaveAccessibleName("Club extras");
  });

  it("al pulsar Extras del club pone ?tab=extras y enseña su panel", async () => {
    stubFetch();
    await renderLoaded({ canSeeLevyPayers: true });

    await userEvent.click(extrasTab());

    expect(window.location.search).toBe("?tab=extras");
    expect(extrasTab()).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName(EXTRAS_TAB);
  });

  it("al volver a Mi membresía quita el parámetro", async () => {
    stubFetch();
    visit("/pagos?tab=extras");
    await renderLoaded({ canSeeLevyPayers: true });

    await userEvent.click(membershipTab());

    expect(window.location.search).toBe("");
    expect(membershipTab()).toHaveAttribute("aria-selected", "true");
  });

  it("el atrás del navegador devuelve la pestaña anterior", async () => {
    stubFetch();
    await renderLoaded({ canSeeLevyPayers: true });
    await userEvent.click(extrasTab());

    await act(async () => {
      window.history.back();
      await new Promise((resolve) =>
        window.addEventListener("popstate", resolve, { once: true }),
      );
    });

    expect(window.location.search).toBe("");
    expect(membershipTab()).toHaveAttribute("aria-selected", "true");
  });

  it("abre en Extras del club si la dirección trae ?tab=extras", async () => {
    stubFetch();
    visit("/pagos?tab=extras");
    await renderLoaded({ canSeeLevyPayers: true });

    expect(extrasTab()).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName(EXTRAS_TAB);
  });

  it("abre en Mi membresía con un valor desconocido", async () => {
    stubFetch();
    visit("/pagos?tab=foo");
    await renderLoaded({ canSeeLevyPayers: true });

    expect(membershipTab()).toHaveAttribute("aria-selected", "true");
  });

  it("Extras del club enseña lo vendido de los extras del club", async () => {
    const fetchDouble = stubFetch();
    visit("/pagos?tab=extras");
    await renderLoaded({ canSeeLevyPayers: true });

    const panel = screen.getByRole("tabpanel");
    expect(
      await within(panel).findByText(/committee creates them in Stripe/),
    ).toBeInTheDocument();
    expect(salesRequests(fetchDouble)).toBe(1);
  });

  it("Mi membresía enseña el plan, los levies y el historial, sin lo vendido", async () => {
    stubFetch();
    await renderLoaded({ canSeeLevyPayers: true });

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAccessibleName("My membership");
    expect(
      within(panel).getByRole("region", { name: "Current plan" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", {
        name: "Buy",
        description: "Nationals 2026",
      }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("heading", { level: 2, name: HISTORY_HEADING }),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole("table")).not.toBeInTheDocument();
  });

  it("las flechas mueven entre pestañas y se llevan el foco", async () => {
    stubFetch();
    await renderLoaded({ canSeeLevyPayers: true });
    membershipTab().focus();

    await userEvent.keyboard("{ArrowRight}");

    expect(extrasTab()).toHaveFocus();
    expect(extrasTab()).toHaveAttribute("aria-selected", "true");
    expect(window.location.search).toBe("?tab=extras");

    await userEvent.keyboard("{ArrowLeft}");

    expect(membershipTab()).toHaveFocus();
    expect(membershipTab()).toHaveAttribute("aria-selected", "true");
  });

  it("sólo la pestaña activa entra en el orden del tabulador", async () => {
    stubFetch();
    await renderLoaded({ canSeeLevyPayers: true });

    expect(membershipTab()).toHaveAttribute("tabindex", "0");
    expect(extrasTab()).toHaveAttribute("tabindex", "-1");
  });

  it("el aviso de vuelta de Stripe sigue al cambiar de pestaña y conserva su parámetro", async () => {
    stubFetch();
    visit("/pagos?tarjeta=cancelado");
    await renderLoaded({ canSeeLevyPayers: true, cardReturn: "cancelado" });
    expect(
      within(screen.getByRole("tabpanel")).getByRole("status"),
    ).toHaveTextContent("without changing your card");

    await userEvent.click(extrasTab());
    expect(window.location.search).toBe("?tarjeta=cancelado&tab=extras");
    await userEvent.click(membershipTab());

    expect(window.location.search).toBe("?tarjeta=cancelado");
    expect(
      within(screen.getByRole("tabpanel")).getByRole("status"),
    ).toHaveTextContent("without changing your card");
  });

  it("la espera de un extra pagado sale en Mi membresía y no en Extras del club (#692)", async () => {
    stubFetch();
    const search = "?levy=ok&extra=prod_nationals&antes=0";
    visit(`/pagos${search}`);
    await renderLoaded({
      canSeeLevyPayers: true,
      levyReturn: {
        kind: "paid",
        productId: "prod_nationals",
        purchasedBefore: 0,
      },
    });
    expect(
      within(screen.getByRole("tabpanel")).getByRole("status"),
    ).toHaveTextContent("We're waiting for Stripe");

    await userEvent.click(extrasTab());

    expect(window.location.search).toBe(`${search}&tab=extras`);
    expect(
      within(screen.getByRole("tabpanel")).queryByRole("status"),
    ).not.toBeInTheDocument();

    await userEvent.click(membershipTab());

    expect(
      within(screen.getByRole("tabpanel")).getByRole("status"),
    ).toHaveTextContent("We're waiting for Stripe");
  });
});

describe("PaymentsScreen: sin permiso para ver quién pagó (#627)", () => {
  it("no hay barra de pestañas y se ve Mi membresía", async () => {
    stubFetch();
    await renderLoaded({ canSeeLevyPayers: false });

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Current plan" }),
    ).toBeInTheDocument();
  });

  it("con ?tab=extras ve Mi membresía y no pide lo vendido", async () => {
    const fetchDouble = stubFetch();
    visit("/pagos?tab=extras");
    await renderLoaded({ canSeeLevyPayers: false });

    expect(
      screen.getByRole("region", { name: "Current plan" }),
    ).toBeInTheDocument();
    expect(salesRequests(fetchDouble)).toBe(0);
  });
});
