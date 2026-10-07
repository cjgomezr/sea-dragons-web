import { describe, expect, it } from "vitest";
import { CSV_BYTE_ORDER_MARK } from "@/lib/directory/directory-csv";
import { createTranslator } from "@/lib/i18n/translator";
import type { LevyPayersReport } from "@/lib/membership/levy-payers";
import {
  levyPayersCsv,
  levyPayersCsvFilename,
} from "@/lib/membership/levy-payers-csv";

/**
 * El CSV de quién pagó un levy (#531): una fila por socio, los que pagaron y
 * los que faltan, con el mismo codificador que el directorio.
 */

const CRLF = "\r\n";

const REPORT: LevyPayersReport = {
  levy: { id: "price_nationals", name: "Nationals 2026", amountCents: 8000 },
  summary: { paidCount: 1, missingCount: 2, collectedCents: 8050 },
  payers: [
    {
      userId: "bruno",
      fullName: "Díaz, Bruno",
      email: "bruno@club.test",
      // 23:30 en UTC ya es el día siguiente en Melbourne.
      paidAt: "2026-10-02T23:30:00.000Z",
      amountCents: 8050,
    },
  ],
  missing: [
    { userId: "alba", fullName: "=Alba", email: "alba@club.test" },
    { userId: "carla", fullName: "Carla Soto", email: "carla@club.test" },
  ],
};

function linesOf(csv: string): readonly string[] {
  return csv.slice(CSV_BYTE_ORDER_MARK.length).split(CRLF);
}

describe("levyPayersCsv", () => {
  it("empieza por la marca de orden de bytes", () => {
    const csv = levyPayersCsv(REPORT, createTranslator("en"));

    expect(csv.startsWith(CSV_BYTE_ORDER_MARK)).toBe(true);
  });

  it("pone las cabeceras en inglés", () => {
    const [header] = linesOf(levyPayersCsv(REPORT, createTranslator("en")));

    expect(header).toBe("Name,Email,Paid,Payment date,Amount (AUD)");
  });

  it("pone las cabeceras y los valores en español", () => {
    const lines = linesOf(levyPayersCsv(REPORT, createTranslator("es")));

    expect(lines[0]).toBe("Nombre,Correo,Pagó,Fecha del pago,Importe (AUD)");
    expect(lines[1]).toContain(",Sí,");
    expect(lines[2]).toContain(",No,");
  });

  it("da una fila por socio: primero los que pagaron, luego los que faltan", () => {
    const lines = linesOf(levyPayersCsv(REPORT, createTranslator("en")));

    expect(lines.slice(1)).toEqual([
      '"Díaz, Bruno",bruno@club.test,Yes,2026-10-03,80.50',
      "'=Alba,alba@club.test,No,,",
      "Carla Soto,carla@club.test,No,,",
      "",
    ]);
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
