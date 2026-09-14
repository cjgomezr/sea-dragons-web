import { describe, expect, it } from "vitest";
import {
  REDACTED_EMAIL,
  describeErrorWithoutEmail,
  redactEmail,
} from "@/lib/email/redact-email";

const EMAIL = "nerea@example.test";

describe("redactEmail", () => {
  it("reemplaza cada aparición de la dirección", () => {
    const text = redactEmail(`${EMAIL} y otra vez ${EMAIL}`, EMAIL);

    expect(text).toBe(`${REDACTED_EMAIL} y otra vez ${REDACTED_EMAIL}`);
  });

  it("deja el texto intacto con una dirección vacía, en vez de sembrarlo de marcas", () => {
    expect(redactEmail("sin dirección", "")).toBe("sin dirección");
  });
});

describe("describeErrorWithoutEmail", () => {
  it("conserva el mensaje del error y quita la dirección", () => {
    const text = describeErrorWithoutEmail(
      new Error(`Email address "${EMAIL}" is invalid`),
      EMAIL,
    );

    expect(text).toContain("is invalid");
    expect(text).not.toContain(EMAIL);
  });

  it("incluye las causas anidadas, que es donde está el motivo de un fallo de red", () => {
    const network = new Error("ECONNRESET");
    const fetchFailed = new TypeError("fetch failed", { cause: network });
    const wrapper = new Error(`No se pudo hablar con Resend para ${EMAIL}`, {
      cause: fetchFailed,
    });

    const text = describeErrorWithoutEmail(wrapper, EMAIL);

    expect(text).toContain("fetch failed");
    expect(text).toContain("ECONNRESET");
    expect(text).not.toContain(EMAIL);
  });

  it("corta una cadena de causas circular en vez de colgarse", () => {
    const loop = new Error("vuelve a sí mismo");
    loop.cause = loop;

    const text = describeErrorWithoutEmail(loop, EMAIL);

    expect(text).toContain("vuelve a sí mismo");
  });

  it("describe también lo que no es un Error", () => {
    expect(describeErrorWithoutEmail(`falló ${EMAIL}`, EMAIL)).toBe(
      `falló ${REDACTED_EMAIL}`,
    );
  });
});
