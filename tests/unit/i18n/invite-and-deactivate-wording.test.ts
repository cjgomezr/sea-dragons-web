import { describe, expect, it } from "vitest";
import type { Message, MessageKey } from "@/lib/i18n/message";
import { messageCatalogs } from "@/lib/i18n/message-catalogs";
import { createTranslator } from "@/lib/i18n/translator";

// #273: "dar de alta" y "dar de baja" suenan a trámite de oficina. El club
// invita a un miembro, y desactiva o reactiva su cuenta. Que las claves sigan
// emparejadas entre idiomas lo vigila `untranslated-text.test.ts`.
const OFFICE_WORDING = /\bdar de (alta|baja)\b|\bde baja\b/i;

// Los textos de la invitación y de la membresía que decían "alta": aquí no
// basta con "dar de alta", porque también estaban "Dimos de alta" o
// "Dando de alta".
const INVITE_AND_STATUS_KEY =
  /^(directory|newMember|memberStatus|memberRecord)\./;
const ALTA = /\bde alta\b/i;

function textsOf(message: Message): string[] {
  if (typeof message === "string") {
    return [message];
  }
  return Object.values(message).filter(
    (form): form is string => form !== undefined,
  );
}

function keysMatching(entries: [string, Message][], pattern: RegExp): string[] {
  return entries
    .filter(([, message]) =>
      textsOf(message).some((text) => pattern.test(text)),
    )
    .map(([key]) => key);
}

describe("textos de invitar y desactivar", () => {
  it("ningún texto del catálogo español dice dar de alta, dar de baja ni de baja", () => {
    const entries = Object.entries(messageCatalogs.es);

    expect(keysMatching(entries, OFFICE_WORDING)).toEqual([]);
  });

  it("ni el directorio, ni la invitación ni la membresía dicen de alta", () => {
    const entries = Object.entries(messageCatalogs.es).filter(([key]) =>
      INVITE_AND_STATUS_KEY.test(key),
    );

    expect(keysMatching(entries, ALTA)).toEqual([]);
  });

  it.each<[MessageKey, string, string]>([
    ["directory.addMember", "Invitar miembro", "Invite member"],
    ["newMember.title", "Invitar miembro", "Invite member"],
    [
      "newMember.metaTitle",
      "Invitar miembro · Victoria Seadragons",
      "Invite member · Victoria Seadragons",
    ],
    ["newMember.submit", "Invitar miembro", "Invite member"],
    ["newMember.addAnother", "Invitar a otro miembro", "Invite another member"],
    ["memberStatus.deactivate", "Desactivar cuenta", "Deactivate account"],
    ["memberStatus.reactivate", "Reactivar cuenta", "Reactivate account"],
    ["directory.mark.inactive", "Desactivada", "Deactivated"],
  ])("%s dice «%s» y «%s»", (key, spanish, english) => {
    expect(messageCatalogs.es[key]).toBe(spanish);
    expect(messageCatalogs.en[key]).toBe(english);
  });

  it("avisa en español que la cuenta quedó desactivada o reactivada", () => {
    const translate = createTranslator("es");

    expect(translate("memberStatus.deactivated", { name: "Ana" })).toBe(
      "La cuenta de Ana quedó desactivada.",
    );
    expect(translate("memberStatus.reactivated", { name: "Ana" })).toBe(
      "La cuenta de Ana quedó reactivada.",
    );
  });

  it("avisa en inglés que la cuenta quedó desactivada o reactivada", () => {
    const translate = createTranslator("en");

    expect(translate("memberStatus.deactivated", { name: "Ana" })).toBe(
      "Ana's account was deactivated.",
    );
    expect(translate("memberStatus.reactivated", { name: "Ana" })).toBe(
      "Ana's account was reactivated.",
    );
  });

  it("el filtro de los inactivos habla de cuentas desactivadas en inglés", () => {
    expect(createTranslator("en")("directory.includeInactive")).toMatch(
      /deactivated/i,
    );
  });
});
