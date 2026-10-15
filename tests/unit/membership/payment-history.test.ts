import { describe, expect, it } from "vitest";
import { CSV_BYTE_ORDER_MARK } from "@/lib/directory/directory-csv";
import { createTranslator } from "@/lib/i18n/translator";
import type { PaymentView } from "@/lib/membership/membership-view";
import {
  describePaymentMethod,
  filterPayments,
  groupPaymentsByMonth,
  paymentHistoryCsv,
  paymentHistoryCsvFilename,
  paymentHistoryFilters,
} from "@/lib/membership/payment-history";

/**
 * El historial de pagos rehecho (#631, RF-5 del PRD de E23): agrupado por el
 * mes de Melbourne, filtrado por estado y exportado a CSV con lo que deja ver
 * el filtro.
 */

const CRLF = "\r\n";
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

function idsByMonth(
  groups: ReturnType<typeof groupPaymentsByMonth>,
): readonly (readonly [string, readonly string[]])[] {
  return groups.map((group) => [
    group.month,
    group.payments.map(({ id }) => id),
  ]);
}

function linesOf(csv: string): readonly string[] {
  return csv.slice(CSV_BYTE_ORDER_MARK.length).split(CRLF);
}

describe("groupPaymentsByMonth", () => {
  it("agrupa por mes del más reciente al más antiguo", () => {
    const groups = groupPaymentsByMonth([
      payment({ id: "jul", date: "2026-07-01T00:00:00.000Z" }),
      payment({ id: "oct-1", date: "2026-10-01T00:00:00.000Z" }),
      payment({ id: "sep", date: "2026-09-18T00:00:00.000Z" }),
      payment({ id: "oct-12", date: "2026-10-12T00:00:00.000Z" }),
    ]);

    expect(idsByMonth(groups)).toEqual([
      ["2026-10", ["oct-12", "oct-1"]],
      ["2026-09", ["sep"]],
      ["2026-07", ["jul"]],
    ]);
  });

  it("pone diciembre de un año antes que enero del siguiente al revés", () => {
    const groups = groupPaymentsByMonth([
      payment({ id: "dec", date: "2025-12-15T00:00:00.000Z" }),
      payment({ id: "jan", date: "2026-01-15T00:00:00.000Z" }),
    ]);

    expect(idsByMonth(groups)).toEqual([
      ["2026-01", ["jan"]],
      ["2025-12", ["dec"]],
    ]);
  });

  it("deja un mes con un solo pago como un grupo de uno", () => {
    const groups = groupPaymentsByMonth([
      payment({ id: "only", date: "2026-03-10T00:00:00.000Z" }),
    ]);

    expect(idsByMonth(groups)).toEqual([["2026-03", ["only"]]]);
  });

  it("usa el mes de Melbourne y no el de UTC", () => {
    // 30 de septiembre a las 15:00 UTC ya es 1 de octubre en Melbourne.
    const groups = groupPaymentsByMonth([
      payment({ id: "edge", date: "2026-09-30T15:00:00.000Z" }),
    ]);

    expect(idsByMonth(groups)).toEqual([["2026-10", ["edge"]]]);
  });

  it("no devuelve grupos sin pagos", () => {
    expect(groupPaymentsByMonth([])).toEqual([]);
  });
});

describe("paymentHistoryFilters", () => {
  it("ofrece Todos, Pagados y Fallidos cuando no hay pendientes", () => {
    const filters = paymentHistoryFilters([
      payment({ id: "a" }),
      payment({ id: "b", status: "failed" }),
    ]);

    expect(filters).toEqual(["all", "paid", "failed"]);
  });

  it("añade Pendientes sólo si hay algún pago pendiente", () => {
    const filters = paymentHistoryFilters([
      payment({ id: "a" }),
      payment({ id: "b", status: "pending" }),
    ]);

    expect(filters).toEqual(["all", "paid", "failed", "pending"]);
  });
});

describe("filterPayments", () => {
  const PAYMENTS = [
    payment({ id: "paid" }),
    payment({ id: "failed", status: "failed" }),
    payment({ id: "pending", status: "pending" }),
  ];

  it("deja todos con Todos", () => {
    expect(filterPayments(PAYMENTS, "all").map(({ id }) => id)).toEqual([
      "paid",
      "failed",
      "pending",
    ]);
  });

  it("deja sólo los del estado elegido", () => {
    expect(filterPayments(PAYMENTS, "failed").map(({ id }) => id)).toEqual([
      "failed",
    ]);
  });
});

describe("describePaymentMethod", () => {
  it("escribe la marca y los cuatro últimos dígitos", () => {
    expect(describePaymentMethod(VISA)).toBe("Visa •••• 4242");
  });

  it("no escribe nada sin tarjeta", () => {
    expect(describePaymentMethod(null)).toBeNull();
  });
});

describe("paymentHistoryCsv", () => {
  const PAYMENTS = [
    payment({
      id: "jersey",
      // 23:30 en UTC ya es el día siguiente en Melbourne.
      date: "2026-09-17T23:30:00.000Z",
      description: 'Jersey "home", size M',
      amountCents: 6000,
    }),
    payment({
      id: "failed",
      date: "2026-08-01T00:00:00.000Z",
      description: null,
      status: "failed",
      card: null,
      failureReason: "Your card was declined.",
    }),
  ];

  it("empieza por la marca de orden de bytes", () => {
    const csv = paymentHistoryCsv(PAYMENTS, createTranslator("en"));

    expect(csv.startsWith(CSV_BYTE_ORDER_MARK)).toBe(true);
  });

  it("pone las cabeceras en inglés", () => {
    const [header] = linesOf(
      paymentHistoryCsv(PAYMENTS, createTranslator("en")),
    );

    expect(header).toBe("Date,Description,Method,Amount (AUD),Status");
  });

  it("pone las cabeceras en español", () => {
    const [header] = linesOf(
      paymentHistoryCsv(PAYMENTS, createTranslator("es")),
    );

    expect(header).toBe("Fecha,Descripción,Método,Importe (AUD),Estado");
  });

  it("entrecomilla una descripción con comas y comillas", () => {
    const [, jersey] = linesOf(
      paymentHistoryCsv(PAYMENTS, createTranslator("en")),
    );

    expect(jersey).toBe(
      '2026-09-18,"Jersey ""home"", size M",Visa •••• 4242,60.00,Paid',
    );
  });

  it("deja vacío el método nulo y traduce la descripción por defecto y el estado", () => {
    const [, , failed] = linesOf(
      paymentHistoryCsv(PAYMENTS, createTranslator("es")),
    );

    expect(failed).toBe("2026-08-01,Pago de membresía,,45.00,Fallido");
  });
});

describe("paymentHistoryCsvFilename", () => {
  it("nombra el archivo con el día del club en el idioma de la pantalla", () => {
    expect(
      paymentHistoryCsvFilename({
        todayInClub: "2026-10-16",
        translate: createTranslator("es"),
      }),
    ).toBe("pagos-2026-10-16.csv");
    expect(
      paymentHistoryCsvFilename({
        todayInClub: "2026-10-16",
        translate: createTranslator("en"),
      }),
    ).toBe("payments-2026-10-16.csv");
  });
});
