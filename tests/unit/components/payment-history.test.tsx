import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentHistory } from "@/components/payments/PaymentHistory";
import type { PaymentReceiptOutcome } from "@/components/payments/payments-client";
import { CSV_BYTE_ORDER_MARK } from "@/lib/directory/directory-csv";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import type { PaymentView } from "@/lib/membership/membership-view";

/**
 * El historial de pagos rehecho (#631, RF-5 del PRD de E23): grupos por mes,
 * el filtro por estado, el método y el motivo del fallo, el recibo de cada
 * pago cobrado y el CSV de lo que deja ver el filtro.
 *
 * jsdom no aplica la hoja de estilos: la tabla de escritorio y la lista del
 * móvil conviven aquí, y cada test mira la que le toca. Cómo se ven a cada
 * ancho lo prueba Playwright.
 */

const requestPaymentReceipt =
  vi.fn<(paymentId: string) => Promise<PaymentReceiptOutcome>>();
vi.mock("@/components/payments/payments-client", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/payments/payments-client")
  >()),
  requestPaymentReceipt: (paymentId: string) =>
    requestPaymentReceipt(paymentId),
}));

const openReceipt = vi.fn<(url: string) => void>();
vi.mock("@/components/payments/checkout-navigation", () => ({
  openCheckout: vi.fn(),
  openReceipt: (url: string) => openReceipt(url),
}));

const saveFile = vi.fn<(file: Blob, filename: string) => void>();
vi.mock("@/components/save-file", () => ({
  saveFile: (file: Blob, filename: string) => saveFile(file, filename),
}));

const RECEIPT_URL = "https://pay.stripe.com/receipts/payment/abc";
const VISA = { brand: "visa", last4: "4242" } as const;

function payment(change: Partial<PaymentView> & { id: string }): PaymentView {
  return {
    date: "2026-10-01T00:00:00.000Z",
    description: "Monthly membership",
    amountCents: 4500,
    status: "paid",
    card: VISA,
    failureReason: null,
    quantity: 1,
    ...change,
  };
}

const OCTOBER_FEE = payment({ id: "oct", date: "2026-10-01T00:00:00.000Z" });
const JERSEY = payment({
  id: "jersey",
  date: "2026-10-18T00:00:00.000Z",
  description: "2026 club jersey",
  amountCents: 6000,
});
const DECLINED = payment({
  id: "declined",
  date: "2026-08-01T00:00:00.000Z",
  description: null,
  status: "failed",
  card: null,
  failureReason: "Card declined",
});
const PENDING_LEVY = payment({
  id: "pending",
  date: "2026-07-12T00:00:00.000Z",
  description: "Nationals levy",
  status: "pending",
});

const HISTORY = [OCTOBER_FEE, JERSEY, DECLINED];

function renderHistory(
  payments: readonly PaymentView[],
  locale: Locale = "en",
): void {
  render(
    <PaymentHistory translate={createTranslator(locale)} payments={payments} />,
  );
}

function historyTable(locale: Locale = "en"): HTMLElement {
  return screen.getByRole("table", {
    name: locale === "en" ? "Payment history" : "Historial de pagos",
  });
}

function bodyRowTexts(table: HTMLElement): readonly string[] {
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent ?? "");
}

async function chooseFilter(name: string): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  requestPaymentReceipt.mockResolvedValue({ kind: "found", url: RECEIPT_URL });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PaymentHistory: grupos por mes", () => {
  it("pone una fila de mes antes de los pagos de cada mes, del más reciente al más antiguo", () => {
    renderHistory(HISTORY);

    const months = within(historyTable())
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent);
    expect(months).toEqual(["October 2026", "August 2026"]);
  });

  it("escribe el mes en español", () => {
    renderHistory(HISTORY, "es");

    expect(
      within(historyTable("es")).getByRole("rowheader", {
        name: "octubre de 2026",
      }),
    ).toBeInTheDocument();
  });

  it("también agrupa por mes la lista del móvil", () => {
    renderHistory(HISTORY);

    const list = screen.getByRole("region", { name: "Payments by month" });
    expect(
      within(list)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(["October 2026", "August 2026"]);
  });
});

describe("PaymentHistory: fila de escritorio", () => {
  it("tiene las columnas fecha, descripción, método, importe y estado", () => {
    renderHistory(HISTORY);

    const headers = within(historyTable())
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers).toEqual([
      "Date",
      "Description",
      "Method",
      "Amount",
      "Status",
      "Receipt",
    ]);
  });

  it("pinta cada pago con su día, descripción, método, importe y estado", () => {
    renderHistory(HISTORY);

    expect(bodyRowTexts(historyTable())).toEqual([
      "October 2026",
      "18 Oct2026 club jerseyVisa •••• 4242$60.00Paid",
      "1 OctMonthly membershipVisa •••• 4242$45.00Paid",
      "August 2026",
      "1 AugMembership paymentCard declined—$45.00Failed",
    ]);
  });

  it("escribe un guion como método cuando no hay tarjeta guardada", () => {
    renderHistory([DECLINED]);

    const [, row] = within(historyTable()).getAllByRole("row").slice(1);
    expect(within(row as HTMLElement).getByText("—")).toBeInTheDocument();
  });

  it("pone el motivo del fallo debajo de la descripción", () => {
    renderHistory([DECLINED]);

    const reason = within(historyTable()).getByText("Card declined");
    expect(reason).toHaveClass("payments-history-failure");
  });

  it("lo escribe en español", () => {
    renderHistory(HISTORY, "es");

    const [, firstRow] = within(historyTable("es"))
      .getAllByRole("row")
      .slice(1);
    expect(firstRow).toHaveTextContent("Pagado");
    expect(firstRow).toHaveTextContent("60,00 AUD");
  });
});

describe("PaymentHistory: filtro", () => {
  it("empieza en Todos, marcado como pulsado", () => {
    renderHistory(HISTORY);

    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("deja sólo los pagados y quita los meses sin pagos", async () => {
    renderHistory([OCTOBER_FEE, DECLINED]);

    await chooseFilter("Paid");

    expect(bodyRowTexts(historyTable())).toEqual([
      "October 2026",
      "1 OctMonthly membershipVisa •••• 4242$45.00Paid",
    ]);
    expect(screen.getByRole("button", { name: "Paid" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("deja sólo los fallidos", async () => {
    renderHistory(HISTORY);

    await chooseFilter("Failed");

    expect(bodyRowTexts(historyTable())).toEqual([
      "August 2026",
      "1 AugMembership paymentCard declined—$45.00Failed",
    ]);
  });

  it("vuelve a todos con Todos", async () => {
    renderHistory(HISTORY);
    await chooseFilter("Failed");

    await chooseFilter("All");

    expect(bodyRowTexts(historyTable())).toHaveLength(5);
  });

  it("no ofrece Pendientes si no hay pagos pendientes", () => {
    renderHistory(HISTORY);

    expect(
      screen.queryByRole("button", { name: "Pending" }),
    ).not.toBeInTheDocument();
  });

  it("ofrece Pendientes cuando hay alguno, y lo filtra", async () => {
    renderHistory([...HISTORY, PENDING_LEVY]);

    await chooseFilter("Pending");

    expect(bodyRowTexts(historyTable())).toEqual([
      "July 2026",
      "12 JulNationals levyVisa •••• 4242$45.00Pending",
    ]);
  });

  it("dice que ningún pago coincide cuando el filtro no deja ninguno", async () => {
    renderHistory([OCTOBER_FEE]);

    await chooseFilter("Failed");

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.getByText("No payments match this filter."),
    ).toBeInTheDocument();
  });

  it("lo dice en español", async () => {
    renderHistory([OCTOBER_FEE], "es");

    await chooseFilter("Fallidos");

    expect(
      screen.getByText("Ningún pago coincide con este filtro."),
    ).toBeInTheDocument();
  });

  it("nombra el grupo del filtro", () => {
    renderHistory(HISTORY, "es");

    const group = screen.getByRole("group", { name: "Filtrar por estado" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Todos", "Pagados", "Fallidos"]);
  });
});

describe("PaymentHistory: recibo", () => {
  it("pide el recibo del pago cobrado y lo abre", async () => {
    renderHistory(HISTORY);

    await userEvent.click(
      within(historyTable()).getByRole("button", {
        name: "View receipt for 2026 club jersey",
      }),
    );

    await waitFor(() => expect(openReceipt).toHaveBeenCalledWith(RECEIPT_URL));
    expect(requestPaymentReceipt).toHaveBeenCalledWith("jersey");
  });

  it("nombra el icono en español con la descripción por defecto", () => {
    renderHistory([payment({ id: "fee", description: null })], "es");

    expect(
      within(historyTable("es")).getByRole("button", {
        name: "Ver recibo de Pago de membresía",
      }),
    ).toBeInTheDocument();
  });

  it("no pone recibo a un pago fallido ni a uno pendiente", () => {
    renderHistory([DECLINED, PENDING_LEVY]);

    expect(
      screen.queryByRole("button", { name: /^View receipt/ }),
    ).not.toBeInTheDocument();
  });

  it("avisa en línea si pedir el recibo falla, sin cambiar el filtro", async () => {
    requestPaymentReceipt.mockResolvedValue({
      kind: "failed",
      failure: "service_unavailable",
      reason: null,
    });
    renderHistory(HISTORY);
    await chooseFilter("Paid");

    await userEvent.click(
      within(historyTable()).getByRole("button", {
        name: "View receipt for Monthly membership",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't open the receipt. Try again.",
    );
    expect(openReceipt).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Paid" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("en el móvil la fila de un pago cobrado es un botón que abre su recibo", async () => {
    renderHistory(HISTORY);
    const list = screen.getByRole("region", { name: "Payments by month" });

    await userEvent.click(
      within(list).getByRole("button", {
        name: "View receipt for 2026 club jersey",
      }),
    );

    await waitFor(() => expect(openReceipt).toHaveBeenCalledWith(RECEIPT_URL));
    expect(requestPaymentReceipt).toHaveBeenCalledWith("jersey");
  });

  it("en el móvil la fila de un pago fallido no es un botón y enseña su motivo", () => {
    renderHistory([DECLINED]);
    const list = screen.getByRole("region", { name: "Payments by month" });

    expect(within(list).queryByRole("button")).not.toBeInTheDocument();
    expect(within(list).getByText("Card declined")).toBeInTheDocument();
  });
});

describe("PaymentHistory: exportar CSV", () => {
  async function exportedCsv(): Promise<string> {
    const [file] = saveFile.mock.calls[0] ?? [];
    if (file === undefined) {
      throw new Error("No se guardó ningún archivo");
    }
    return (await file.text()).replace(CSV_BYTE_ORDER_MARK, "");
  }

  it("descarga los pagos que deja ver el filtro, con cabeceras traducidas", async () => {
    renderHistory(HISTORY, "es");
    await chooseFilter("Fallidos");

    await userEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));

    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFile.mock.calls[0]?.[1]).toMatch(
      /^pagos-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    expect((await exportedCsv()).split("\r\n")).toEqual([
      "Fecha,Descripción,Método,Importe (AUD),Estado",
      "2026-08-01,Pago de membresía,,45.00,Fallido",
      "",
    ]);
  });
});

describe("PaymentHistory: sin pagos", () => {
  it("dice que no hay pagos, sin filtro ni exportar", () => {
    renderHistory([]);

    expect(screen.getByText("No payments yet.")).toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Export CSV" }),
    ).not.toBeInTheDocument();
  });
});
