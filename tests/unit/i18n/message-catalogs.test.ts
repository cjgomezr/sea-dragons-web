import { describe, expect, it } from "vitest";
import { messageCatalogs } from "@/lib/i18n/message-catalogs";
import type { Message } from "@/lib/i18n/message";

type LooseCatalog = Readonly<Record<string, Message>>;

/** Las claves de `reference` que `candidate` no tiene. Devuelve nombres, no un
 * booleano, para que el fallo diga qué clave falta y no solo que falta algo. */
function keysMissingFrom(
  candidate: LooseCatalog,
  reference: LooseCatalog,
): string[] {
  return Object.keys(reference).filter((key) => !Object.hasOwn(candidate, key));
}

const PLACEHOLDER = /\{(\w+)\}/g;

function placeholdersOf(message: Message): string[] {
  const templates =
    typeof message === "string" ? [message] : Object.values(message);
  const names = templates.flatMap((template = "") =>
    [...template.matchAll(PLACEHOLDER)].map(([, name = ""]) => name),
  );
  return [...new Set(names)].sort();
}

describe("catálogo de mensajes", () => {
  const english: LooseCatalog = messageCatalogs.en;
  const spanish: LooseCatalog = messageCatalogs.es;

  it("el español tiene todas las claves del inglés", () => {
    expect(keysMissingFrom(spanish, english)).toEqual([]);
  });

  it("el inglés tiene todas las claves del español", () => {
    expect(keysMissingFrom(english, spanish)).toEqual([]);
  });

  it("la comparación nombra la clave que le falta a un idioma", () => {
    const withExtraKey = { ...english, "only.in.one.language": "Hola" };

    expect(keysMissingFrom(english, withExtraKey)).toEqual([
      "only.in.one.language",
    ]);
  });

  it("cada clave espera los mismos datos en los dos idiomas", () => {
    const mismatches = Object.keys(english).filter(
      (key) =>
        placeholdersOf(english[key]!).join() !==
        placeholdersOf(spanish[key]!).join(),
    );

    expect(mismatches).toEqual([]);
  });
});
