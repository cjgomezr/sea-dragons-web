import { describe, expect, it } from "vitest";
import { messageCatalogs } from "@/lib/i18n/message-catalogs";
import type { Message } from "@/lib/i18n/message";

type LooseCatalog = Readonly<Record<string, Message>>;

const PLACEHOLDER = /\{([^}]*)\}/g;

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

  // Que los dos idiomas tengan las mismas claves lo vigila
  // `untranslated-text.test.ts`, junto a los textos incrustados (RF-8).
  it("cada clave espera los mismos datos en los dos idiomas", () => {
    const mismatches = Object.keys(english).filter(
      (key) =>
        placeholdersOf(english[key]!).join() !==
        placeholdersOf(spanish[key]!).join(),
    );

    expect(mismatches).toEqual([]);
  });

  // D8 de E12 (#480): el tipo de membresía se elige en Pagos, no en el
  // registro, y los textos de ese campo se fueron con él.
  it.each([
    "auth.field.membershipType",
    "auth.field.membershipTypePlaceholder",
    "auth.issue.membershipTypeUnknown",
  ])("ninguno de los dos idiomas conserva %s", (key) => {
    expect(Object.keys(english)).not.toContain(key);
    expect(Object.keys(spanish)).not.toContain(key);
  });
});
