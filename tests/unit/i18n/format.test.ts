import { describe, expect, it } from "vitest";
import { describeAuthIssue } from "@/lib/auth/issue-messages";
import {
  EARLIEST_DATE_OF_BIRTH,
  validateDateOfBirthField,
} from "@/lib/auth/registration";
import {
  formatCalendarDay,
  formatClubMoment,
  formatNumber,
} from "@/lib/i18n/format";
import { createTranslator } from "@/lib/i18n/translator";

// RF-7 del PRD E17: el idioma cambia cómo se escribe una fecha, la zona del
// club no cambia nunca.

describe("fechas por idioma", () => {
  const instant = new Date("2026-09-15T08:00:00.000Z");

  it("escribe un momento del club como se escribe en inglés australiano", () => {
    expect(formatClubMoment("en", instant)).toBe(
      "15 September 2026 at 6:00 pm",
    );
  });

  it("escribe ese mismo momento a la española", () => {
    expect(formatClubMoment("es", instant)).toBe(
      "15 de septiembre de 2026, 18:00",
    );
  });

  it("escribe un día sin hora en el formato de cada idioma", () => {
    expect(formatCalendarDay("en", "1994-03-02")).toBe("2 March 1994");
    expect(formatCalendarDay("es", "1994-03-02")).toBe("2 de marzo de 1994");
  });

  it("no inventa una hora para un día que no la tiene", () => {
    expect(formatCalendarDay("en", "1994-03-02")).not.toMatch(/\d:\d/);
    expect(formatCalendarDay("es", "1994-03-02")).not.toMatch(/\d:\d/);
  });

  it("rechaza un día que no está escrito como YYYY-MM-DD", () => {
    expect(() => formatCalendarDay("en", "02/03/1994")).toThrow(/02\/03\/1994/);
  });

  it("rechaza un día que no existe en el calendario", () => {
    expect(() => formatCalendarDay("es", "2026-02-30")).toThrow(/2026-02-30/);
  });
});

describe("zona horaria del club", () => {
  it("pone en el día de Melbourne un momento que en UTC es el día anterior", () => {
    // 14:30 UTC del 11 son las 00:30 del 12 en Melbourne (AEST, UTC+10).
    const instant = new Date("2026-09-11T14:30:00.000Z");

    expect(formatClubMoment("en", instant)).toBe(
      "12 September 2026 at 12:30 am",
    );
    expect(formatClubMoment("es", instant)).toBe(
      "12 de septiembre de 2026, 0:30",
    );
  });

  it("sigue el horario de verano de Melbourne (AEDT, UTC+11)", () => {
    const instant = new Date("2026-12-31T13:30:00.000Z");

    expect(formatClubMoment("en", instant)).toBe("1 January 2027 at 12:30 am");
    expect(formatClubMoment("es", instant)).toBe("1 de enero de 2027, 0:30");
  });

  it("no mueve de día una fecha sin hora, esté donde esté quien la mira", () => {
    expect(formatCalendarDay("en", "2027-01-01")).toBe("1 January 2027");
    expect(formatCalendarDay("es", "2027-01-01")).toBe("1 de enero de 2027");
  });
});

describe("números", () => {
  it("separa miles y decimales como en inglés", () => {
    expect(formatNumber("en", 12345.5)).toBe("12,345.5");
  });

  it("separa miles y decimales como en español", () => {
    expect(formatNumber("es", 12345.5)).toBe("12.345,5");
  });

  it("el traductor escribe los números del mensaje con el separador del idioma", () => {
    expect(
      createTranslator("en")("auth.field.passwordHint", { min: 12345.5 }),
    ).toBe("At least 12,345.5 characters.");
    expect(
      createTranslator("es")("auth.field.passwordHint", { min: 12345.5 }),
    ).toBe("Al menos 12.345,5 caracteres.");
  });
});

describe("fechas mostradas en la validación", () => {
  it("explica la fecha mínima de nacimiento en el formato de cada idioma", () => {
    expect(
      describeAuthIssue(createTranslator("en"), "date_of_birth_too_early"),
    ).toBe("Date of birth can't be before 1 January 1900.");
    expect(
      describeAuthIssue(createTranslator("es"), "date_of_birth_too_early"),
    ).toBe(
      "La fecha de nacimiento no puede ser anterior al 1 de enero de 1900.",
    );
  });

  it("lo que se compara y se guarda sigue en YYYY-MM-DD", () => {
    expect(EARLIEST_DATE_OF_BIRTH).toBe("1900-01-01");
    expect(
      validateDateOfBirthField("1899-12-31", new Date("2026-09-17T00:00:00Z")),
    ).toEqual({ ok: false, code: "date_of_birth_too_early" });
    expect(
      validateDateOfBirthField("1900-01-01", new Date("2026-09-17T00:00:00Z")),
    ).toEqual({ ok: true, value: "1900-01-01" });
  });
});
