import type { Metadata } from "next";
import { describe, expect, it, vi } from "vitest";
import type { Locale } from "@/lib/i18n/locale";
import type { Message } from "@/lib/i18n/message";
import { messageCatalogs } from "@/lib/i18n/message-catalogs";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * #293 (E18a, RF-1): el nombre del club entra en los textos como el dato
 * `{club}`, no escrito dentro del catálogo. La marca del test no es la
 * sembrada, así que un nombre que se quedara en el catálogo no pasaría.
 */

const requestLocale = { current: "en" as Locale };
const STORED_CLUB_NAME = "Hobart Orcas";
const SEEDED_CLUB_NAME = "Victoria Seadragons";
const LOCALES: readonly Locale[] = ["en", "es"];

vi.mock("@/lib/i18n/request-locale", () => ({
  readRequestLocale: async () => requestLocale.current,
}));
vi.mock("@/lib/club/supabase-club-brand", () => ({
  readClubBrand: async () => ({ name: STORED_CLUB_NAME, initials: "HO" }),
}));

type MetadataModule = { generateMetadata: () => Promise<Metadata> };

/** Las pantallas con título propio. */
const SCREEN_PATHS = [
  "@/app/(auth)/entrar/page",
  "@/app/(auth)/registro/page",
  "@/app/(auth)/completar-registro/page",
  "@/app/(auth)/recuperar-contrasena/page",
  "@/app/(auth)/recuperar-contrasena/nueva/page",
  "@/app/(app)/cuenta/page",
  "@/app/(app)/grupos/page",
  "@/app/(app)/directorio/page",
  "@/app/(app)/directorio/nuevo/page",
  "@/app/(app)/directorio/[id]/page",
] as const;

/** Las de fuera de la sesión nombran al club también en su descripción, que
 * es lo que enseña un buscador. */
const SCREENS_DESCRIBED_WITH_CLUB = SCREEN_PATHS.filter((path) =>
  path.startsWith("@/app/(auth)/"),
);

function inEveryLocale(
  paths: readonly string[],
): ReadonlyArray<readonly [Locale, string]> {
  return LOCALES.flatMap((locale) =>
    paths.map((path) => [locale, path] as const),
  );
}

function textsOf(message: Message): string[] {
  if (typeof message === "string") {
    return [message];
  }
  return Object.values(message).filter(
    (form): form is string => form !== undefined,
  );
}

async function readMetadataIn(locale: Locale, path: string): Promise<Metadata> {
  requestLocale.current = locale;
  const { generateMetadata } = (await import(path)) as MetadataModule;
  return generateMetadata();
}

describe("el nombre del club sale de los datos", () => {
  it.each(LOCALES)(
    "ninguna entrada del catálogo %s lleva escrito el nombre del club",
    (locale) => {
      const offenders = Object.entries(messageCatalogs[locale])
        .filter(([, message]) =>
          textsOf(message).some((text) => text.includes(SEEDED_CLUB_NAME)),
        )
        .map(([key]) => key);

      expect(offenders).toEqual([]);
    },
  );

  it.each(LOCALES)(
    "cada título de pestaña del catálogo %s pone el club tras el separador de siempre",
    (locale) => {
      const titles = Object.entries(messageCatalogs[locale]).filter(([key]) =>
        key.endsWith(".metaTitle"),
      );

      expect(titles.length).toBeGreaterThan(0);
      for (const [key, title] of titles) {
        expect({ key, title }).toEqual({
          key,
          title: expect.stringMatching(/^\S.* · \{club\}$/),
        });
      }
    },
  );

  it("arma un título con el nombre que se le pasa, en los dos idiomas", () => {
    const params = { club: STORED_CLUB_NAME };

    expect(createTranslator("es")("directory.metaTitle", params)).toBe(
      "Directorio · Hobart Orcas",
    );
    expect(createTranslator("en")("directory.metaTitle", params)).toBe(
      "Directory · Hobart Orcas",
    );
  });

  it.each(inEveryLocale(SCREEN_PATHS))(
    "en %s, %s se titula con el nombre guardado en la base",
    async (locale, path) => {
      const { title } = await readMetadataIn(locale, path);

      expect(title).toMatch(/^\S.* · Hobart Orcas$/);
    },
  );

  it.each(inEveryLocale(SCREENS_DESCRIBED_WITH_CLUB))(
    "en %s, %s se describe con el nombre guardado en la base",
    async (locale, path) => {
      const { description } = await readMetadataIn(locale, path);

      expect(description).toContain(STORED_CLUB_NAME);
    },
  );

  it.each(LOCALES)(
    "en %s, la descripción de la aplicación nombra al club guardado",
    async (locale) => {
      const { description } = await readMetadataIn(locale, "@/app/layout");

      expect(description).toContain(STORED_CLUB_NAME);
    },
  );
});
