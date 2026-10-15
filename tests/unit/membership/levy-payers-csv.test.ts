import { describe, expect, it } from "vitest";
import { CSV_BYTE_ORDER_MARK } from "@/lib/directory/directory-csv";
import { createTranslator } from "@/lib/i18n/translator";
import type { LevyBuyer } from "@/lib/membership/levy-sales";
import {
  levyPayersCsv,
  levyPayersCsvFilename,
} from "@/lib/membership/levy-payers-csv";

/**
 * El CSV de los compradores de un extra (#531, #634): una fila por compra,
 * con sus unidades y sin faltantes (D1 del PRD de E23), con el mismo
 * codificador que el directorio.
 */

const CRLF = "\r\n";

const BUYERS: readonly LevyBuyer[] = [
  {
    userId: "bruno",
    fullName: "Díaz, Bruno",
    email: "bruno@club.test",
    quantity: 2,
    // 23:30 en UTC ya es el día siguiente en Melbourne.
    paidAt: "2026-10-02T23:30:00.000Z",
    amountCents: 16100,
  },
  {
    userId: "alba",
    fullName: "=Alba",
    email: "alba@club.test",
    quantity: 1,
    paidAt: "2026-10-01T10:00:00.000Z",
    amountCents: 8050,
  },
];

function linesOf(csv: string): readonly string[] {
  return csv.slice(CSV_BYTE_ORDER_MARK.length).split(CRLF);
}

describe("levyPayersCsv", () => {
  it("empieza por la marca de orden de bytes", () => {
    const csv = levyPayersCsv(BUYERS, createTranslator("en"));

    expect(csv.startsWith(CSV_BYTE_ORDER_MARK)).toBe(true);
  });

  it("pone las cabeceras en inglés, con Units y sin Paid", () => {
    const [header] = linesOf(levyPayersCsv(BUYERS, createTranslator("en")));

    expect(header).toBe("Name,Email,Units,Payment date,Amount (AUD)");
  });

  it("pone las cabeceras en español, con Unidades y sin Pagó", () => {
    const [header] = linesOf(levyPayersCsv(BUYERS, createTranslator("es")));

    expect(header).toBe("Nombre,Correo,Unidades,Fecha del pago,Importe (AUD)");
  });

  it("da una fila por compra, en el orden en que llegan", () => {
    const lines = linesOf(levyPayersCsv(BUYERS, createTranslator("en")));

    expect(lines.slice(1)).toEqual([
      '"Díaz, Bruno",bruno@club.test,2,2026-10-03,161.00',
      "'=Alba,alba@club.test,1,2026-10-01,80.50",
      "",
    ]);
  });

  it("sin compras sólo lleva la cabecera", () => {
    const lines = linesOf(levyPayersCsv([], createTranslator("en")));

    expect(lines).toEqual(["Name,Email,Units,Payment date,Amount (AUD)", ""]);
  });
});

describe("levyPayersCsvFilename", () => {
  it("lleva el levy, la palabra del idioma y el día del club", () => {
    expect(
      levyPayersCsvFilename({
        levyName: "Nationals 2026: Ñandú",
        todayInClub: "2026-10-08",
        translate: createTranslator("es"),
      }),
    ).toBe("nationals-2026-nandu-pagos-2026-10-08.csv");
  });

  it("en inglés usa su palabra", () => {
    expect(
      levyPayersCsvFilename({
        levyName: "Nationals 2026",
        todayInClub: "2026-10-08",
        translate: createTranslator("en"),
      }),
    ).toBe("nationals-2026-payments-2026-10-08.csv");
  });
});
