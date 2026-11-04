import { describe, expect, it } from "vitest";
import type { Locale } from "@/lib/i18n/locale";
import type { Message } from "@/lib/i18n/message";
import { messageCatalogs } from "@/lib/i18n/message-catalogs";

/**
 * Los textos del registro (#967, D13 del PRD de E37). Ninguno escribe "AUF" a
 * fuego: lo pone el club en `{registration}`. Y cada uno se lee bien con los
 * tres nombres que puede recibir: "AUF", la palabra por defecto y uno de dos
 * palabras con género femenino, "Licencia FEDAS".
 */

type LooseCatalog = Readonly<Record<string, Message>>;

const REGISTRATION_PLACEHOLDER = "{registration}";
const OTHER_PLACEHOLDER = /\{(?!registration\})[^}]*\}/g;

const DEFAULT_WORD: Readonly<Record<Locale, string>> = {
  en: "Registration",
  es: "Registro",
};

const LOCALES: readonly Locale[] = ["en", "es"];

function templatesOf(message: Message): readonly string[] {
  return typeof message === "string"
    ? [message]
    : Object.values(message).filter(
        (template): template is string => template !== undefined,
      );
}

function registrationTemplates(locale: Locale): readonly [string, string][] {
  const catalog: LooseCatalog = messageCatalogs[locale];
  return Object.entries(catalog).flatMap(([key, message]) =>
    templatesOf(message)
      .filter((template) => template.includes(REGISTRATION_PLACEHOLDER))
      .map((template): [string, string] => [key, template]),
  );
}

function render(template: string, registrationName: string): string {
  return template
    .replaceAll(REGISTRATION_PLACEHOLDER, registrationName)
    .replace(OTHER_PLACEHOLDER, "7");
}

function hasRepeatedWord(text: string): boolean {
  const words = text.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u);
  return words.some((word, index) => word !== "" && word === words[index + 1]);
}

// Un artículo, contracción o demostrativo justo delante del nombre concuerda
// con su género ("el AUF", "del AUF"); un participio o adjetivo justo detrás,
// también ("AUF vencido").
const SPANISH_AGREEING_BEFORE =
  /\b(el|la|los|las|del|al|un|una|este|esta|ese|esa|aquel|aquella)\s+\{registration\}/i;
const SPANISH_AGREEING_AFTER =
  /\{registration\}\s+(\p{L}+(ado|ada|ido|ida|ados|adas|idos|idas)|nuev[oa]s?|vigente)\b/iu;

describe("los textos del registro", () => {
  it.each(LOCALES)("ninguno de %s escribe AUF a fuego", (locale) => {
    const catalog: LooseCatalog = messageCatalogs[locale];

    const hardCoded = Object.entries(catalog)
      .filter(([, message]) =>
        templatesOf(message).some((template) => template.includes("AUF")),
      )
      .map(([key]) => key);

    expect(hardCoded).toEqual([]);
  });

  it.each(LOCALES)("%s tiene textos con el nombre del registro", (locale) => {
    expect(registrationTemplates(locale).length).toBeGreaterThan(30);
  });

  it.each(
    LOCALES.flatMap((locale) =>
      ["AUF", DEFAULT_WORD[locale], "Licencia FEDAS"].map(
        (name): [Locale, string] => [locale, name],
      ),
    ),
  )("en %s, con el nombre %s, ninguno repite palabra", (locale, name) => {
    const repeated = registrationTemplates(locale)
      .map(([key, template]) => [key, render(template, name)])
      .filter(([, text]) => hasRepeatedWord(text ?? ""));

    expect(repeated).toEqual([]);
  });

  it("en español ninguno hace concordar un artículo o un adjetivo con el nombre", () => {
    const agreeing = registrationTemplates("es")
      .filter(
        ([, template]) =>
          SPANISH_AGREEING_BEFORE.test(template) ||
          SPANISH_AGREEING_AFTER.test(template),
      )
      .map(([key, template]) => `${key}: ${template}`);

    expect(agreeing).toEqual([]);
  });

  it.each(LOCALES)(
    "%s nunca pone el nombre junto a la palabra por defecto",
    (locale) => {
      const word = DEFAULT_WORD[locale].toLocaleLowerCase();
      const besideDefault = registrationTemplates(locale)
        .filter(([, template]) => {
          const lower = template.toLocaleLowerCase();
          return (
            lower.includes(`${word} {registration}`) ||
            lower.includes(`{registration} ${word}`)
          );
        })
        .map(([key]) => key);

      expect(besideDefault).toEqual([]);
    },
  );
});
