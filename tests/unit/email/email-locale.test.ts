import { describe, expect, it } from "vitest";
import {
  type EmailLocaleDirectory,
  readEmailLocale,
} from "@/lib/email/email-locale";

const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";

function directoryStoring(stored: string | null): EmailLocaleDirectory & {
  readonly askedFor: string[];
} {
  const askedFor: string[] = [];
  return {
    askedFor,
    async findStoredEmailLocale(userId) {
      askedFor.push(userId);
      return stored;
    },
  };
}

describe("idioma de los correos del socio", () => {
  it.each(["en", "es"] as const)(
    "usa el idioma guardado en la fila (%s)",
    async (stored) => {
      const directory = directoryStoring(stored);

      const locale = await readEmailLocale(directory, USER_ID);

      expect(locale).toBe(stored);
    },
  );

  it("lo busca en la fila de la identidad que recibe el correo", async () => {
    const directory = directoryStoring("en");

    await readEmailLocale(directory, USER_ID);

    expect(directory.askedFor).toEqual([USER_ID]);
  });
});

describe("socio sin idioma guardado", () => {
  // Una identidad puede no tener fila de socio: la recuperación de contraseña
  // no la exige. Antes de E17 todos los correos salían en español.
  it("sin fila de socio, el correo cae en español", async () => {
    const locale = await readEmailLocale(directoryStoring(null), USER_ID);

    expect(locale).toBe("es");
  });

  it("con un idioma inesperado en la fila, el correo cae en español en vez de romperse", async () => {
    const locale = await readEmailLocale(directoryStoring("fr"), USER_ID);

    expect(locale).toBe("es");
  });
});
