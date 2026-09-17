import { describe, expect, it } from "vitest";
import { readApiErrorCode } from "@/lib/api/error-codes";

describe("leer el código de error de una respuesta", () => {
  it("devuelve el código de la convención cuando lo trae", () => {
    const payload = { error: { code: "rate_limited", message: "Espera." } };

    expect(readApiErrorCode(payload)).toBe("rate_limited");
  });

  it("no acepta un código que la convención no tiene", () => {
    const payload = { error: { code: "teapot", message: "Soy una tetera." } };

    expect(readApiErrorCode(payload)).toBeNull();
  });

  it("no revienta con una respuesta que no es de la API", () => {
    expect(readApiErrorCode("<html>502</html>")).toBeNull();
  });
});
