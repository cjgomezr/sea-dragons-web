import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * El nombre del registro del club (#967, RF-7 y D12 del PRD de E37) llega a
 * los textos como `{registration}`. El traductor lo recibe una vez, al
 * crearse, para que ninguna de las decenas de llamadas lo pase a mano.
 */

describe("el nombre del registro en el traductor", () => {
  it("rellena {registration} con el nombre del club sin pasarlo en la llamada", () => {
    const translate = createTranslator("en", {
      registrationName: "Licencia FEDAS",
    });

    expect(translate("memberRecord.auf.number")).toBe("Licencia FEDAS number");
  });

  it("usa la palabra inglesa por defecto si el club no tiene nombre", () => {
    const translate = createTranslator("en", { registrationName: null });

    expect(translate("memberRecord.auf.title")).toBe("Registration");
  });

  it("usa la palabra española por defecto si el club no tiene nombre", () => {
    const translate = createTranslator("es", { registrationName: null });

    expect(translate("memberRecord.auf.number")).toBe("Número de Registro");
  });

  it("usa la palabra por defecto si quien lo crea no dice nada del registro", () => {
    const translate = createTranslator("es");

    expect(translate("memberRecord.auf.title")).toBe("Registro");
  });

  it("sigue rellenando los demás datos junto al nombre", () => {
    const translate = createTranslator("en", { registrationName: "AUF" });

    expect(translate("memberRecord.issue.aufNumberTooLong", { max: 32 })).toBe(
      "The AUF number can have at most 32 characters.",
    );
  });

  it("lleva el nombre también a un mensaje plural", () => {
    const translate = createTranslator("en", { registrationName: "AUF" });

    expect(translate("directory.overview.aufTitle", { count: 2 })).toBe(
      "2 members need to renew their AUF",
    );
  });
});
