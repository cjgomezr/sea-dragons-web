import { describe, expect, it } from "vitest";
import {
  EARLIEST_DATE_OF_BIRTH,
  MEMBERSHIP_TYPES,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  type RegistrationIssue,
  type RegistrationRequest,
  validateRegistration,
} from "@/lib/auth/registration";

// 13:00 del 12 de septiembre de 2026 en Melbourne, que en UTC sigue siendo el 12.
const NOW = new Date("2026-09-12T03:00:00.000Z");

function requestWith(
  overrides: Partial<RegistrationRequest> = {},
): RegistrationRequest {
  return {
    fullName: "Nerea Silva",
    email: "nerea@example.test",
    country: "AU",
    password: "bajoelagua",
    membershipType: "Full",
    dateOfBirth: "1994-03-02",
    ...overrides,
  };
}

function issuesOf(request: RegistrationRequest): readonly RegistrationIssue[] {
  const result = validateRegistration(request, { now: NOW });
  if (result.ok) {
    throw new Error("Se esperaba un registro inválido, pero fue aceptado.");
  }
  return result.issues;
}

function issueFor(
  request: RegistrationRequest,
  field: RegistrationIssue["field"],
): RegistrationIssue {
  const issue = issuesOf(request).find(
    (candidate) => candidate.field === field,
  );
  if (!issue) {
    throw new Error(`No se reportó ningún problema para el campo ${field}.`);
  }
  return issue;
}

describe("registro: validación", () => {
  it("acepta una solicitud completa y normaliza el correo y el país", () => {
    const result = validateRegistration(
      requestWith({ email: "  Nerea@Example.Test ", country: "au" }),
      { now: NOW },
    );

    expect(result).toEqual({
      ok: true,
      details: {
        fullName: "Nerea Silva",
        email: "nerea@example.test",
        country: "AU",
        password: "bajoelagua",
        membershipType: "Full",
        dateOfBirth: "1994-03-02",
      },
    });
  });

  it("acepta los tres tipos de membresía del SRD", () => {
    for (const membershipType of MEMBERSHIP_TYPES) {
      expect(
        validateRegistration(requestWith({ membershipType }), { now: NOW }).ok,
      ).toBe(true);
    }
  });

  it("rechaza una contraseña de 7 caracteres nombrando el mínimo de 8", () => {
    const issue = issueFor(requestWith({ password: "1234567" }), "password");

    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(issue.code).toBe("password_too_short");
  });

  it("acepta una contraseña de exactamente 8 caracteres", () => {
    expect(
      validateRegistration(requestWith({ password: "12345678" }), { now: NOW })
        .ok,
    ).toBe(true);
  });

  it("rechaza una contraseña más larga de lo que acepta el servicio de autenticación", () => {
    expect(PASSWORD_MAX_BYTES).toBe(72);
    const issue = issueFor(
      requestWith({ password: "a".repeat(PASSWORD_MAX_BYTES + 1) }),
      "password",
    );

    expect(issue.code).toBe("password_too_long");
  });

  it("acepta una contraseña de exactamente el máximo", () => {
    expect(
      validateRegistration(
        requestWith({ password: "a".repeat(PASSWORD_MAX_BYTES) }),
        { now: NOW },
      ).ok,
    ).toBe(true);
  });

  it("mide el máximo en bytes, que es como lo mide el servicio de autenticación", () => {
    // 40 letras acentuadas son 80 bytes en UTF-8: pasan de largo aunque
    // parezcan cortas. Contarlas como 40 dejaría que el rechazo llegara desde
    // Supabase, donde ya no se sabe qué campo era.
    const acentuada = "á".repeat(40);
    expect(acentuada.length).toBeLessThan(PASSWORD_MAX_BYTES);

    expect(
      issueFor(requestWith({ password: acentuada }), "password"),
    ).toBeDefined();
  });

  it("rechaza un tipo de membresía fuera del conjunto cerrado", () => {
    const issue = issueFor(
      requestWith({ membershipType: "Platinum" }),
      "membershipType",
    );

    expect(issue.code).toBe("membership_type_unknown");
  });

  it("rechaza una fecha de nacimiento en el futuro", () => {
    const issue = issueFor(
      requestWith({ dateOfBirth: "2026-09-13" }),
      "dateOfBirth",
    );

    expect(issue.code).toBe("date_of_birth_in_future");
  });

  it("acepta el día de hoy en Melbourne aunque en UTC todavía sea ayer", () => {
    // 23:30 UTC del 12 es la madrugada del 13 en Melbourne.
    const result = validateRegistration(
      requestWith({ dateOfBirth: "2026-09-13" }),
      { now: new Date("2026-09-12T23:30:00.000Z") },
    );

    expect(result.ok).toBe(true);
  });

  it("rechaza una fecha de nacimiento que no existe en el calendario", () => {
    expect(
      issueFor(requestWith({ dateOfBirth: "2026-02-30" }), "dateOfBirth"),
    ).toBeDefined();
  });

  it("rechaza una fecha de nacimiento con otro formato", () => {
    expect(
      issueFor(requestWith({ dateOfBirth: "02/03/1994" }), "dateOfBirth"),
    ).toBeDefined();
  });

  it("rechaza una fecha de nacimiento anterior a la más temprana admitida", () => {
    expect(EARLIEST_DATE_OF_BIRTH).toBe("1900-01-01");
    expect(
      issueFor(requestWith({ dateOfBirth: "1899-12-31" }), "dateOfBirth"),
    ).toBeDefined();
  });

  it("rechaza el registro sin país, porque FR-001 lo exige", () => {
    expect(issueFor(requestWith({ country: "" }), "country")).toBeDefined();
  });

  it("rechaza un país que no es un código ISO conocido", () => {
    expect(issueFor(requestWith({ country: "ZZ" }), "country")).toBeDefined();
  });

  it("rechaza un nombre completo en blanco", () => {
    expect(
      issueFor(requestWith({ fullName: "   " }), "fullName"),
    ).toBeDefined();
  });

  it("rechaza un correo sin forma de correo", () => {
    expect(issueFor(requestWith({ email: "nerea" }), "email")).toBeDefined();
  });

  it("reporta todos los campos inválidos a la vez, no solo el primero", () => {
    const fields = issuesOf(
      requestWith({ country: "", password: "corta", membershipType: "Gold" }),
    ).map((issue) => issue.field);

    expect(fields).toEqual(["country", "password", "membershipType"]);
  });
});
