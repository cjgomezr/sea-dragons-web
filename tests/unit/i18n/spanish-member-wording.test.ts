import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/i18n/message";
import { messageCatalogs } from "@/lib/i18n/message-catalogs";
import { createTranslator } from "@/lib/i18n/translator";

// #246: en un club quien pertenece es un miembro, no un socio. El inglés ya
// decía "member", así que la palabra nueva además alinea los dos catálogos.
// Que las claves sigan emparejadas lo vigila `untranslated-text.test.ts`.
const SOCIO = /\bsocios?\b/i;

function textsOf(message: Message): string[] {
  if (typeof message === "string") {
    return [message];
  }
  return Object.values(message).filter(
    (form): form is string => form !== undefined,
  );
}

describe("catálogo en español", () => {
  it("no llama socio a quien pertenece al club", () => {
    const keysSayingSocio = Object.entries(messageCatalogs.es)
      .filter(([, message]) =>
        textsOf(message).some((text) => SOCIO.test(text)),
      )
      .map(([key]) => key);

    expect(keysSayingSocio).toEqual([]);
  });
});

describe("plurales", () => {
  const translate = createTranslator("es");

  it("cuenta un miembro en singular", () => {
    expect(translate("groups.memberCount", { count: 1 })).toBe("1 miembro");
  });

  it("cuenta varios miembros en plural", () => {
    expect(translate("groups.memberCount", { count: 2 })).toBe("2 miembros");
  });

  it("pregunta por el grupo que borra nombrando a su único miembro", () => {
    expect(
      translate("groups.deleteQuestion", { name: "Senior", count: 1 }),
    ).toBe("¿Borrar «Senior»? Tiene 1 miembro, que sigue en el club.");
  });
});
