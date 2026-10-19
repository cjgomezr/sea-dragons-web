import { describe, expect, it } from "vitest";
import { isSameClubIdentity } from "@/lib/club/club-settings";
import { isSamePackList } from "@/lib/club/session-packs";
import { isSameSignInTexts, NO_SIGN_IN_TEXTS } from "@/lib/club/sign-in-texts";

/**
 * Si el borrador de una sección de la configuración difiere de lo guardado
 * (#719, RF-2 del PRD de E26): es lo que decide si sale la barra de cambios
 * sin guardar. Se compara como lo guardaría la base, no como se escribió.
 */

const STORED_IDENTITY = {
  name: "Harbour Hammerheads",
  initials: "HH",
  accentColor: "#1c6ea4",
  seasonStartsOn: null,
} as const;

describe("la identidad del club sin cambios", () => {
  it("es igual a sí misma", () => {
    expect(isSameClubIdentity(STORED_IDENTITY, STORED_IDENTITY)).toBe(true);
  });

  it("cuenta un nombre distinto como cambio", () => {
    const draft = { ...STORED_IDENTITY, name: "Bay Barracudas" };

    expect(isSameClubIdentity(draft, STORED_IDENTITY)).toBe(false);
  });

  it("no cuenta los espacios de los extremos del nombre", () => {
    const draft = { ...STORED_IDENTITY, name: " Harbour Hammerheads " };

    expect(isSameClubIdentity(draft, STORED_IDENTITY)).toBe(true);
  });

  it("toma unas iniciales vacías como ninguna", () => {
    const stored = { ...STORED_IDENTITY, initials: null };
    const draft = { ...STORED_IDENTITY, initials: "  " };

    expect(isSameClubIdentity(draft, stored)).toBe(true);
  });

  it("cuenta unas iniciales borradas como cambio", () => {
    const draft = { ...STORED_IDENTITY, initials: null };

    expect(isSameClubIdentity(draft, STORED_IDENTITY)).toBe(false);
  });

  it("no distingue mayúsculas en el acento", () => {
    const draft = { ...STORED_IDENTITY, accentColor: "#1C6EA4" };

    expect(isSameClubIdentity(draft, STORED_IDENTITY)).toBe(true);
  });

  it("cuenta un acento distinto como cambio", () => {
    const draft = { ...STORED_IDENTITY, accentColor: "#7b3fa0" };

    expect(isSameClubIdentity(draft, STORED_IDENTITY)).toBe(false);
  });

  // #744
  it("cuenta un inicio de temporada nuevo como cambio", () => {
    const draft = { ...STORED_IDENTITY, seasonStartsOn: "2026-03-02" };

    expect(isSameClubIdentity(draft, STORED_IDENTITY)).toBe(false);
  });
});

describe("los textos de entrada sin cambios", () => {
  it("son iguales sin ningún texto", () => {
    expect(isSameSignInTexts(NO_SIGN_IN_TEXTS, NO_SIGN_IN_TEXTS)).toBe(true);
  });

  it("toman un campo en blanco como el texto de la aplicación", () => {
    const draft = {
      ...NO_SIGN_IN_TEXTS,
      es: { tagline: "   ", welcome: "" },
    };

    expect(isSameSignInTexts(draft, NO_SIGN_IN_TEXTS)).toBe(true);
  });

  it("cuentan un lema escrito como cambio", () => {
    const draft = {
      ...NO_SIGN_IN_TEXTS,
      en: { tagline: "Under the surface", welcome: null },
    };

    expect(isSameSignInTexts(draft, NO_SIGN_IN_TEXTS)).toBe(false);
  });

  it("no cuentan los espacios de los extremos", () => {
    const stored = {
      ...NO_SIGN_IN_TEXTS,
      en: { tagline: "Under the surface", welcome: null },
    };
    const draft = {
      ...NO_SIGN_IN_TEXTS,
      en: { tagline: "Under the surface  ", welcome: null },
    };

    expect(isSameSignInTexts(draft, stored)).toBe(true);
  });
});

describe("la lista de packs sin cambios", () => {
  it("es igual con los mismos packs en el mismo orden", () => {
    expect(isSamePackList([5, 10, 20], [5, 10, 20])).toBe(true);
  });

  it("cuenta otro orden como cambio: los socios los ven en ese orden", () => {
    expect(isSamePackList([10, 5, 20], [5, 10, 20])).toBe(false);
  });

  it("cuenta un pack de más como cambio", () => {
    expect(isSamePackList([5, 10, 20, 8], [5, 10, 20])).toBe(false);
  });

  it("cuenta un pack de menos como cambio", () => {
    expect(isSamePackList([5, 10], [5, 10, 20])).toBe(false);
  });
});
