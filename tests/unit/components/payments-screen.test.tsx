import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentsScreen } from "@/components/payments/PaymentsScreen";
import type { Locale } from "@/lib/i18n/locale";
import type { CheckoutReturn } from "@/lib/membership/checkout-return";
import type { MembershipView } from "@/lib/membership/membership-view";

/**
 * Pagos con el alta en Stripe (#454, RF-3 del PRD de E12): la explicación
 * del plan y el mes de prueba, "Añadir tarjeta", la espera del webhook al
 * volver de Checkout y los fallos. Lo que la pantalla pide pasa por los dos
 * endpoints de la membresía, doblados aquí con `fetch`.
 */

const openCheckout = vi.fn();
vi.mock("@/components/payments/checkout-navigation", () => ({
  openCheckout: (url: string) => openCheckout(url),
}));

const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_123";
const TRIAL_END = "2026-11-01T09:00:00.000Z";
const POLL_TIMEOUT_MS = 30_000;

function view(
  membership: MembershipView["membership"],
  paymentsConfigured = true,
): MembershipView {
  return { paymentsConfigured, membership };
}

const PENDING_FULL = view({ plan: "Full", status: "pending", trialEnd: null });
const TRIALING_FULL = view({
  plan: "Full",
  status: "trialing",
  trialEnd: TRIAL_END,
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchRoutes = {
  readonly membership?: () => Response;
  readonly checkout?: () => Response | Promise<Response>;
};

function stubFetch(routes: FetchRoutes): ReturnType<typeof vi.fn> {
  const fetchDouble = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === "/api/v1/membership/checkout" && routes.checkout) {
      return routes.checkout();
    }
    if (path === "/api/v1/membership" && routes.membership) {
      return routes.membership();
    }
    throw new Error(`petición inesperada a ${path}`);
  });
  vi.stubGlobal("fetch", fetchDouble);
  return fetchDouble;
}

function renderScreen(
  initialView: MembershipView,
  options: {
    readonly locale?: Locale;
    readonly checkoutReturn?: CheckoutReturn | null;
  } = {},
): void {
  render(
    <PaymentsScreen
      locale={options.locale ?? "en"}
      initialView={initialView}
      checkoutReturn={options.checkoutReturn ?? null}
    />,
  );
}

function countCalls(
  fetchDouble: ReturnType<typeof vi.fn>,
  path: string,
): number {
  return fetchDouble.mock.calls.filter(([input]) => String(input) === path)
    .length;
}

beforeEach(() => {
  openCheckout.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PaymentsScreen: socio pendiente", () => {
  it("explica el plan, el precio, el mes gratis y el primer cobro en 30 días", () => {
    renderScreen(PENDING_FULL);

    expect(
      screen.getByRole("heading", { level: 1, name: "Payments" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Full membership/)).toHaveTextContent("$45.00");
    expect(screen.getByText(/first month is free/)).toHaveTextContent(
      "30 days",
    );
    expect(
      screen.getByRole("button", { name: "Add card" }),
    ).toBeInTheDocument();
  });

  it("lo dice en español", () => {
    renderScreen(view({ plan: "Student", status: "pending", trialEnd: null }), {
      locale: "es",
    });

    expect(
      screen.getByRole("heading", { level: 1, name: "Pagos" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Membresía Student/)).toHaveTextContent("32,00");
    expect(screen.getByText(/primer mes es gratis/)).toHaveTextContent(
      "30 días",
    );
    expect(
      screen.getByRole("button", { name: "Añadir tarjeta" }),
    ).toBeInTheDocument();
  });

  it("no promete el mes gratis a quien ya lo tuvo", () => {
    renderScreen(
      view({ plan: "Full", status: "pending", trialEnd: TRIAL_END }),
    );

    expect(screen.queryByText(/first month is free/)).not.toBeInTheDocument();
    expect(screen.getByText(/already had your free month/)).toBeInTheDocument();
  });

  it("lleva a Stripe con la dirección que responde el endpoint", async () => {
    const fetchDouble = stubFetch({
      checkout: () => jsonResponse({ data: { url: CHECKOUT_URL } }),
    });
    renderScreen(PENDING_FULL);

    await userEvent.click(screen.getByRole("button", { name: "Add card" }));

    await waitFor(() =>
      expect(openCheckout).toHaveBeenCalledWith(CHECKOUT_URL),
    );
    expect(fetchDouble).toHaveBeenCalledWith(
      "/api/v1/membership/checkout",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("pide una sola sesión ante un doble toque", async () => {
    const fetchDouble = stubFetch({
      checkout: () => new Promise<Response>(() => undefined),
    });
    renderScreen(PENDING_FULL);

    await userEvent.dblClick(screen.getByRole("button", { name: "Add card" }));

    expect(countCalls(fetchDouble, "/api/v1/membership/checkout")).toBe(1);
    expect(
      screen.getByRole("button", { name: /Opening Stripe/ }),
    ).toBeDisabled();
  });

  it("ofrece reintentar cuando Stripe no contesta", async () => {
    stubFetch({
      checkout: () =>
        jsonResponse(
          {
            error: {
              code: "service_unavailable",
              message: "Stripe no contesta.",
              reason: "stripe_unavailable",
            },
          },
          503,
        ),
    });
    renderScreen(PENDING_FULL);

    await userEvent.click(screen.getByRole("button", { name: "Add card" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't open Stripe",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(openCheckout).not.toHaveBeenCalled();
  });

  it("dice el error de red en español y ofrece reintentar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    renderScreen(PENDING_FULL, { locale: "es" });

    await userEvent.click(
      screen.getByRole("button", { name: "Añadir tarjeta" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos hablar con el servidor",
    );
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeEnabled();
  });

  it("sigue ofreciendo la tarjeta a quien canceló en Checkout", () => {
    renderScreen(PENDING_FULL, { checkoutReturn: "cancelado" });

    expect(screen.getByRole("status")).toHaveTextContent(
      /without adding a card/,
    );
    expect(
      screen.getByRole("button", { name: "Add card" }),
    ).toBeInTheDocument();
  });

  it("dice que los pagos no están configurados y no ofrece la tarjeta", () => {
    renderScreen(
      view({ plan: "Full", status: "pending", trialEnd: null }, false),
    );

    expect(screen.getByText(/Payments aren't set up yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("PaymentsScreen: Casual", () => {
  it("dice que los packs llegan más adelante y que un Admin puede activarlo, sin Checkout", () => {
    renderScreen(view({ plan: "Casual", status: "pending", trialEnd: null }));

    expect(screen.getByText(/session packs/)).toHaveTextContent(
      "an Admin can activate",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("lo dice en español", () => {
    renderScreen(view({ plan: "Casual", status: "pending", trialEnd: null }), {
      locale: "es",
    });

    expect(screen.getByText(/packs de sesiones/)).toHaveTextContent(
      "un Admin puede activar",
    );
  });
});

describe("PaymentsScreen: vuelta de Checkout", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("enseña la prueba en cuanto el webhook llegó", () => {
    renderScreen(TRIALING_FULL, { checkoutReturn: "ok" });

    expect(screen.getByText(/On trial until/)).toHaveTextContent(
      "1 November 2026",
    );
  });

  it("dice que espera a Stripe y vuelve a consultar hasta que llega la prueba", async () => {
    let answers = 0;
    stubFetch({
      membership: () => {
        answers += 1;
        return jsonResponse({
          data: answers < 2 ? PENDING_FULL : TRIALING_FULL,
        });
      },
    });
    renderScreen(PENDING_FULL, { checkoutReturn: "ok" });

    expect(screen.getByRole("status")).toHaveTextContent(/waiting for Stripe/);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS / 2));

    expect(screen.getByText(/On trial until/)).toHaveTextContent(
      "1 November 2026",
    );
  });

  it("lo dice en español", async () => {
    stubFetch({ membership: () => jsonResponse({ data: TRIALING_FULL }) });
    renderScreen(PENDING_FULL, { locale: "es", checkoutReturn: "ok" });

    expect(screen.getByRole("status")).toHaveTextContent(
      /esperando la confirmación de Stripe/,
    );

    await act(() => vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS / 2));

    expect(screen.getByText(/En prueba hasta el día/)).toHaveTextContent(
      "1 de noviembre de 2026",
    );
  });

  it("deja de consultar a los 30 segundos y lo dice", async () => {
    const fetchDouble = stubFetch({
      membership: () => jsonResponse({ data: PENDING_FULL }),
    });
    renderScreen(PENDING_FULL, { checkoutReturn: "ok" });

    await act(() => vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS));
    const callsAtTimeout = countCalls(fetchDouble, "/api/v1/membership");
    await act(() => vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS));

    expect(callsAtTimeout).toBeGreaterThan(1);
    expect(countCalls(fetchDouble, "/api/v1/membership")).toBe(callsAtTimeout);
    expect(screen.getByRole("status")).toHaveTextContent(
      /hasn't confirmed yet/,
    );
  });
});

describe("PaymentsScreen: otros estados", () => {
  it("no ofrece la tarjeta a quien está al día", () => {
    renderScreen(view({ plan: "Full", status: "active", trialEnd: null }));

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/under construction/)).toBeInTheDocument();
  });

  it("sigue diciendo el motivo de un cobro fallido", () => {
    renderScreen(view({ plan: "Full", status: "past_due", trialEnd: null }));

    expect(
      screen.getByText("Your last payment didn't go through."),
    ).toBeInTheDocument();
  });
});
