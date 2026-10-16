import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentsScreen } from "@/components/payments/PaymentsScreen";
import type { Locale } from "@/lib/i18n/locale";
import type { LevyBuyer, LevySale } from "@/lib/membership/levy-sales";
import type { MembershipView } from "@/lib/membership/membership-view";
import { visit } from "../../support/location-search-params";

/**
 * La pestaña Extras del club en escritorio (#635, RF-9 del PRD de E23): la
 * tabla de extras con lo vendido, el detalle del elegido con sus
 * compradores y el CSV, y los cerrados debajo. Sin cifras de dinero
 * agregadas (D3). Los endpoints van doblados con `fetch`.
 */

vi.mock(
  "next/navigation",
  async () => await import("../../support/location-search-params"),
);

const MEMBERSHIP_PATH = "/api/v1/membership";
const LEVIES_PATH = "/api/v1/levies";
const SALES_PATH = "/api/v1/levies/sales";
const BLOB_URL = "blob:http://localhost/extra";

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
  soldQuantity: 3,
  buyerCount: 2,
});

const JERSEY = sale({
  productId: "prod_jersey",
  name: "2026 club jersey",
  amountCents: 6000,
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
    quantity: 2,
    paidAt: "2026-10-12T01:00:00.000Z",
    amountCents: 9000,
    option: null,
  },
  {
    userId: "tom",
    fullName: "Tom Baker",
    email: "tom@club.test",
    quantity: 1,
    paidAt: "2026-10-03T01:00:00.000Z",
    amountCents: 4500,
    option: null,
  },
];

const DINNER_BUYERS: readonly LevyBuyer[] = [
  {
    userId: "mateo",
    fullName: "Mateo Rossi",
    email: "mateo@club.test",
    quantity: 1,
    paidAt: "2026-09-20T01:00:00.000Z",
    amountCents: 3500,
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

function failure(code: string, status: number, reason?: string): Response {
  return jsonResponse(
    { error: { code, message: "No se pudo.", ...(reason ? { reason } : {}) } },
    status,
  );
}

function salesResponse(sales: readonly LevySale[]): Handler {
  return () => jsonResponse({ data: { sales } });
}

function buyersResponse(buyers: readonly LevyBuyer[]): Handler {
  return () => jsonResponse({ data: { buyers } });
}

const savedFiles: Blob[] = [];
const clickedDownloads: string[] = [];

function stubFetch(
  routes: {
    readonly view?: MembershipView;
    readonly sales?: Handler;
    readonly buyers?: Readonly<Record<string, Handler>>;
  } = {},
): ReturnType<typeof vi.fn> {
  const buyerHandlers = routes.buyers ?? {
    prod_cup: buyersResponse(CUP_BUYERS),
    prod_jersey: buyersResponse([]),
    prod_dinner: buyersResponse(DINNER_BUYERS),
  };
  const handlers: Record<string, Handler> = {
    [MEMBERSHIP_PATH]: () =>
      jsonResponse({ data: routes.view ?? CONFIGURED_VIEW }),
    [LEVIES_PATH]: () => jsonResponse({ data: { levies: [] } }),
    [SALES_PATH]: routes.sales ?? salesResponse([CUP, JERSEY, DINNER]),
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

function requestsTo(fetchDouble: ReturnType<typeof vi.fn>, path: string) {
  return fetchDouble.mock.calls.filter(([input]) => String(input) === path)
    .length;
}

function renderExtras(locale: Locale = "en"): void {
  render(
    <PaymentsScreen
      locale={locale}
      checkoutReturn={null}
      cardReturn={null}
      packReturn={null}
      canSeeLevyPayers
    />,
  );
}

function extrasPanel(): HTMLElement {
  return screen.getByRole("tabpanel");
}

async function findSalesTable(): Promise<HTMLElement> {
  return await screen.findByRole("table", { name: /on sale|a la venta/ });
}

async function findDetail(name: string): Promise<HTMLElement> {
  return await screen.findByRole("region", { name });
}

function rowButton(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

beforeEach(() => {
  visit("/pagos?tab=extras");
  savedFiles.length = 0;
  clickedDownloads.length = 0;
  // jsdom no implementa las direcciones de un Blob.
  URL.createObjectURL = vi.fn((file: Blob) => {
    savedFiles.push(file);
    return BLOB_URL;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clickedDownloads.push(this.download);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("PaymentsScreen: la lista de extras del club (#635)", () => {
  it("enseña cuántos extras hay a la venta y la tabla Extra, Precio, Vendidos", async () => {
    stubFetch();
    renderExtras();

    const table = await findSalesTable();

    expect(
      within(extrasPanel()).getByText(
        "2 extras on sale · created by the committee in Stripe",
      ),
    ).toBeInTheDocument();
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Extra", "Price", "Sold"]);
    const [, cupRow] = within(table).getAllByRole("row");
    expect(
      within(cupRow as HTMLElement)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([expect.stringContaining("Island Cup entry fee"), "$45.00", "3"]);
  });

  it("no enseña ninguna cifra de dinero agregada", async () => {
    stubFetch();
    renderExtras();

    await findDetail(CUP.name);

    expect(within(extrasPanel()).queryByText(/Revenue|Recaudado/)).toBeNull();
  });

  it("dice la línea y las columnas en español", async () => {
    stubFetch();
    renderExtras("es");

    const table = await findSalesTable();

    expect(
      within(extrasPanel()).getByText(
        "2 extras a la venta · creados por el comité en Stripe",
      ),
    ).toBeInTheDocument();
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Extra", "Precio", "Vendidos"]);
  });

  it("elige el primer extra al cargar", async () => {
    stubFetch();
    renderExtras();

    await findSalesTable();

    expect(rowButton(CUP.name)).toHaveAttribute("aria-current", "true");
    expect(rowButton(JERSEY.name)).not.toHaveAttribute("aria-current");
    expect(await findDetail(CUP.name)).toBeInTheDocument();
  });

  it("no pide la lista de extras a quien no abrió la pestaña", async () => {
    visit("/pagos");
    const fetchDouble = stubFetch();
    renderExtras();

    await screen.findByRole("heading", { level: 2, name: "Payment history" });

    expect(requestsTo(fetchDouble, SALES_PATH)).toBe(0);
  });
});

describe("PaymentsScreen: el detalle de un extra (#635)", () => {
  it("enseña nombre, descripción, precio, Vendidos, Compradores y la lista", async () => {
    stubFetch();
    renderExtras();

    const detail = await findDetail(CUP.name);

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
    expect(
      within(detail)
        .getAllByRole("definition")
        .map((value) => value.textContent),
    ).toEqual(["3", "2"]);
    const buyers = await within(detail).findByRole("list", { name: "Buyers" });
    const [lucia, tom] = within(buyers).getAllByRole("listitem");
    expect(lucia).toHaveTextContent("Lucía Fernández");
    expect(lucia).toHaveTextContent("× 2");
    expect(lucia).toHaveTextContent("12 Oct");
    expect(tom).toHaveTextContent("Tom Baker");
    expect(tom).not.toHaveTextContent("×");
    expect(
      within(detail).getByRole("button", { name: "Export CSV" }),
    ).toBeEnabled();
  });

  it("pone las iniciales de cada comprador, sin anunciarlas", async () => {
    stubFetch();
    renderExtras();

    const detail = await findDetail(CUP.name);
    const buyers = await within(detail).findByRole("list", { name: "Buyers" });

    const [lucia] = within(buyers).getAllByRole("listitem");
    expect(within(lucia as HTMLElement).getByText("LF")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("cambia de extra con un clic", async () => {
    stubFetch();
    renderExtras();
    await findDetail(CUP.name);

    await userEvent.click(rowButton(JERSEY.name));

    expect(rowButton(JERSEY.name)).toHaveAttribute("aria-current", "true");
    expect(rowButton(CUP.name)).not.toHaveAttribute("aria-current");
    expect(await findDetail(JERSEY.name)).toBeInTheDocument();
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Espacio", " "],
  ])("cambia de extra con %s", async (_key, keys) => {
    stubFetch();
    renderExtras();
    await findDetail(CUP.name);

    rowButton(JERSEY.name).focus();
    await userEvent.keyboard(keys);

    expect(rowButton(JERSEY.name)).toHaveAttribute("aria-current", "true");
    expect(await findDetail(JERSEY.name)).toBeInTheDocument();
  });

  it("no vuelve a pedir los compradores de un extra ya elegido", async () => {
    const fetchDouble = stubFetch();
    renderExtras();
    const detail = await findDetail(CUP.name);
    await within(detail).findByRole("list", { name: "Buyers" });
    await userEvent.click(rowButton(JERSEY.name));
    await findDetail(JERSEY.name);

    await userEvent.click(rowButton(CUP.name));

    const again = await findDetail(CUP.name);
    expect(
      within(again).getByRole("list", { name: "Buyers" }),
    ).toBeInTheDocument();
    expect(requestsTo(fetchDouble, buyersPath(CUP.productId))).toBe(1);
  });

  it("dice que aún no hay compras y desactiva Exportar CSV si nadie compró", async () => {
    stubFetch();
    renderExtras();
    await findDetail(CUP.name);

    await userEvent.click(rowButton(JERSEY.name));

    const detail = await findDetail(JERSEY.name);
    expect(
      await within(detail).findByText("Nobody has bought this extra yet."),
    ).toBeInTheDocument();
    expect(
      within(detail).getByRole("button", { name: "Export CSV" }),
    ).toBeDisabled();
  });

  it("enseña el error y Reintentar si fallan los compradores, y la lista sigue usable", async () => {
    let attempts = 0;
    stubFetch({
      buyers: {
        prod_cup: () => {
          attempts += 1;
          return attempts === 1
            ? failure("internal_error", 500)
            : jsonResponse({ data: { buyers: CUP_BUYERS } });
        },
        prod_jersey: buyersResponse([]),
      },
    });
    renderExtras();

    const detail = await findDetail(CUP.name);
    expect(await within(detail).findByRole("alert")).toHaveTextContent(
      "We couldn't load who bought this extra.",
    );
    expect(
      within(detail).getByRole("button", { name: "Export CSV" }),
    ).toBeDisabled();

    await userEvent.click(
      within(detail).getByRole("button", { name: "Try again" }),
    );

    expect(
      await within(detail).findByRole("list", { name: "Buyers" }),
    ).toBeInTheDocument();
    await userEvent.click(rowButton(JERSEY.name));
    expect(await findDetail(JERSEY.name)).toBeInTheDocument();
  });

  it("Exportar CSV descarga una fila por compra con nombre, correo, unidades, fecha e importe", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T02:00:00.000Z"));
    stubFetch();
    renderExtras();
    const detail = await findDetail(CUP.name);
    await within(detail).findByRole("list", { name: "Buyers" });

    await userEvent.click(
      within(detail).getByRole("button", { name: "Export CSV" }),
    );

    expect(clickedDownloads).toEqual([
      "island-cup-entry-fee-payments-2026-10-16.csv",
    ]);
    const csv = await savedFiles[0]?.text();
    expect(csv?.split("\r\n")).toEqual([
      expect.stringContaining("Name,Email,Units,Payment date,Amount (AUD)"),
      "Lucía Fernández,lucia@club.test,2,2026-10-12,90.00",
      "Tom Baker,tom@club.test,1,2026-10-03,45.00",
      "",
    ]);
  });

  it("dice las fichas y los compradores en español", async () => {
    stubFetch();
    renderExtras("es");

    const detail = await findDetail(CUP.name);

    expect(
      within(detail)
        .getAllByRole("term")
        .map((term) => term.textContent),
    ).toEqual(["Vendidos", "Compradores"]);
    expect(
      await within(detail).findByRole("list", { name: "Compradores" }),
    ).toBeInTheDocument();
    expect(
      within(detail).getByRole("button", { name: "Exportar CSV" }),
    ).toBeInTheDocument();
  });
});

describe("PaymentsScreen: los extras cerrados (#635)", () => {
  it("van en Cerrados, debajo de la tabla, con las mismas columnas", async () => {
    stubFetch();
    renderExtras();
    await findSalesTable();

    const closed = screen.getByRole("table", { name: "Closed" });

    expect(
      within(closed)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Extra", "Price", "Sold"]);
    expect(
      within(closed).getByRole("button", { name: DINNER.name }),
    ).toBeInTheDocument();
    expect(
      within(await findSalesTable()).queryByRole("button", {
        name: DINNER.name,
      }),
    ).toBeNull();
  });

  it("abre un cerrado en el mismo panel, con sus compradores", async () => {
    stubFetch();
    renderExtras();
    await findDetail(CUP.name);

    await userEvent.click(rowButton(DINNER.name));

    const detail = await findDetail(DINNER.name);
    const buyers = await within(detail).findByRole("list", { name: "Buyers" });
    expect(buyers).toHaveTextContent("Mateo Rossi");
  });

  it("dice Cerrados en español", async () => {
    stubFetch();
    renderExtras("es");
    await findSalesTable();

    expect(screen.getByRole("table", { name: "Cerrados" })).toBeInTheDocument();
  });

  it("sin extras a la venta elige el primer cerrado", async () => {
    stubFetch({ sales: salesResponse([DINNER]) });
    renderExtras();

    expect(await findDetail(DINNER.name)).toBeInTheDocument();
    expect(
      within(extrasPanel()).getByText(
        "0 extras on sale · created by the committee in Stripe",
      ),
    ).toBeInTheDocument();
  });
});

describe("PaymentsScreen: la pestaña de extras sin nada que enseñar (#635)", () => {
  it("sin extras abiertos ni cerrados explica que se crean en Stripe", async () => {
    stubFetch({ sales: salesResponse([]) });
    renderExtras();

    expect(
      await within(extrasPanel()).findByText(
        /committee creates them in Stripe/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("con Stripe sin configurar en la membresía lo avisa y no pide los extras", async () => {
    const fetchDouble = stubFetch({
      view: { ...CONFIGURED_VIEW, paymentsConfigured: false },
    });
    renderExtras();

    expect(
      await within(extrasPanel()).findByText(/Payments aren't set up yet/),
    ).toBeInTheDocument();
    expect(requestsTo(fetchDouble, SALES_PATH)).toBe(0);
  });

  it("con Stripe sin configurar en el endpoint lo avisa", async () => {
    stubFetch({
      sales: () => failure("service_unavailable", 503, "stripe_not_configured"),
    });
    renderExtras();

    expect(
      await within(extrasPanel()).findByText(/Payments aren't set up yet/),
    ).toBeInTheDocument();
  });

  it("si la lista falla, lo dice y deja reintentar", async () => {
    let attempts = 0;
    stubFetch({
      sales: () => {
        attempts += 1;
        return attempts === 1
          ? failure("internal_error", 500)
          : jsonResponse({ data: { sales: [CUP] } });
      },
    });
    renderExtras();

    expect(await within(extrasPanel()).findByRole("alert")).toHaveTextContent(
      "We couldn't load the club extras.",
    );
    await userEvent.click(
      within(extrasPanel()).getByRole("button", { name: "Try again" }),
    );

    expect(await findDetail(CUP.name)).toBeInTheDocument();
  });

  it("ya no queda el desplegable Quién pagó", async () => {
    stubFetch();
    renderExtras();
    await findSalesTable();

    expect(
      screen.queryByRole("button", { name: /Who paid/, hidden: true }),
    ).toBeNull();
  });
});

describe("las claves de los compradores (#635)", () => {
  it("ya no existen las de faltantes y existen Vendidos y Compradores", async () => {
    const { englishMessages } = await import("@/lib/i18n/messages/en");
    const { spanishMessages } = await import("@/lib/i18n/messages/es");

    for (const messages of [englishMessages, spanishMessages]) {
      const keys = Object.keys(messages);
      expect(
        keys.filter((key) =>
          /^payments\.levyPayers\.(summary|missing|noneMissing|paidTitle|toggle)/.test(
            key,
          ),
        ),
      ).toEqual([]);
    }
    expect(englishMessages["payments.levyPayers.sold"]).toBe("Sold");
    expect(englishMessages["payments.levyPayers.buyers"]).toBe("Buyers");
    expect(spanishMessages["payments.levyPayers.sold"]).toBe("Vendidos");
    expect(spanishMessages["payments.levyPayers.buyers"]).toBe("Compradores");
  });
});
