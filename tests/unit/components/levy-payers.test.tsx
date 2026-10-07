import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentsScreen } from "@/components/payments/PaymentsScreen";
import type { Locale } from "@/lib/i18n/locale";
import type { LevyPayersReport } from "@/lib/membership/levy-payers";
import type { MembershipView } from "@/lib/membership/membership-view";

/**
 * Quién pagó cada levy en Pagos (#531): un desplegable bajo cada levy, sólo
 * para Admin y Committee, con el resumen, los que pagaron, los que faltan y
 * el CSV. Los endpoints van doblados con `fetch`.
 */

const MEMBERSHIP_PATH = "/api/v1/membership";
const LEVIES_PATH = "/api/v1/levies";
const LEVY_PRICE = "price_nationals";
const PAYERS_PATH = `/api/v1/levies/${LEVY_PRICE}/payers`;
const BLOB_URL = "blob:http://localhost/levy";

const NO_MEMBERSHIP: MembershipView = {
  paymentsConfigured: true,
  membership: null,
  payments: [],
  sessionBalance: { sessions: 0, movements: [] },
};

const NATIONALS = {
  id: LEVY_PRICE,
  name: "Nationals 2026",
  description: null,
  amountCents: 8000,
  isPaid: false,
};

const WITH_PAYMENTS: LevyPayersReport = {
  levy: { id: LEVY_PRICE, name: "Nationals 2026", amountCents: 8000 },
  summary: { paidCount: 2, missingCount: 1, collectedCents: 16000 },
  payers: [
    {
      userId: "bruno",
      fullName: "Bruno Díaz",
      email: "bruno@club.test",
      paidAt: "2026-10-05T01:00:00.000Z",
      amountCents: 8000,
    },
    {
      userId: "alba",
      fullName: "Alba Ruiz",
      email: "alba@club.test",
      paidAt: "2026-10-02T01:00:00.000Z",
      amountCents: 8000,
    },
  ],
  missing: [{ userId: "carla", fullName: "Carla Soto", email: "c@club.test" }],
};

const WITHOUT_PAYMENTS: LevyPayersReport = {
  ...WITH_PAYMENTS,
  summary: { paidCount: 0, missingCount: 1, collectedCents: 0 },
  payers: [],
};

type Handler = () => Response;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function serviceUnavailable(): Response {
  return jsonResponse(
    { error: { code: "service_unavailable", message: "Stripe no contesta." } },
    503,
  );
}

const savedFiles: Blob[] = [];
const clickedDownloads: string[] = [];

function stubFetch(routes: {
  readonly levies?: Handler;
  readonly payers?: Handler;
}): ReturnType<typeof vi.fn> {
  const handlers: Record<string, Handler> = {
    [MEMBERSHIP_PATH]: () => jsonResponse({ data: NO_MEMBERSHIP }),
    [LEVIES_PATH]:
      routes.levies ?? (() => jsonResponse({ data: { levies: [NATIONALS] } })),
    [PAYERS_PATH]:
      routes.payers ?? (() => jsonResponse({ data: WITH_PAYMENTS })),
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

function renderScreen(canSeeLevyPayers: boolean, locale: Locale = "en"): void {
  render(
    <PaymentsScreen
      locale={locale}
      checkoutReturn={null}
      cardReturn={null}
      packReturn={null}
      canSeeLevyPayers={canSeeLevyPayers}
    />,
  );
}

async function openPayers(name: RegExp | string = "Who paid"): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name }));
}

function payersRegion(): HTMLElement {
  return screen.getByRole("region", { name: /Who paid|Quién pagó/ });
}

beforeEach(() => {
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
});

describe("PaymentsScreen: quién pagó cada levy (#531)", () => {
  it("a un Admin o un Committee le ofrece ver quién pagó cada levy", async () => {
    stubFetch({});
    renderScreen(true);

    expect(
      await screen.findByRole("button", {
        name: "Who paid",
        description: "Nationals 2026",
      }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("a un Player o un Coach no le ofrece la lista ni la pide", async () => {
    const fetchDouble = stubFetch({});
    renderScreen(false);

    await screen.findByRole("button", { name: "Pay" });
    expect(
      screen.queryByRole("button", { name: "Who paid" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Export CSV" }),
    ).not.toBeInTheDocument();
    expect(
      fetchDouble.mock.calls.some(([input]) => String(input) === PAYERS_PATH),
    ).toBe(false);
  });

  it("no pide la lista hasta que se abre", async () => {
    const fetchDouble = stubFetch({});
    renderScreen(true);

    await screen.findByRole("button", { name: "Who paid" });

    expect(
      fetchDouble.mock.calls.some(([input]) => String(input) === PAYERS_PATH),
    ).toBe(false);
  });

  it("al abrirla enseña el resumen arriba: cuántos pagaron, cuántos faltan y el total", async () => {
    stubFetch({});
    renderScreen(true);

    await openPayers();

    const region = await waitFor(payersRegion);
    const summary = await within(region).findByRole("list", {
      name: "Summary",
    });
    expect(summary).toHaveTextContent(/Paid\s*2/);
    expect(summary).toHaveTextContent(/Still to pay\s*1/);
    expect(summary).toHaveTextContent(/Collected\s*\$160\.00/);
  });

  it("enseña a los que pagaron con su fecha y su importe, del más reciente al más antiguo", async () => {
    stubFetch({});
    renderScreen(true);

    await openPayers();

    const table = await within(await waitFor(payersRegion)).findByRole(
      "table",
      { name: "Paid" },
    );
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/Bruno Díaz.*5 Oct.*\$80\.00/),
      expect.stringMatching(/Alba Ruiz.*2 Oct.*\$80\.00/),
    ]);
  });

  it("enseña a los que faltan por su nombre", async () => {
    stubFetch({});
    renderScreen(true);

    await openPayers();

    const missing = await within(await waitFor(payersRegion)).findByRole(
      "list",
      { name: "Still to pay" },
    );
    expect(within(missing).getAllByRole("listitem")).toHaveLength(1);
    expect(missing).toHaveTextContent("Carla Soto");
  });

  it("sin pagos lo dice, sin una tabla vacía", async () => {
    stubFetch({ payers: () => jsonResponse({ data: WITHOUT_PAYMENTS }) });
    renderScreen(true);

    await openPayers();

    const region = await waitFor(payersRegion);
    expect(
      await within(region).findByText("Nobody has paid this charge yet."),
    ).toBeInTheDocument();
    expect(within(region).queryByRole("table")).not.toBeInTheDocument();
  });

  it("si no se pudo cargar lo dice y deja reintentar", async () => {
    let calls = 0;
    stubFetch({
      payers: () => {
        calls += 1;
        return calls === 1
          ? serviceUnavailable()
          : jsonResponse({ data: WITH_PAYMENTS });
      },
    });
    renderScreen(true);

    await openPayers();

    const region = await waitFor(payersRegion);
    expect(await within(region).findByRole("alert")).toHaveTextContent(
      "We couldn't load who paid this charge",
    );
    await userEvent.click(
      within(region).getByRole("button", { name: "Try again" }),
    );
    expect(
      await within(region).findByRole("table", { name: "Paid" }),
    ).toBeInTheDocument();
  });

  it("si Stripe no responde al listar los levies, la sección lo dice y el resto de Pagos se pinta", async () => {
    stubFetch({ levies: serviceUnavailable });
    renderScreen(true);

    expect(
      await screen.findByText(/couldn't load the club charges/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Payment history" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Who paid" }),
    ).not.toBeInTheDocument();
  });

  it("Exportar CSV descarga una fila por socio con el nombre del levy", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T02:00:00.000Z"));
    stubFetch({});
    renderScreen(true);

    await openPayers();
    await userEvent.click(
      await within(await waitFor(payersRegion)).findByRole("button", {
        name: "Export CSV",
      }),
    );

    expect(clickedDownloads).toEqual([
      "nationals-2026-payments-2026-10-08.csv",
    ]);
    const [file] = savedFiles;
    const csv = await file?.text();
    expect(csv?.split("\r\n")).toEqual([
      expect.stringContaining("Name,Email,Paid,Payment date,Amount (AUD)"),
      "Bruno Díaz,bruno@club.test,Yes,2026-10-05,80.00",
      "Alba Ruiz,alba@club.test,Yes,2026-10-02,80.00",
      "Carla Soto,c@club.test,No,,",
      "",
    ]);
    vi.useRealTimers();
  });

  it("cambia los textos con el idioma, pero no el nombre del levy", async () => {
    stubFetch({});
    renderScreen(true, "es");

    await openPayers("Quién pagó");

    const region = await waitFor(payersRegion);
    expect(
      await within(region).findByRole("table", { name: "Pagaron" }),
    ).toBeInTheDocument();
    expect(within(region).getByRole("list", { name: "Faltan" })).toBeVisible();
    expect(
      within(region).getByRole("button", { name: "Exportar CSV" }),
    ).toBeInTheDocument();
    expect(region).toHaveAccessibleName(/Nationals 2026/);
  });
});
