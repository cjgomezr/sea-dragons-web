import { describe, expect, it } from "vitest";
import { validateGuardianConsent } from "@/lib/auth/guardian-consent";
import { AUTH_ISSUE_CODES, describeAuthIssue } from "@/lib/auth/issue-messages";
import {
  PASSWORD_MIN_LENGTH,
  validatePasswordField,
  validateRegistration,
} from "@/lib/auth/registration";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

const NOW = new Date("2026-09-13T02:00:00.000Z");

function describeIn(
  locale: Locale,
  code: (typeof AUTH_ISSUE_CODES)[number],
): string {
  return describeAuthIssue(createTranslator(locale), code);
}

describe("validación traducida", () => {
  it("la contraseña corta da un código, no una frase", () => {
    const validation = validatePasswordField("1234567");

    expect(validation).toEqual({ ok: false, code: "password_too_short" });
  });

  it("la contraseña corta se explica en inglés con el mínimo", () => {
    expect(describeIn("en", "password_too_short")).toBe(
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    );
  });

  it("la contraseña corta se explica en español como hasta ahora", () => {
    expect(describeIn("es", "password_too_short")).toBe(
      `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    );
  });

  it("el correo mal escrito se explica en los dos idiomas", () => {
    const validation = validateRegistration(
      {
        fullName: "Nerea Silva",
        email: "nerea-sin-arroba",
        country: "AU",
        password: "bajoelagua",
        membershipType: "Full",
        dateOfBirth: "1994-03-02",
      },
      { now: NOW },
    );
    const issue = validation.ok ? undefined : validation.issues[0];

    expect(issue).toEqual({ field: "email", code: "email_malformed" });
    expect(describeIn("en", "email_malformed")).toBe(
      "The email address is not valid.",
    );
    expect(describeIn("es", "email_malformed")).toBe(
      "El correo no tiene una forma válida.",
    );
  });

  it("el menor sin consentimiento se explica en los dos idiomas", () => {
    const validation = validateGuardianConsent({
      guardianName: "Marta Silva",
      guardianEmail: "marta@example.test",
      consent: false,
    });

    expect(validation).toEqual({
      ok: false,
      issues: [{ field: "consent", code: "consent_missing" }],
    });
    expect(describeIn("en", "consent_missing")).toBe(
      "Tick the consent box: without it the account is not activated.",
    );
    expect(describeIn("es", "consent_missing")).toBe(
      "Marca la casilla del consentimiento: sin ella la cuenta no se activa.",
    );
  });

  it.each<Locale>(["en", "es"])(
    "cada código tiene su texto en %s, sin llaves sin rellenar",
    (locale) => {
      const texts = AUTH_ISSUE_CODES.map((code) => describeIn(locale, code));

      expect(texts.every((text) => text.length > 0)).toBe(true);
      expect(texts.filter((text) => /[{}]/.test(text))).toEqual([]);
    },
  );

  it("un código dice cosas distintas en cada idioma", () => {
    const untranslated = AUTH_ISSUE_CODES.filter(
      (code) => describeIn("en", code) === describeIn("es", code),
    );

    expect(untranslated).toEqual([]);
  });
});
