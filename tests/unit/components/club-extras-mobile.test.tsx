import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentsScreen } from "@/components/payments/PaymentsScreen";
import type { Locale } from "@/lib/i18n/locale";
import type { LevyBuyer, LevySale } from "@/lib/membership/levy-sales";
import type { MembershipView } from "@/lib/membership/membership-view";
import { visit } from "../../support/location-search-params";

/**
 * La pestaña Extras del club en el móvil (#636, RF-10 del PRD de E23): una
 * lista de filas, y el detalle de un extra en una hoja que sube desde abajo.
 * El ancho lo dice `matchMedia`, que aquí se simula. Cómo se ve a 375 px y
 * las medidas los prueba Playwright; aquí, lo que hace cada gesto.
 */

vi.mock(
  "next/navigation",
  async () => await import("../../support/location-search-params"),
);

const PHONE_QUERY = "(width < 768px)";
const MEMBERSHIP_PATH = "/api/v1/membership";
const LEVIES_PATH = "/api/v1/levies";
const SALES_PATH = "/api/v1/levies/sales";

function buyersPath(productId: string): string {
  return `/api/v1/levies/products/${productId}/buyers`;
}

const CONFIGURED_VIEW: MembershipView = {
  paymentsConfigured: true,
  membership: null,
  payments: [],
  sessionBalance: { sessions: 0, movements: [] },
};

function sale(overrides: Partial<LevySale> & Pick<LevySale, "productId">) {
  return {
    priceId: `price_${overrides.productId}`,
    name: overrides.productId,
    description: null,
    amountCents: 4500,
    status: "open",
    soldQuantity: 0,
    buyerCount: 0,
    soldByOption: [],
    ...overrides,
  } satisfies LevySale;
}

const CUP_DESCRIPTION = "U16 squad. Covers entry, field hire and the team bus.";

const CUP = sale({
  productId: "prod_cup",
  name: "Island Cup entry fee",
  description: CUP_DESCRIPTION,
  amountCents: 4500,
  soldQuantity: 14,
  buyerCount: 2,
});

const JERSEY = sale({
  productId: "prod_jersey",
  name: "2026 club jersey",
  amountCents: 6000,
  soldQuantity: 1,
  buyerCount: 1,
});

const DINNER = sale({
  productId: "prod_dinner",
  priceId: null,
  name: "End-of-season dinner",
  amountCents: 3500,
  status: "closed",
  soldQuantity: 9,
  buyerCount: 9,
});

const CUP_BUYERS: readonly LevyBuyer[] = [
  {
    userId: "lucia",
    fullName: "Lucía Fernández",
    email: "lucia@club.test",
    quantity: 1,
    paidAt: "2026-10-12T01:00:00.000Z",
    amountCents: 4500,
    option: null,
  },
];

type Handler = () => Response;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buyersResponse(buyers: readonly LevyBuyer[]): Handler {
  return () => jsonResponse({ data: { buyers } });
}

function stubFetch(
  routes: {
    readonly sales?: Handler;
    readonly buyers?: Readonly<Record<string, Handler>>;
  } = {},
): ReturnType<typeof vi.fn> {
  const buyerHandlers = routes.buyers ?? {
    prod_cup: buyersResponse(CUP_BUYERS),
    prod_jersey: buyersResponse([]),
    prod_dinner: buyersResponse([]),
  };
  const handlers: Record<string, Handler> = {
    [MEMBERSHIP_PATH]: () => jsonResponse({ data: CONFIGURED_VIEW }),
    [LEVIES_PATH]: () => jsonResponse({ data: { levies: [] } }),
    [SALES_PATH]:
      routes.sales ??
      (() => jsonResponse({ data: { sales: [CUP, JERSEY, DINNER] } })),
    ...Object.fromEntries(
      Object.entries(buyerHandlers).map(([productId, handler]) => [
        buyersPath(productId),
        handler,
      ]),
    ),
  };
  const fetchDouble = vi.fn(async (input: RequestInfo | URL) => {
    const handler = handlers[String(input)];
    if (handler === undefined) {
      throw new Error(`petición inesperada a ${String(input)}`);
    }
    return handler();
  });
  vi.stubGlobal("fetch", fetchDouble);
  return fetchDouble;
}

function stubScreen(isPhone: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: isPhone && query === PHONE_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function renderExtras(locale: Locale = "en"): void {
  render(
    <PaymentsScreen
      locale={locale}
      checkoutReturn={null}
      cardReturn={null}
      packReturn={null}
      levyReturn={null}
      canSeeLevyPayers
    />,
  );
}

async function findOnSaleList(): Promise<HTMLElement> {
  return await screen.findByRole("list", { name: /on sale|a la venta/ });
}

function rowButton(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${name}`) });
}

function sheet(name: string): HTMLElement {
  return screen.getByRole("dialog", { name });
}

function querySheet(): HTMLElement | null {
  return screen.queryByRole("dialog");
}

beforeEach(() => {
  visit("/pagos?tab=extras");
  stubScreen(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("la lista de extras en el móvil (#636)", () => {
  it("enseña la línea de cabecera y una fila por extra con nombre, precio y vendidos, sin tabla", async () => {
    stubFetch();
    renderExtras();

    const list = await findOnSaleList();

    expect(
      screen.getByText("2 extras on sale · created by the committee in Stripe"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    const [cup, jersey] = within(list).getAllByRole("listitem");
    expect(cup).toHaveTextContent("Island Cup entry fee");
    expect(cup).toHaveTextContent("$45.00");
    expect(cup).toHaveTextContent("14 sold");
    expect(jersey).toHaveTextContent("1 sold");
  });

  it("dice los vendidos en español", async () => {
    stubFetch();
    renderExtras("es");

    const list = await findOnSaleList();

    const [cup, jersey] = within(list).getAllByRole("listitem");
    expect(cup).toHaveTextContent("14 vendidos");
    expect(jersey).toHaveTextContent("1 vendido");
  });

  it("no abre ningún detalle ni pide compradores hasta que se toca una fila", async () => {
    const fetchDouble = stubFetch();
    renderExtras();

    await findOnSaleList();

    expect(querySheet()).toBeNull();
    expect(screen.queryByRole("region", { name: CUP.name })).toBeNull();
    expect(
      fetchDouble.mock.calls.filter(([input]) =>
        String(input).includes("/buyers"),
      ),
    ).toEqual([]);
  });

  it("pone los cerrados debajo, en Cerrados, con la misma fila", async () => {
    stubFetch();
    renderExtras();
    const onSale = await findOnSaleList();

    const closed = screen.getByRole("list", { name: "Closed" });

    expect(within(closed).getByRole("listitem")).toHaveTextContent(
      "End-of-season dinner",
    );
    expect(within(closed).getByRole("listitem")).toHaveTextContent("9 sold");
    expect(within(onSale).queryByText(DINNER.name)).toBeNull();
  });

  it("dice Cerrados en español", async () => {
    stubFetch();
    renderExtras("es");
    await findOnSaleList();

    expect(screen.getByRole("list", { name: "Cerrados" })).toBeInTheDocument();
  });
});

describe("la hoja del detalle en el móvil (#636)", () => {
  it("al tocar una fila sube la hoja con nombre, descripción, precio, fichas, compradores y CSV", async () => {
    const user = userEvent.setup();
    stubFetch();
    renderExtras();
    await findOnSaleList();

    await user.click(rowButton(CUP.name));

    const detail = sheet(CUP.name);
    expect(
      within(detail).getByRole("heading", { name: CUP.name }),
    ).toBeInTheDocument();
    expect(within(detail).getByText(CUP_DESCRIPTION)).toBeInTheDocument();
    expect(within(detail).getByText("$45.00")).toBeInTheDocument();
    expect(
      within(detail)
        .getAllByRole("term")
        .map((term) => term.textContent),
    ).toEqual(["Sold", "Buyers"]);
    const buyers = await within(detail).findByRole("list", { name: "Buyers" });
    expect(buyers).toHaveTextContent("Lucía Fernández");
    expect(buyers).toHaveTextContent("12 Oct");
    expect(
      within(detail).getByRole("button", { name: "Export CSV" }),
    ).toBeEnabled();
  });

  it("dice la hoja en español", async () => {
    const user = userEvent.setup();
    stubFetch();
    renderExtras("es");
    await findOnSaleList();

    await user.click(rowButton(CUP.name));

    const detail = sheet(CUP.name);
    expect(
      within(detail).getByRole("button", { name: "Cerrar el detalle" }),
    ).toBeInTheDocument();
    expect(
      await within(detail).findByRole("list", { name: "Compradores" }),
    ).toBeInTheDocument();
    expect(
      within(detail).getByRole("button", { name: "Exportar CSV" }),
    ).toBeInTheDocument();
  });

  it("abre un cerrado en la misma hoja", async () => {
    const user = userEvent.setup();
    stubFetch();
    renderExtras();
    await findOnSaleList();

    await user.click(rowButton(DINNER.name));

    expect(
      await within(sheet(DINNER.name)).findByText(
        "Nobody has bought this extra yet.",
      ),
    ).toBeInTheDocument();
  });

  it("enseña dentro de la hoja el error de los compradores y Reintentar", async () => {
    const user = userEvent.setup();
    stubFetch({
      buyers: {
        prod_cup: () =>
          jsonResponse(
            { error: { code: "internal_error", message: "No se pudo." } },
            500,
          ),
      },
    });
    renderExtras();
    await findOnSaleList();

    await user.click(rowButton(CUP.name));

    const detail = sheet(CUP.name);
    expect(await within(detail).findByRole("alert")).toHaveTextContent(
      "We couldn't load who bought this extra.",
    );
    expect(
      within(detail).getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("Escape la cierra y devuelve el foco a la fila", async () => {
    const user = userEvent.setup();
    stubFetch();
    renderExtras();
    await findOnSaleList();
    await user.click(rowButton(CUP.name));

    await user.keyboard("{Escape}");

    expect(querySheet()).toBeNull();
    expect(rowButton(CUP.name)).toHaveFocus();
  });

  it("un toque fuera la cierra y devuelve el foco a la fila", async () => {
    const user = userEvent.setup();
    stubFetch();
    renderExtras();
    await findOnSaleList();
    await user.click(rowButton(JERSEY.name));

    fireEvent.mouseDown(document.body);

    expect(querySheet()).toBeNull();
    expect(rowButton(JERSEY.name)).toHaveFocus();
  });

  it("arrastrar el asa hacia abajo la cierra y devuelve el foco a la fila", async () => {
    const user = userEvent.setup();
    stubFetch();
    renderExtras();
    await findOnSaleList();
    await user.click(rowButton(CUP.name));
    const grip = within(sheet(CUP.name)).getByRole("button", {
      name: "Close the details",
    });

    fireEvent.pointerDown(grip, { clientX: 180, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: 182, clientY: 520, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientX: 182, clientY: 520, pointerId: 1 });

    expect(querySheet()).toBeNull();
    expect(rowButton(CUP.name)).toHaveFocus();
  });

  // A qué control va el foco según lo abra el teclado o un dedo es de la
  // hoja y lo prueba `bottom-sheet.test.tsx`: jsdom no ve `:focus-visible`
  // durante el clic que Enter manda a un botón.
  it("abierta con el teclado, el foco entra en la hoja", async () => {
    const user = userEvent.setup();
    stubFetch();
    renderExtras();
    await findOnSaleList();
    rowButton(CUP.name).focus();

    await user.keyboard("{Enter}");

    expect(sheet(CUP.name)).toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it("abierta con el dedo, el foco entra en la hoja", async () => {
    const user = userEvent.setup();
    stubFetch();
    renderExtras();
    await findOnSaleList();

    await user.click(rowButton(CUP.name));

    expect(sheet(CUP.name)).toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it("el foco queda atrapado: Tab desde el último control vuelve dentro", async () => {
    const user = userEvent.setup();
    stubFetch();
    renderExtras();
    await findOnSaleList();
    rowButton(CUP.name).focus();
    await user.keyboard("{Enter}");
    const detail = sheet(CUP.name);
    const exportButton = await waitFor(() => {
      const button = within(detail).getByRole("button", { name: "Export CSV" });
      expect(button).toBeEnabled();
      return button;
    });
    exportButton.focus();

    await user.tab();

    expect(detail).toContainElement(document.activeElement as HTMLElement);
    expect(exportButton).not.toHaveFocus();
  });

  it("el foco que sale de la hoja vuelve dentro", async () => {
    const user = userEvent.setup();
    stubFetch();
    renderExtras();
    await findOnSaleList();
    rowButton(CUP.name).focus();
    await user.keyboard("{Enter}");

    rowButton(JERSEY.name).focus();

    expect(sheet(CUP.name)).toContainElement(
      document.activeElement as HTMLElement,
    );
  });
});

describe("la pestaña de extras sin nada que enseñar en el móvil (#636)", () => {
  it("sin extras explica que se crean en Stripe, como en escritorio", async () => {
    stubFetch({ sales: () => jsonResponse({ data: { sales: [] } }) });
    renderExtras();

    expect(
      await screen.findByText(/committee creates them in Stripe/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /on sale/ })).toBeNull();
  });

  it("con Stripe sin configurar lo avisa, como en escritorio", async () => {
    stubFetch({
      sales: () =>
        jsonResponse(
          {
            error: {
              code: "service_unavailable",
              message: "No se pudo.",
              reason: "stripe_not_configured",
            },
          },
          503,
        ),
    });
    renderExtras();

    expect(
      await screen.findByText(/Payments aren't set up yet/),
    ).toBeInTheDocument();
  });

  it("si la lista falla, lo dice y deja reintentar", async () => {
    stubFetch({
      sales: () =>
        jsonResponse(
          { error: { code: "internal_error", message: "No se pudo." } },
          500,
        ),
    });
    renderExtras();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't load the club extras.",
    );
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});

describe("la pestaña de extras desde 768px (#636)", () => {
  it("sigue enseñando la tabla y el detalle de escritorio, sin hoja", async () => {
    stubScreen(false);
    stubFetch();
    renderExtras();

    expect(
      await screen.findByRole("table", { name: /on sale/ }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("region", { name: CUP.name }),
    ).toBeInTheDocument();
    expect(querySheet()).toBeNull();
  });
});
