import { describe, expect, expectTypeOf, it } from "vitest";
import { createTranslator, type EntryParams } from "@/lib/i18n/translator";

describe("leer un mensaje", () => {
  it("devuelve el texto en inglés cuando se pide en inglés", () => {
    const translate = createTranslator("en");

    expect(translate("auth.passwordRecovery.checkEmailTitle")).toBe(
      "Check your email",
    );
  });

  it("devuelve el texto en español cuando se pide en español", () => {
    const translate = createTranslator("es");

    expect(translate("auth.passwordRecovery.checkEmailTitle")).toBe(
      "Revisa tu correo",
    );
  });

  it("no acepta una clave que no está en el catálogo", () => {
    const translate = createTranslator("en");

    // @ts-expect-error "auth.no.such.key" no es una MessageKey: si algún día
    // compilara, `npm run typecheck` fallaría por esta directiva sobrante.
    expect(() => translate("auth.no.such.key")).toThrow();
  });

  it("no acepta un mensaje con datos si no se le pasan", () => {
    const translate = createTranslator("en");

    // @ts-expect-error "auth.passwordRecovery.linkSent" necesita { email }.
    expect(() => translate("auth.passwordRecovery.linkSent")).toThrow();
  });
});

describe("mensajes con datos dentro", () => {
  it("inserta una dirección de correo en la frase en inglés", () => {
    const translate = createTranslator("en");

    expect(
      translate("auth.passwordRecovery.linkSent", { email: "ana@example.com" }),
    ).toBe(
      "If ana@example.com has a club account, we sent it a link to choose a new password.",
    );
  });

  it("inserta una dirección de correo en la frase en español", () => {
    const translate = createTranslator("es");

    expect(
      translate("auth.passwordRecovery.linkSent", { email: "ana@example.com" }),
    ).toBe(
      "Si ana@example.com tiene una cuenta en el club, te mandamos un enlace para elegir una contraseña nueva.",
    );
  });

  it("con un valor vacío no lanza ni deja la marca sin rellenar, aunque quede el hueco", () => {
    const translate = createTranslator("es");

    expect(translate("auth.passwordRecovery.linkSent", { email: "" })).toBe(
      "Si  tiene una cuenta en el club, te mandamos un enlace para elegir una contraseña nueva.",
    );
  });

  it("pone el dato al principio en inglés y al final en español", () => {
    expect(
      createTranslator("en")("auth.emailRequest.retryAfter", { count: 5 }),
    ).toBe("5 minutes to go before you can ask for another link.");
    expect(
      createTranslator("es")("auth.emailRequest.retryAfter", { count: 5 }),
    ).toBe("Podrás pedir otro enlace dentro de 5 minutos.");
  });

  it("usa el singular con una sola unidad en los dos idiomas", () => {
    expect(
      createTranslator("en")("auth.emailRequest.retryAfter", { count: 1 }),
    ).toBe("1 minute to go before you can ask for another link.");
    expect(
      createTranslator("es")("auth.emailRequest.retryAfter", { count: 1 }),
    ).toBe("Podrás pedir otro enlace dentro de 1 minuto.");
  });

  it("escribe las cantidades con el formato de números de cada idioma", () => {
    expect(
      createTranslator("en")("auth.emailRequest.retryAfter", { count: 12000 }),
    ).toBe("12,000 minutes to go before you can ask for another link.");
    expect(
      createTranslator("es")("auth.emailRequest.retryAfter", { count: 12000 }),
    ).toBe("Podrás pedir otro enlace dentro de 12.000 minutos.");
  });

  it("no acepta un texto donde el mensaje espera una cantidad", () => {
    const translate = createTranslator("en");

    expect(() =>
      // @ts-expect-error `count` elige entre singular y plural: tiene que ser un número.
      translate("auth.emailRequest.retryAfter", { count: "5" }),
    ).toThrow();
  });

  it("con una categoría que el idioma no escribe usa la forma general", () => {
    // Para un millón `Intl.PluralRules("es")` devuelve `many`, que el
    // catálogo no trae.
    expect(
      createTranslator("es")("auth.emailRequest.retryAfter", {
        count: 1_000_000,
      }),
    ).toBe("Podrás pedir otro enlace dentro de 1.000.000 minutos.");
  });

  it("exige la cantidad a un plural aunque ninguna forma la escriba", () => {
    expectTypeOf<
      EntryParams<{ one: "One minute left"; other: "A few minutes left" }>
    >().toEqualTypeOf<{ readonly count: number }>();
  });
});
