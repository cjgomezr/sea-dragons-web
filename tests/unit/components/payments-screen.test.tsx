import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentsScreen } from "@/components/payments/PaymentsScreen";
import type { Locale } from "@/lib/i18n/locale";
import type { CheckoutReturn } from "@/lib/membership/checkout-return";
import type {
  MembershipPanelView,
  MembershipView,
  PaymentView,
} from "@/lib/membership/membership-view";

/**
 * Pagos (#454, #455; RF-3, RF-5 y RF-7 del PRD de E12): el panel de la
 * membresía con su chip de estado, el próximo cobro y la tarjeta, el cambio
 * de tarjeta en Stripe, el historial, y el alta en Checkout de quien aún no
 * puso tarjeta. Lo que la pantalla pide pasa por los endpoints de la
 * membresía, doblados aquí con `fetch`.
 */

const openCheckout = vi.fn();
vi.mock("@/components/payments/checkout-navigation", () => ({
  openCheckout: (url: string) => openCheckout(url),
}));

const MEMBERSHIP_PATH = "/api/v1/membership";
const CHECKOUT_PATH = "/api/v1/membership/checkout";
const CARD_PATH = "/api/v1/membership/card";
const PLAN_PATH = "/api/v1/membership/plan";
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_123";
const SETUP_URL = "https://checkout.stripe.com/c/pay/cs_test_setup";
const TRIAL_END = "2026-11-01T09:00:00.000Z";
const PERIOD_END = "2026-07-01T09:00:00.000Z";
const POLL_TIMEOUT_MS = 30_000;
const VISA = { brand: "visa", last4: "4242", expMonth: 8, expYear: 2028 };
const MASTERCARD = {
  brand: "mastercard",
  last4: "4444",
  expMonth: 3,
  expYear: 2031,
};

function panel(change: Partial<MembershipPanelView> = {}): MembershipPanelView {
  return {
    plan: "Full",
    status: "active",
    monthlyPriceCents: 4500,
    trialEnd: null,
    nextChargeAt: PERIOD_END,
    card: VISA,
    waiver: null,
    scheduledChange: null,
    canChangePlan: false,
    planPrices: { Full: 4500, Student: 3675 },
    canChoosePlan: false,
    casualSessionPriceCents: null,
    subscriptionEndsAt: null,
    ...change,
  };
}

function view(
  membership: MembershipPanelView | null,
  change: Partial<Omit<MembershipView, "membership">> = {},
): MembershipView {
  return { paymentsConfigured: true, membership, payments: [], ...change };
}

const ACTIVE_FULL = view(panel());
const PENDING_FULL = view(
  panel({ status: "pending", nextChargeAt: null, card: null }),
);
const TRIALING_FULL = view(
  panel({ status: "trialing", trialEnd: TRIAL_END, nextChargeAt: TRIAL_END }),
);
const PAST_DUE_FULL = view(panel({ status: "past_due", nextChargeAt: null }));
const CANCELLED_FULL = view(
  panel({ status: "cancelled", nextChargeAt: null, trialEnd: TRIAL_END }),
);

const PAYMENTS: readonly PaymentView[] = [
  {
    id: "pay-jun",
    date: "2026-06-01T09:00:00.000Z",
    description: "Monthly membership",
    amountCents: 4500,
    status: "paid",
  },
  {
    id: "pay-may",
    date: "2026-05-01T09:00:00.000Z",
    description: null,
    amountCents: 4500,
    status: "failed",
  },
  {
    id: "pay-apr",
    date: "2026-04-12T09:00:00.000Z",
    description: "Nationals levy",
    amountCents: 8000,
    status: "pending",
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function serviceUnavailable(): Response {
  return jsonResponse(
    {
      error: {
        code: "service_unavailable",
        message: "Stripe no contesta.",
        reason: "stripe_unavailable",
      },
    },
    503,
  );
}

type RouteHandler = (init?: RequestInit) => Response | Promise<Response>;

type FetchRoutes = {
  readonly membership?: RouteHandler;
  readonly checkout?: RouteHandler;
  readonly card?: RouteHandler;
  /** `POST` y `DELETE` del cambio de plan (#456): el método va en `init`. */
  readonly plan?: RouteHandler;
};

function stubFetch(routes: FetchRoutes): ReturnType<typeof vi.fn> {
  const handlers: Record<string, RouteHandler | undefined> = {
    [MEMBERSHIP_PATH]: routes.membership,
    [CHECKOUT_PATH]: routes.checkout,
    [CARD_PATH]: routes.card,
    [PLAN_PATH]: routes.plan,
  };
  const fetchDouble = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const handler = handlers[path];
      if (handler === undefined) {
        throw new Error(`petición inesperada a ${path}`);
      }
      return handler(init);
    },
  );
  vi.stubGlobal("fetch", fetchDouble);
  return fetchDouble;
}

type RenderOptions = {
  readonly locale?: Locale;
  readonly checkoutReturn?: CheckoutReturn | null;
  readonly cardReturn?: CheckoutReturn | null;
};

function renderScreen(options: RenderOptions = {}): void {
  render(
    <PaymentsScreen
      locale={options.locale ?? "en"}
      checkoutReturn={options.checkoutReturn ?? null}
      cardReturn={options.cardReturn ?? null}
    />,
  );
}

/** Pinta la pantalla con la membresía que sirve el endpoint, y espera a que
 * llegue. */
async function renderLoaded(
  loaded: MembershipView,
  options: RenderOptions & { readonly routes?: FetchRoutes } = {},
): Promise<ReturnType<typeof vi.fn>> {
  const fetchDouble = stubFetch({
    membership: () => jsonResponse({ data: loaded }),
    ...options.routes,
  });
  renderScreen(options);
  await screen.findByRole("heading", { level: 2, name: /history|Historial/ });
  return fetchDouble;
}

function countCalls(
  fetchDouble: ReturnType<typeof vi.fn>,
  path: string,
): number {
  return fetchDouble.mock.calls.filter(([input]) => String(input) === path)
    .length;
}

/** La tarjeta "Plan actual" del mockup, donde vive el chip de estado. */
function statusChip(): HTMLElement {
  return screen.getByRole("region", { name: /^(Current plan|Plan actual)$/ });
}

beforeEach(() => {
  openCheckout.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PaymentsScreen: carga", () => {
  it("se titula Pagos y dice que carga mientras el endpoint contesta", () => {
    stubFetch({ membership: () => new Promise<Response>(() => undefined) });

    renderScreen();

    expect(
      screen.getByRole("heading", { level: 1, name: "Payments" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Loading/);
  });

  it("dice el fallo de red y vuelve a pedir la membresía al reintentar", async () => {
    let attempts = 0;
    stubFetch({
      membership: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError("Failed to fetch");
        }
        return jsonResponse({ data: ACTIVE_FULL });
      },
    });
    renderScreen();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server",
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Full membership")).toBeInTheDocument();
  });

  it("dice en español que no pudo cargar la membresía", async () => {
    stubFetch({ membership: () => jsonResponse({}, 500) });

    renderScreen({ locale: "es" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos cargar tu membresía",
    );
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeEnabled();
  });
});

describe("PaymentsScreen: plan actual", () => {
  it("enseña el plan, el precio mensual, el próximo cobro y la tarjeta", async () => {
    await renderLoaded(ACTIVE_FULL);

    const plan = screen.getByRole("region", { name: "Current plan" });
    expect(within(plan).getByText("Full membership")).toBeInTheDocument();
    expect(within(plan).getByText("$45.00 a month")).toBeInTheDocument();
    expect(
      within(plan).getByText("Next charge 1 July 2026"),
    ).toBeInTheDocument();
    expect(
      within(plan).getByText("Visa ending in 4242, expires 08/2028"),
    ).toBeInTheDocument();
  });

  it("enseña el precio que sirve el endpoint, sea el que sea", async () => {
    await renderLoaded(view(panel({ monthlyPriceCents: 5150 })));

    const plan = screen.getByRole("region", { name: "Current plan" });
    expect(within(plan).getByText("$51.50 a month")).toBeInTheDocument();
  });

  it("dice Price not available cuando el precio de Full no se pudo leer, y pinta lo demás", async () => {
    await renderLoaded(view(panel({ monthlyPriceCents: null })));

    const plan = screen.getByRole("region", { name: "Current plan" });
    expect(within(plan).getByText("Price not available")).toBeInTheDocument();
    expect(within(plan).queryByText(/a month/)).not.toBeInTheDocument();
    expect(
      within(plan).getByText("Next charge 1 July 2026"),
    ).toBeInTheDocument();
  });

  it("dice Precio no disponible en español", async () => {
    await renderLoaded(
      view(
        panel({
          plan: "Student",
          monthlyPriceCents: null,
          status: "pending",
          nextChargeAt: null,
          card: null,
        }),
      ),
      { locale: "es" },
    );

    expect(screen.getByText("Precio no disponible")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Añadir tarjeta" }),
    ).toBeInTheDocument();
  });

  it.each<[string, MembershipView, string]>([
    ["activa", ACTIVE_FULL, "Active"],
    ["en prueba", TRIALING_FULL, "On trial until 1 November 2026"],
    ["con cobro fallido", PAST_DUE_FULL, "Payment failed"],
    ["cancelada", CANCELLED_FULL, "Cancelled"],
    [
      "exenta",
      view(
        panel({ status: "waived", waiver: { reason: "Coach", until: null } }),
      ),
      "Waived",
    ],
  ])("pone el chip de una membresía %s", async (_name, loaded, chip) => {
    await renderLoaded(loaded);

    expect(statusChip()).toHaveTextContent(chip);
  });

  it("pone los chips en español", async () => {
    await renderLoaded(TRIALING_FULL, { locale: "es" });

    expect(statusChip()).toHaveTextContent(
      "En prueba hasta el día 1 de noviembre de 2026",
    );
    expect(screen.getByText("Membresía Full")).toBeInTheDocument();
    expect(screen.getByText("45,00 AUD al mes")).toBeInTheDocument();
    expect(
      screen.getByText("Próximo cobro el 1 de noviembre de 2026"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Visa terminada en 4242, caduca 08/2028"),
    ).toBeInTheDocument();
  });

  it("dice Sin cobro recurrente a un Casual en vez del próximo cobro", async () => {
    await renderLoaded(
      view(
        panel({
          plan: "Casual",
          monthlyPriceCents: null,
          nextChargeAt: null,
          card: null,
          status: "waived",
          waiver: { reason: "Volunteer", until: null },
        }),
      ),
    );

    expect(screen.getByText("No recurring charge")).toBeInTheDocument();
    expect(screen.queryByText(/a month/)).not.toBeInTheDocument();
    expect(screen.queryByText("Price not available")).not.toBeInTheDocument();
    expect(screen.queryByText(/Next charge/)).not.toBeInTheDocument();
  });

  it("lo dice en español", async () => {
    await renderLoaded(
      view(
        panel({
          plan: "Casual",
          monthlyPriceCents: null,
          nextChargeAt: null,
          card: null,
          status: "waived",
          waiver: { reason: "Voluntaria", until: null },
        }),
      ),
      { locale: "es" },
    );

    expect(screen.getByText("Sin cobro recurrente")).toBeInTheDocument();
  });
});

describe("PaymentsScreen: exenta", () => {
  const WAIVED = view(
    panel({
      status: "waived",
      nextChargeAt: null,
      waiver: { reason: "Head coach", until: "2027-01-31T13:00:00.000Z" },
    }),
  );

  it("enseña el motivo y la fecha de fin, sin ningún botón de tarjeta", async () => {
    await renderLoaded(WAIVED);

    expect(screen.getByText("Reason: Head coach")).toBeInTheDocument();
    expect(screen.getByText("Until 1 February 2027")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /card|subscribe/i }),
    ).not.toBeInTheDocument();
  });

  it("dice que la suscripción de Stripe termina sin volver a cobrar", async () => {
    await renderLoaded(
      view(
        panel({
          status: "waived",
          nextChargeAt: null,
          waiver: { reason: "Coach", until: null },
          subscriptionEndsAt: PERIOD_END,
        }),
      ),
    );

    expect(
      screen.getByText(
        "Your subscription ends on 1 July 2026 and won't be charged again",
      ),
    ).toBeInTheDocument();
  });

  it("dice en español que la suscripción termina", async () => {
    await renderLoaded(
      view(
        panel({
          status: "waived",
          nextChargeAt: null,
          waiver: { reason: "Entrenador", until: null },
          subscriptionEndsAt: PERIOD_END,
        }),
      ),
      { locale: "es" },
    );

    expect(
      screen.getByText(
        "Tu suscripción termina el 1 de julio de 2026 y no se te volverá a cobrar",
      ),
    ).toBeInTheDocument();
  });

  it("no habla de suscripción a quien no la tiene", async () => {
    await renderLoaded(WAIVED);

    expect(screen.queryByText(/subscription ends/)).not.toBeInTheDocument();
  });

  it("no pone fecha a una exención que no vence", async () => {
    await renderLoaded(
      view(
        panel({ status: "waived", waiver: { reason: "Coach", until: null } }),
      ),
    );

    expect(screen.queryByText(/^Until/)).not.toBeInTheDocument();
  });

  it("lo dice en español", async () => {
    await renderLoaded(WAIVED, { locale: "es" });

    expect(statusChip()).toHaveTextContent("Exenta");
    expect(screen.getByText("Motivo: Head coach")).toBeInTheDocument();
    expect(
      screen.getByText("Hasta el 1 de febrero de 2027"),
    ).toBeInTheDocument();
  });
});

describe("PaymentsScreen: actualizar la tarjeta", () => {
  it("lleva a Stripe con la dirección que responde el endpoint de la tarjeta", async () => {
    const fetchDouble = await renderLoaded(ACTIVE_FULL, {
      routes: { card: () => jsonResponse({ data: { url: SETUP_URL } }) },
    });

    await userEvent.click(screen.getByRole("button", { name: "Update card" }));

    await waitFor(() => expect(openCheckout).toHaveBeenCalledWith(SETUP_URL));
    expect(fetchDouble).toHaveBeenCalledWith(
      CARD_PATH,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("ofrece reintentar cuando Stripe no contesta", async () => {
    await renderLoaded(ACTIVE_FULL, { routes: { card: serviceUnavailable } });

    await userEvent.click(screen.getByRole("button", { name: "Update card" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't open Stripe",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(openCheckout).not.toHaveBeenCalled();
  });

  it("explica a quien tiene un cobro fallido que la puerta está cerrada y le ofrece la tarjeta", async () => {
    await renderLoaded(PAST_DUE_FULL);

    expect(
      screen.getByText("Your last payment didn't go through."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/you only see your profile, Payments and the calendar/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Update card" }),
    ).toBeInTheDocument();
  });

  it("ofrece la tarjeta a quien tiene un cobro fallido aunque no se sepa cuál tenía", async () => {
    await renderLoaded(
      view(panel({ status: "past_due", nextChargeAt: null, card: null })),
    );

    expect(
      screen.getByRole("button", { name: "Update card" }),
    ).toBeInTheDocument();
  });

  it("lo dice en español", async () => {
    await renderLoaded(PAST_DUE_FULL, { locale: "es" });

    expect(statusChip()).toHaveTextContent("Pago fallido");
    expect(
      screen.getByText("Tu último pago no se pudo cobrar."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Actualizar tarjeta" }),
    ).toBeInTheDocument();
  });

  it("no ofrece la tarjeta si los pagos no están configurados", async () => {
    await renderLoaded({ ...ACTIVE_FULL, paymentsConfigured: false });

    expect(
      screen.queryByRole("button", { name: "Update card" }),
    ).not.toBeInTheDocument();
  });

  it("al volver de Stripe espera la tarjeta nueva y la enseña", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answers = 0;
    stubFetch({
      membership: () => {
        answers += 1;
        const card = answers < 3 ? VISA : MASTERCARD;
        return jsonResponse({ data: view(panel({ card })) });
      },
    });
    renderScreen({ cardReturn: "ok" });

    expect(
      await screen.findByText(/new card is saved in Stripe/),
    ).toHaveAttribute("role", "status");
    await act(() => vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS / 2));

    expect(
      screen.getByText("Mastercard ending in 4444, expires 03/2031"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("dice que salió de Stripe sin cambiar la tarjeta", async () => {
    await renderLoaded(ACTIVE_FULL, { cardReturn: "cancelado" });

    expect(screen.getByRole("status")).toHaveTextContent(
      /without changing your card/,
    );
  });
});

describe("PaymentsScreen: cancelada", () => {
  it("explica la puerta cerrada y ofrece volver a suscribirse por Checkout", async () => {
    const fetchDouble = await renderLoaded(CANCELLED_FULL, {
      routes: { checkout: () => jsonResponse({ data: { url: CHECKOUT_URL } }) },
    });

    expect(
      screen.getByText("Your membership is cancelled."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Update card" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Subscribe again" }),
    );

    await waitFor(() =>
      expect(openCheckout).toHaveBeenCalledWith(CHECKOUT_URL),
    );
    expect(countCalls(fetchDouble, CHECKOUT_PATH)).toBe(1);
  });

  it("lo dice en español", async () => {
    await renderLoaded(CANCELLED_FULL, { locale: "es" });

    expect(statusChip()).toHaveTextContent("Cancelada");
    expect(
      screen.getByRole("button", { name: "Volver a suscribirse" }),
    ).toBeInTheDocument();
  });
});

describe("PaymentsScreen: historial", () => {
  it("pinta cada pago con su fecha, descripción, importe y estado, en el orden servido", async () => {
    await renderLoaded(view(panel(), { payments: PAYMENTS }));

    const table = screen.getByRole("table", { name: "Payment history" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      "1 June 2026Monthly membership$45.00Paid",
      "1 May 2026Membership payment$45.00Failed",
      "12 April 2026Nationals levy$80.00Pending",
    ]);
  });

  it("escribe fechas, importes y estados en español", async () => {
    await renderLoaded(view(panel(), { payments: PAYMENTS }), {
      locale: "es",
    });

    const table = screen.getByRole("table", { name: "Historial de pagos" });
    const [, firstRow, secondRow] = within(table).getAllByRole("row");
    expect(firstRow).toHaveTextContent("1 de junio de 2026");
    expect(firstRow).toHaveTextContent("45,00 AUD");
    expect(firstRow).toHaveTextContent("Pagado");
    expect(secondRow).toHaveTextContent("Pago de membresía");
    expect(secondRow).toHaveTextContent("Fallido");
  });

  it("dice que no hay pagos cuando el historial está vacío", async () => {
    await renderLoaded(ACTIVE_FULL);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("No payments yet.")).toBeInTheDocument();
  });

  it("lo dice en español", async () => {
    await renderLoaded(ACTIVE_FULL, { locale: "es" });

    expect(screen.getByText("Todavía no hay pagos.")).toBeInTheDocument();
  });
});

describe("PaymentsScreen: socio pendiente", () => {
  it("explica el plan, el precio, el mes gratis y el primer cobro en 30 días", async () => {
    await renderLoaded(PENDING_FULL);

    expect(screen.getByText("Full membership")).toBeInTheDocument();
    expect(screen.getByText("$45.00 a month")).toBeInTheDocument();
    expect(screen.getByText(/first month is free/)).toHaveTextContent(
      "30 days",
    );
    expect(
      screen.getByRole("button", { name: "Add card" }),
    ).toBeInTheDocument();
    expect(statusChip()).toHaveTextContent("Pending");
  });

  it("lo dice en español", async () => {
    await renderLoaded(
      view(
        panel({
          plan: "Student",
          monthlyPriceCents: 3200,
          status: "pending",
          nextChargeAt: null,
          card: null,
        }),
      ),
      { locale: "es" },
    );

    expect(screen.getByText("Membresía Student")).toBeInTheDocument();
    expect(screen.getByText("32,00 AUD al mes")).toBeInTheDocument();
    expect(screen.getByText(/primer mes es gratis/)).toHaveTextContent(
      "30 días",
    );
    expect(statusChip()).toHaveTextContent("Pendiente");
    expect(
      screen.getByRole("button", { name: "Añadir tarjeta" }),
    ).toBeInTheDocument();
  });

  it("no promete el mes gratis a quien ya lo tuvo", async () => {
    await renderLoaded(
      view(panel({ status: "pending", trialEnd: TRIAL_END, card: null })),
    );

    expect(screen.queryByText(/first month is free/)).not.toBeInTheDocument();
    expect(screen.getByText(/already had your free month/)).toBeInTheDocument();
  });

  it("lleva a Stripe con la dirección que responde el endpoint", async () => {
    const fetchDouble = await renderLoaded(PENDING_FULL, {
      routes: { checkout: () => jsonResponse({ data: { url: CHECKOUT_URL } }) },
    });

    await userEvent.click(screen.getByRole("button", { name: "Add card" }));

    await waitFor(() =>
      expect(openCheckout).toHaveBeenCalledWith(CHECKOUT_URL),
    );
    expect(fetchDouble).toHaveBeenCalledWith(
      CHECKOUT_PATH,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("vuelve a ofrecer la tarjeta si el socio regresa de Stripe con Atrás", async () => {
    await renderLoaded(PENDING_FULL, {
      routes: { checkout: () => jsonResponse({ data: { url: CHECKOUT_URL } }) },
    });
    await userEvent.click(screen.getByRole("button", { name: "Add card" }));
    await waitFor(() => expect(openCheckout).toHaveBeenCalled());
    const restoredFromCache = new Event("pageshow");
    Object.defineProperty(restoredFromCache, "persisted", { value: true });

    act(() => {
      window.dispatchEvent(restoredFromCache);
    });

    expect(screen.getByRole("button", { name: "Add card" })).toBeEnabled();
  });

  it("pide una sola sesión ante un doble toque", async () => {
    const fetchDouble = await renderLoaded(PENDING_FULL, {
      routes: { checkout: () => new Promise<Response>(() => undefined) },
    });

    await userEvent.dblClick(screen.getByRole("button", { name: "Add card" }));

    expect(countCalls(fetchDouble, CHECKOUT_PATH)).toBe(1);
    expect(
      screen.getByRole("button", { name: /Opening Stripe/ }),
    ).toBeDisabled();
  });

  it("ofrece reintentar cuando Stripe no contesta", async () => {
    await renderLoaded(PENDING_FULL, {
      routes: { checkout: serviceUnavailable },
    });

    await userEvent.click(screen.getByRole("button", { name: "Add card" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't open Stripe",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(openCheckout).not.toHaveBeenCalled();
  });

  it("dice el error de red en español y ofrece reintentar", async () => {
    await renderLoaded(PENDING_FULL, {
      locale: "es",
      routes: {
        checkout: () => {
          throw new TypeError("Failed to fetch");
        },
      },
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Añadir tarjeta" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos hablar con el servidor",
    );
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeEnabled();
  });

  it("sigue ofreciendo la tarjeta a quien canceló en Checkout", async () => {
    await renderLoaded(PENDING_FULL, { checkoutReturn: "cancelado" });

    expect(screen.getByRole("status")).toHaveTextContent(
      /without adding a card/,
    );
    expect(
      screen.getByRole("button", { name: "Add card" }),
    ).toBeInTheDocument();
  });

  it("dice que los pagos no están configurados y no ofrece la tarjeta", async () => {
    await renderLoaded({ ...PENDING_FULL, paymentsConfigured: false });

    expect(screen.getByText(/Payments aren't set up yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("PaymentsScreen: Casual pendiente", () => {
  const PENDING_CASUAL = view(
    panel({
      plan: "Casual",
      status: "pending",
      monthlyPriceCents: null,
      nextChargeAt: null,
      card: null,
    }),
  );

  it("dice que los packs llegan más adelante y que un Admin puede activarlo, sin Checkout", async () => {
    await renderLoaded(PENDING_CASUAL);

    expect(screen.getByText(/session packs/)).toHaveTextContent(
      "an Admin can activate",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("lo dice en español", async () => {
    await renderLoaded(PENDING_CASUAL, { locale: "es" });

    expect(screen.getByText(/packs de sesiones/)).toHaveTextContent(
      "un Admin puede activar",
    );
  });
});

describe("PaymentsScreen: vuelta de Checkout", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("enseña la prueba en cuanto el webhook llegó", async () => {
    await renderLoaded(TRIALING_FULL, { checkoutReturn: "ok" });

    expect(statusChip()).toHaveTextContent("1 November 2026");
  });

  it("dice que espera a Stripe y vuelve a consultar hasta que llega la prueba", async () => {
    let answers = 0;
    stubFetch({
      membership: () => {
        answers += 1;
        return jsonResponse({
          data: answers < 3 ? PENDING_FULL : TRIALING_FULL,
        });
      },
    });
    renderScreen({ checkoutReturn: "ok" });

    expect(await screen.findByText(/waiting for Stripe/)).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS / 2));

    expect(statusChip()).toHaveTextContent("On trial until 1 November 2026");
  });

  it("lo dice en español", async () => {
    let answers = 0;
    stubFetch({
      membership: () => {
        answers += 1;
        return jsonResponse({
          data: answers < 2 ? PENDING_FULL : TRIALING_FULL,
        });
      },
    });
    renderScreen({ locale: "es", checkoutReturn: "ok" });

    expect(
      await screen.findByText(/esperando la confirmación de Stripe/),
    ).toHaveAttribute("role", "status");

    await act(() => vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS / 2));

    expect(statusChip()).toHaveTextContent(
      "En prueba hasta el día 1 de noviembre de 2026",
    );
  });

  it("al volver de suscribirse otra vez espera a Stripe sin ofrecer otra suscripción", async () => {
    let answers = 0;
    stubFetch({
      membership: () => {
        answers += 1;
        return jsonResponse({
          data: answers < 3 ? CANCELLED_FULL : ACTIVE_FULL,
        });
      },
    });
    renderScreen({ checkoutReturn: "ok" });

    expect(await screen.findByText(/waiting for Stripe/)).toHaveAttribute(
      "role",
      "status",
    );
    expect(
      screen.queryByRole("button", { name: "Subscribe again" }),
    ).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS / 2));

    expect(statusChip()).toHaveTextContent("Active");
    expect(screen.queryByText(/waiting for Stripe/)).not.toBeInTheDocument();
  });

  it("deja de consultar a los 30 segundos y lo dice", async () => {
    const fetchDouble = stubFetch({
      membership: () => jsonResponse({ data: PENDING_FULL }),
    });
    renderScreen({ checkoutReturn: "ok" });
    await screen.findByText(/waiting for Stripe/);

    await act(() => vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS));
    const callsAtTimeout = countCalls(fetchDouble, MEMBERSHIP_PATH);
    await act(() => vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS));

    expect(callsAtTimeout).toBeGreaterThan(2);
    expect(countCalls(fetchDouble, MEMBERSHIP_PATH)).toBe(callsAtTimeout);
    expect(screen.getByRole("status")).toHaveTextContent(
      /hasn't confirmed yet/,
    );
  });
});
describe("PaymentsScreen: cambio de plan (#456)", () => {
  const CHANGEABLE_FULL = view(panel({ canChangePlan: true }));
  const SCHEDULED_STUDENT = view(
    panel({
      scheduledChange: { plan: "Student", effectiveAt: PERIOD_END },
    }),
  );
  const SCHEDULED_CASUAL = view(
    panel({
      nextChargeAt: null,
      scheduledChange: { plan: "Casual", effectiveAt: PERIOD_END },
    }),
  );
  const CHANGEABLE_CASUAL = view(
    panel({
      plan: "Casual",
      status: "pending",
      monthlyPriceCents: null,
      nextChargeAt: null,
      card: null,
      canChangePlan: true,
    }),
  );

  /** La membresía que sirve el endpoint: la primera al cargar, la segunda
   * al volver a pedirla tras el cambio. */
  function membershipSequence(
    first: MembershipView,
    second: MembershipView,
  ): RouteHandler {
    let served = 0;
    return () => {
      served += 1;
      return jsonResponse({ data: served === 1 ? first : second });
    };
  }

  function planCalls(
    fetchDouble: ReturnType<typeof vi.fn>,
  ): readonly { readonly method: string; readonly body: unknown }[] {
    return fetchDouble.mock.calls
      .filter(([input]) => String(input) === PLAN_PATH)
      .map(([, init]) => {
        const request = init as RequestInit;
        return {
          method: String(request.method),
          body:
            request.body === undefined
              ? undefined
              : (JSON.parse(String(request.body)) as unknown),
        };
      });
  }

  function planChangeGroup(name = "Change plan"): HTMLElement {
    return screen.getByRole("group", { name });
  }

  it("no ofrece el cambio a quien no puede cambiar de plan", async () => {
    await renderLoaded(ACTIVE_FULL);

    expect(screen.queryByRole("group", { name: "Change plan" })).toBeNull();
  });

  it("dice que el precio no está disponible si el de Stripe no se pudo leer", async () => {
    await renderLoaded(
      view(
        panel({
          canChangePlan: true,
          planPrices: { Full: 4500, Student: null },
        }),
      ),
    );

    expect(
      within(planChangeGroup()).getByRole("radio", {
        name: "Student · Price not available",
      }),
    ).toBeInTheDocument();
  });

  it("ofrece los otros planes con su precio, y no el que ya tiene", async () => {
    await renderLoaded(CHANGEABLE_FULL);

    const group = planChangeGroup();
    expect(
      within(group).getByRole("radio", { name: "Student · $36.75 a month" }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole("radio", {
        name: "Casual · No recurring charge",
      }),
    ).toBeInTheDocument();
    expect(within(group).queryByRole("radio", { name: /^Full/ })).toBeNull();
    expect(
      screen.getByText(
        "The change starts with your next billing cycle, with no proration.",
      ),
    ).toBeInTheDocument();
  });

  it("no deja confirmar hasta elegir un plan", async () => {
    await renderLoaded(CHANGEABLE_FULL);

    expect(
      screen.getByRole("button", { name: "Confirm the change" }),
    ).toBeDisabled();
  });

  it("programa el plan elegido y dice cuándo pasa a él", async () => {
    const fetchDouble = await renderLoaded(CHANGEABLE_FULL, {
      routes: {
        membership: membershipSequence(CHANGEABLE_FULL, SCHEDULED_STUDENT),
        plan: () =>
          jsonResponse({
            data: {
              kind: "scheduled",
              plan: "Student",
              effectiveAt: PERIOD_END,
            },
          }),
      },
    });

    await userEvent.click(screen.getByRole("radio", { name: /^Student/ }));
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm the change" }),
    );

    expect(
      await screen.findByText("Moves to Student on 1 July 2026."),
    ).toBeInTheDocument();
    expect(planCalls(fetchDouble)).toEqual([
      { method: "POST", body: { plan: "Student" } },
    ]);
    expect(
      screen.getByRole("button", { name: "Cancel the change" }),
    ).toBeEnabled();
  });

  it("anula el cambio programado y vuelve a enseñar sólo el plan actual", async () => {
    const fetchDouble = await renderLoaded(SCHEDULED_STUDENT, {
      routes: {
        membership: membershipSequence(SCHEDULED_STUDENT, ACTIVE_FULL),
        plan: () => jsonResponse({ data: { scheduledChange: null } }),
      },
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Cancel the change" }),
    );

    await waitFor(() =>
      expect(screen.queryByText(/Moves to Student/)).toBeNull(),
    );
    expect(planCalls(fetchDouble)).toEqual([
      { method: "DELETE", body: undefined },
    ]);
    expect(screen.getByText("Full membership")).toBeInTheDocument();
  });

  it("dice que pasar a Casual termina la suscripción, sin próximo cobro", async () => {
    await renderLoaded(SCHEDULED_CASUAL);

    expect(
      screen.getByText(
        "Moves to Casual on 1 July 2026: your subscription ends that day.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Next charge/)).toBeNull();
  });

  it("lleva a Stripe al Casual que elige Full", async () => {
    await renderLoaded(CHANGEABLE_CASUAL, {
      routes: {
        plan: () =>
          jsonResponse({ data: { kind: "checkout", url: CHECKOUT_URL } }),
      },
    });

    expect(
      screen.getByText("Choosing Full or Student takes you to Stripe."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /^Full/ }));
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm the change" }),
    );

    await waitFor(() =>
      expect(openCheckout).toHaveBeenCalledWith(CHECKOUT_URL),
    );
  });

  it("manda una sola petición ante un doble toque", async () => {
    const fetchDouble = await renderLoaded(CHANGEABLE_FULL, {
      routes: { plan: () => new Promise<Response>(() => undefined) },
    });

    await userEvent.click(screen.getByRole("radio", { name: /^Student/ }));
    await userEvent.dblClick(
      screen.getByRole("button", { name: "Confirm the change" }),
    );

    expect(countCalls(fetchDouble, PLAN_PATH)).toBe(1);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("anula con una sola petición ante un doble toque", async () => {
    const fetchDouble = await renderLoaded(SCHEDULED_STUDENT, {
      routes: { plan: () => new Promise<Response>(() => undefined) },
    });

    await userEvent.dblClick(
      screen.getByRole("button", { name: "Cancel the change" }),
    );

    expect(countCalls(fetchDouble, PLAN_PATH)).toBe(1);
  });

  it("si Stripe no contesta, lo dice, no cambia nada y ofrece reintentar", async () => {
    const fetchDouble = await renderLoaded(CHANGEABLE_FULL, {
      routes: { plan: serviceUnavailable },
    });

    await userEvent.click(screen.getByRole("radio", { name: /^Student/ }));
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm the change" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Stripe isn't responding, so nothing changed.",
    );
    expect(screen.queryByText(/Moves to/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(countCalls(fetchDouble, PLAN_PATH)).toBe(2);
  });

  it("si Stripe no contesta al anular, el cambio sigue y ofrece reintentar", async () => {
    await renderLoaded(SCHEDULED_STUDENT, {
      routes: { plan: serviceUnavailable },
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Cancel the change" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Stripe isn't responding, so nothing changed.",
    );
    expect(
      screen.getByText("Moves to Student on 1 July 2026."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("lo ofrece en español", async () => {
    await renderLoaded(CHANGEABLE_FULL, { locale: "es" });

    const group = planChangeGroup("Cambiar de plan");
    expect(
      // Intl separa el importe de la moneda con un espacio duro.
      within(group).getByRole("radio", {
        name: /^Student · 36,75\sAUD al mes$/,
      }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole("radio", {
        name: "Casual · Sin cobro recurrente",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirmar el cambio" }),
    ).toBeDisabled();
  });

  it("dice el cambio programado y su anulación en español", async () => {
    await renderLoaded(SCHEDULED_STUDENT, { locale: "es" });

    expect(
      screen.getByText("Pasa a Student el 1 de julio de 2026."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Anular el cambio" }),
    ).toBeEnabled();
  });

  it("dice en español que Stripe no contesta", async () => {
    await renderLoaded(SCHEDULED_STUDENT, {
      locale: "es",
      routes: { plan: serviceUnavailable },
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Anular el cambio" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Stripe no contesta, así que no cambió nada.",
    );
  });
});

describe("PaymentsScreen: elegir plan antes del primer pago (#479)", () => {
  const CHOOSING = panel({
    plan: null,
    status: "pending",
    monthlyPriceCents: null,
    nextChargeAt: null,
    card: null,
    canChoosePlan: true,
    planPrices: { Full: 4500, Student: 3200 },
    casualSessionPriceCents: 1500,
  });

  function choosing(change: Partial<MembershipPanelView> = {}): MembershipView {
    return view({ ...CHOOSING, ...change });
  }

  function choiceGroup(): HTMLElement {
    return screen.getByRole("group", { name: "Choose your membership" });
  }

  function savedChoice(plan: "Full" | "Student" | "Casual"): RouteHandler {
    return () =>
      jsonResponse({
        data: choosing({
          plan,
          monthlyPriceCents: plan === "Casual" ? null : 4500,
        }),
      });
  }

  it("ofrece las tres opciones con su precio y ninguna marcada sin plan guardado", async () => {
    await renderLoaded(choosing());

    const group = choiceGroup();
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios.every((radio) => !(radio as HTMLInputElement).checked)).toBe(
      true,
    );
    expect(
      within(group).getByRole("radio", { name: /^Full/ }),
    ).toHaveAccessibleName(/\$45\.00 a month.*First month free/);
    expect(
      within(group).getByRole("radio", { name: /^Student/ }),
    ).toHaveAccessibleName(/\$32\.00 a month.*First month free/);
    expect(
      within(group).getByRole("radio", { name: /^Casual/ }),
    ).toHaveAccessibleName(/\$15\.00 per session.*session packs/);
    expect(
      screen.queryByRole("button", { name: "Add card" }),
    ).not.toBeInTheDocument();
  });

  it("marca el plan que ya tiene guardado", async () => {
    await renderLoaded(choosing({ plan: "Student", monthlyPriceCents: 3200 }));

    expect(
      within(choiceGroup()).getByRole("radio", { name: /^Student/ }),
    ).toBeChecked();
  });

  it("dice que el precio no está disponible si Stripe no lo dio", async () => {
    await renderLoaded(
      choosing({
        planPrices: { Full: null, Student: 3200 },
        casualSessionPriceCents: null,
      }),
    );

    expect(
      within(choiceGroup()).getByRole("radio", { name: /^Full/ }),
    ).toHaveAccessibleName(/Price not available/);
    expect(
      within(choiceGroup()).getByRole("radio", { name: /^Casual/ }),
    ).toHaveAccessibleName(/Price not available/);
  });

  it("guarda la opción elegida con PUT y enseña la membresía que responde", async () => {
    const fetchDouble = await renderLoaded(choosing(), {
      routes: { plan: savedChoice("Full") },
    });

    await userEvent.click(screen.getByRole("radio", { name: /^Full/ }));

    expect(
      await screen.findByRole("button", { name: "Add card" }),
    ).toBeInTheDocument();
    expect(fetchDouble).toHaveBeenCalledWith(
      PLAN_PATH,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ plan: "Full" }),
      }),
    );
    expect(screen.getByRole("radio", { name: /^Full/ })).toBeChecked();
  });

  it("con Full o Student guardado, continuar lleva a Checkout", async () => {
    const fetchDouble = await renderLoaded(
      choosing({ plan: "Full", monthlyPriceCents: 4500 }),
      {
        routes: {
          checkout: () => jsonResponse({ data: { url: CHECKOUT_URL } }),
        },
      },
    );

    await userEvent.click(screen.getByRole("button", { name: "Add card" }));

    await waitFor(() =>
      expect(openCheckout).toHaveBeenCalledWith(CHECKOUT_URL),
    );
    expect(fetchDouble).toHaveBeenCalledWith(
      CHECKOUT_PATH,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("al elegir Casual dice que los packs llegan con E13 y que un Admin puede activarlo, sin Checkout", async () => {
    await renderLoaded(choosing(), { routes: { plan: savedChoice("Casual") } });

    await userEvent.click(screen.getByRole("radio", { name: /^Casual/ }));

    expect(await screen.findByText(/session packs arrive/)).toHaveTextContent(
      "an Admin can activate",
    );
    expect(
      screen.queryByRole("button", { name: "Add card" }),
    ).not.toBeInTheDocument();
  });

  it("no ofrece además el cambio de plan del #456", async () => {
    await renderLoaded(choosing({ plan: "Casual", canChangePlan: true }));

    expect(
      screen.queryByRole("button", { name: "Confirm the change" }),
    ).not.toBeInTheDocument();
  });

  it("si no se pudo guardar, lo dice y deja marcada la opción que había", async () => {
    await renderLoaded(choosing({ plan: "Student", monthlyPriceCents: 3200 }), {
      routes: { plan: serviceUnavailable },
    });

    await userEvent.click(screen.getByRole("radio", { name: /^Full/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't save your choice",
    );
    expect(screen.getByRole("radio", { name: /^Student/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Full/ })).not.toBeChecked();
  });

  it("no deja elegir otra mientras guarda la primera", async () => {
    const fetchDouble = await renderLoaded(choosing(), {
      routes: { plan: () => new Promise<Response>(() => undefined) },
    });

    await userEvent.click(screen.getByRole("radio", { name: /^Full/ }));
    await userEvent.click(screen.getByRole("radio", { name: /^Student/ }));

    expect(countCalls(fetchDouble, PLAN_PATH)).toBe(1);
    expect(screen.getByRole("status")).toHaveTextContent("Saving");
  });

  it("al volver de Checkout espera a Stripe y no ofrece elegir otra vez", async () => {
    await renderLoaded(choosing({ plan: "Full", monthlyPriceCents: 4500 }), {
      checkoutReturn: "ok",
    });

    expect(screen.getByText(/waiting for Stripe/)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText("Full membership")).toBeInTheDocument();
  });

  it("lo dice en español, con los precios en su formato", async () => {
    await renderLoaded(choosing(), { locale: "es" });

    const group = screen.getByRole("group", { name: "Elige tu membresía" });
    expect(
      within(group).getByRole("radio", { name: /^Full/ }),
    ).toHaveAccessibleName(/^Full 45,00\sAUD al mes Primer mes gratis$/);
    expect(
      within(group).getByRole("radio", { name: /^Casual/ }),
    ).toHaveAccessibleName(
      /15,00\sAUD por sesión Se paga en packs de sesiones$/,
    );
  });
});
