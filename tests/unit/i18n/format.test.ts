import { describe, expect, it, vi } from "vitest";
import { describeAuthIssue } from "@/lib/auth/issue-messages";
import {
  EARLIEST_DATE_OF_BIRTH,
  validateDateOfBirthField,
} from "@/lib/auth/registration";
import {
  formatCalendarDay,
  formatCalendarDayAt,
  formatCalendarDayParts,
  formatClubMoment,
  formatWeekdays,
  formatFileSize,
  formatNumber,
  formatOverallRating,
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

  // Cómo se unen fecha y hora lo decide la versión de datos de idioma que trae
  // cada Node y cada navegador: con unas sale "15 de septiembre de 2026, 18:00"
  // y con otras "… a las 18:00". Si el texto dependiera de eso, el servidor y
  // el navegador de un socio podrían escribir la misma fecha distinta (#188).
  it("une fecha y hora igual aunque la versión de datos de idioma cambie su separador", async () => {
    const RealDateTimeFormat = Intl.DateTimeFormat;
    const intlWithOtherJoiner = Object.create(Intl) as typeof Intl;
    intlWithOtherJoiner.DateTimeFormat = function (
      locales?: string | string[],
      options?: Intl.DateTimeFormatOptions,
    ) {
      const real = new RealDateTimeFormat(locales, options);
      if (options?.dateStyle !== undefined && options.timeStyle !== undefined) {
        return {
          format: (date?: Date | number) =>
            real.format(date).replace(", ", " a las "),
        };
      }
      return real;
    } as unknown as typeof Intl.DateTimeFormat;
    vi.stubGlobal("Intl", intlWithOtherJoiner);
    vi.resetModules();

    try {
      const { formatClubMoment: formatWithOtherData } =
        await import("@/lib/i18n/format");

      expect(formatWithOtherData("es", instant)).toBe(
        "15 de septiembre de 2026, 18:00",
      );
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
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

describe("tamaños de archivo", () => {
  it("deja en bytes lo que no llega a un kilobyte", () => {
    expect(formatFileSize("en", 512)).toBe("512 B");
  });

  it("redondea a kilobytes enteros lo que no llega a un megabyte", () => {
    expect(formatFileSize("en", 240 * 1024 + 300)).toBe("240 KB");
  });

  it("escribe los megabytes con un decimal y el separador del idioma", () => {
    const bytes = Math.round(2.4 * 1024 * 1024);

    expect(formatFileSize("en", bytes)).toBe("2.4 MB");
    expect(formatFileSize("es", bytes)).toBe("2,4 MB");
  });

  it("no enseña un decimal que es cero", () => {
    expect(formatFileSize("en", 10 * 1024 * 1024)).toBe("10 MB");
  });
});

describe("OVR por idioma", () => {
  it("escribe siempre un decimal, también en una media entera", () => {
    expect(formatOverallRating("en", 5)).toBe("5.0");
  });

  it("usa la coma decimal en español", () => {
    expect(formatOverallRating("es", 7.9)).toBe("7,9");
  });
});

// #310: un evento guarda su día y su hora de Melbourne por separado, sin
// instante, y una serie guarda sus días de la semana.
describe("día y hora de un evento", () => {
  it("escribe el día y la hora en inglés australiano", () => {
    expect(formatCalendarDayAt("en", "2027-07-10", "19:00")).toBe(
      "10 July 2027 at 7:00 pm",
    );
  });

  it("escribe el día y la hora a la española, con reloj de 24 horas", () => {
    expect(formatCalendarDayAt("es", "2027-07-10", "19:00")).toBe(
      "10 de julio de 2027, 19:00",
    );
  });

  it("escribe la medianoche sin moverla al día de al lado", () => {
    expect(formatCalendarDayAt("en", "2027-07-10", "00:00")).toBe(
      "10 July 2027 at 12:00 am",
    );
  });

  it("rechaza una hora que no es HH:MM", () => {
    expect(() => formatCalendarDayAt("en", "2027-07-10", "7pm")).toThrow(
      RangeError,
    );
  });
});

describe("días de la semana", () => {
  it("nombra los días en inglés, unidos como una lista", () => {
    expect(formatWeekdays("en", [2, 4])).toBe("Tuesday and Thursday");
  });

  it("nombra los días en español, en minúscula", () => {
    expect(formatWeekdays("es", [1, 3, 5])).toBe("lunes, miércoles y viernes");
  });

  it("nombra el domingo como el día 7", () => {
    expect(formatWeekdays("es", [7])).toBe("domingo");
  });
});

describe("bloque de fecha de la agenda", () => {
  // En inglés australiano el mes corto de junio es "June" y el de septiembre
  // "Sept": el mockup dice "JUN", pero el inglés de la aplicación es el de
  // Melbourne.
  it("parte un día en día de la semana, número y mes, en inglés", () => {
    expect(formatCalendarDayParts("en", "2026-06-23")).toEqual({
      weekday: "Tue",
      day: "23",
      month: "June",
    });
  });

  it("parte el mismo día a la española", () => {
    expect(formatCalendarDayParts("es", "2026-06-23")).toEqual({
      weekday: "mar",
      day: "23",
      month: "jun",
    });
  });

  it("escribe el número del día con dos cifras, como el mockup", () => {
    expect(formatCalendarDayParts("en", "2026-07-03").day).toBe("03");
  });

  it("rechaza un día que no existe en el calendario", () => {
    expect(() => formatCalendarDayParts("en", "2026-02-30")).toThrow(
      RangeError,
    );
  });
});
