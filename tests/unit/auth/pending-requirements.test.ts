import { describe, expect, it } from "vitest";
import {
  type MemberProfile,
  listPendingRequirements,
  resolveAccountStatus,
} from "@/lib/auth/account-activation";

/**
 * La regla de "qué le falta a esta cuenta" vive en una sola función (nota
 * técnica del ticket #133): la misma que consulta la pantalla de completar
 * registro y la que decide el paso a `active`. Dos copias acabarían
 * discrepando, y la discrepancia sería una cuenta activa sin datos.
 */


const COMPLETE_ADULT_PROFILE: MemberProfile = {
  country: "AU",
  dateOfBirth: "1994-03-08",
  membershipType: "Full",
  guardianConsentAt: null,
  registeredAt: "2026-09-12T00:00:00.000Z",
};

function pendingFor(
  profile: Partial<MemberProfile>,
  emailConfirmed = true,
): readonly string[] {
  return listPendingRequirements({
    profile: { ...COMPLETE_ADULT_PROFILE, ...profile },
    emailConfirmed,
  });
}

describe("qué le falta a una cuenta", () => {
  it("no devuelve nada cuando una cuenta adulta tiene todo y el correo confirmado", () => {
    expect(pendingFor({})).toEqual([]);
  });

  it("nombra el país cuando la fila no lo tiene", () => {
    expect(pendingFor({ country: null })).toEqual(["country"]);
  });

  it("nombra la fecha de nacimiento cuando la fila no la tiene", () => {
    expect(pendingFor({ dateOfBirth: null })).toEqual(["dateOfBirth"]);
  });

  it("nombra el tipo de membresía cuando la fila no lo tiene", () => {
    expect(pendingFor({ membershipType: null })).toEqual(["membershipType"]);
  });

  it("nombra la confirmación del correo, que es otra razón para seguir incompleta", () => {
    expect(pendingFor({}, false)).toEqual(["emailConfirmation"]);
  });

  it("nombra el consentimiento del tutor de un menor sin consentimiento", () => {
    expect(pendingFor({ dateOfBirth: "2012-05-20" })).toEqual([
      "guardianConsent",
    ]);
  });

  it("no pide consentimiento a un menor que ya lo tiene registrado", () => {
    expect(
      pendingFor({
        dateOfBirth: "2012-05-20",
        guardianConsentAt: "2026-09-01T00:00:00Z",
      }),
    ).toEqual([]);
  });

  it("no inventa un consentimiento pendiente cuando no sabe la fecha de nacimiento", () => {
    expect(pendingFor({ dateOfBirth: null })).toEqual(["dateOfBirth"]);
  });

  it("devuelve todos los pendientes a la vez, no el primero", () => {
    expect(
      pendingFor({ country: null, membershipType: null, dateOfBirth: null }, false),
    ).toEqual(["country", "dateOfBirth", "membershipType", "emailConfirmation"]);
  });
});

describe("el estado de cuenta sale de la misma lista", () => {
  it("es active exactamente cuando no falta nada", () => {
    expect(
      resolveAccountStatus({
        profile: COMPLETE_ADULT_PROFILE,
        emailConfirmed: true,
      }),
    ).toBe("active");
  });

  it.each([
    ["el país", { country: null }],
    ["la fecha de nacimiento", { dateOfBirth: null }],
    ["el tipo de membresía", { membershipType: null }],
    ["el consentimiento del tutor", { dateOfBirth: "2012-05-20" }],
  ])("sigue incomplete cuando falta %s", (_name, missing) => {
    expect(
      resolveAccountStatus({
        profile: { ...COMPLETE_ADULT_PROFILE, ...missing },
        emailConfirmed: true,
      }),
    ).toBe("incomplete");
  });

  it("sigue incomplete mientras el correo no esté confirmado", () => {
    expect(
      resolveAccountStatus({
        profile: COMPLETE_ADULT_PROFILE,
        emailConfirmed: false,
      }),
    ).toBe("incomplete");
  });
});
