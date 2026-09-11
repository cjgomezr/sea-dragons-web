import { describe, expect, it } from "vitest";
import {
  type AccountStatus,
  type IdentityConfirmationReader,
  type MemberAccountRecord,
  type MemberAccountStore,
  MemberNotFoundError,
  type MemberProfile,
  activateAccountIfComplete,
  isMinorOn,
  resolveAccountStatus,
} from "@/lib/auth/account-activation";

const NOW = new Date("2026-09-12T03:00:00.000Z");
const MEMBER_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";

function profileWith(overrides: Partial<MemberProfile> = {}): MemberProfile {
  return {
    country: "AU",
    dateOfBirth: "1994-03-02",
    membershipType: "Full",
    guardianConsentAt: null,
    ...overrides,
  };
}

describe("edad del socio", () => {
  it("cuenta como menor a quien todavía no cumple 18", () => {
    expect(isMinorOn("2010-09-13", "2026-09-12")).toBe(true);
  });

  it("deja de contar como menor el día que cumple 18", () => {
    expect(isMinorOn("2008-09-12", "2026-09-12")).toBe(false);
  });

  it("no confunde el mes con el día", () => {
    expect(isMinorOn("2008-12-01", "2026-09-12")).toBe(true);
  });
});

describe("estado de la cuenta", () => {
  it("sigue incompleta mientras el correo no esté confirmado", () => {
    expect(
      resolveAccountStatus({
        profile: profileWith(),
        emailConfirmed: false,
        now: NOW,
      }),
    ).toBe("incomplete");
  });

  it("pasa a activa cuando el correo se confirma y no falta ningún dato", () => {
    expect(
      resolveAccountStatus({
        profile: profileWith(),
        emailConfirmed: true,
        now: NOW,
      }),
    ).toBe("active");
  });

  it.each([
    ["el país", { country: null }],
    ["la fecha de nacimiento", { dateOfBirth: null }],
    ["el tipo de membresía", { membershipType: null }],
  ] as const)("sigue incompleta si falta %s", (_label, missing) => {
    expect(
      resolveAccountStatus({
        profile: profileWith(missing),
        emailConfirmed: true,
        now: NOW,
      }),
    ).toBe("incomplete");
  });

  it("no activa a un menor sin el consentimiento de su tutor (NFR-012)", () => {
    expect(
      resolveAccountStatus({
        profile: profileWith({ dateOfBirth: "2010-09-13" }),
        emailConfirmed: true,
        now: NOW,
      }),
    ).toBe("incomplete");
  });

  it("activa a un menor cuyo consentimiento ya está registrado", () => {
    expect(
      resolveAccountStatus({
        profile: profileWith({
          dateOfBirth: "2010-09-13",
          guardianConsentAt: "2026-09-11T10:00:00.000Z",
        }),
        emailConfirmed: true,
        now: NOW,
      }),
    ).toBe("active");
  });
});

type ActivationDoubles = {
  readonly store: MemberAccountStore;
  readonly identities: IdentityConfirmationReader;
  readonly written: { memberId: string; status: AccountStatus }[];
};

function activationDoubles(options: {
  readonly record: MemberAccountRecord | null;
  readonly emailConfirmed: boolean;
}): ActivationDoubles {
  const written: { memberId: string; status: AccountStatus }[] = [];
  return {
    written,
    store: {
      async findByUserId() {
        return options.record;
      },
      async updateAccountStatus(memberId, status) {
        written.push({ memberId, status });
      },
    },
    identities: {
      async isEmailConfirmed() {
        return options.emailConfirmed;
      },
    },
  };
}

function recordWith(
  overrides: Partial<MemberAccountRecord> = {},
): MemberAccountRecord {
  return {
    memberId: MEMBER_ID,
    accountStatus: "incomplete",
    profile: profileWith(),
    ...overrides,
  };
}

describe("activación de la cuenta", () => {
  it("activa la cuenta cuyo único pendiente era la confirmación", async () => {
    const given = activationDoubles({
      record: recordWith(),
      emailConfirmed: true,
    });

    const result = await activateAccountIfComplete(given, USER_ID, {
      now: NOW,
    });

    expect(result).toEqual({ kind: "activated" });
    expect(given.written).toEqual([{ memberId: MEMBER_ID, status: "active" }]);
  });

  it("no escribe nada si la cuenta sigue incompleta", async () => {
    const given = activationDoubles({
      record: recordWith(),
      emailConfirmed: false,
    });

    const result = await activateAccountIfComplete(given, USER_ID, {
      now: NOW,
    });

    expect(result).toEqual({ kind: "unchanged", status: "incomplete" });
    expect(given.written).toEqual([]);
  });

  it("no reescribe una cuenta que ya estaba activa", async () => {
    const given = activationDoubles({
      record: recordWith({ accountStatus: "active" }),
      emailConfirmed: true,
    });

    const result = await activateAccountIfComplete(given, USER_ID, {
      now: NOW,
    });

    expect(result).toEqual({ kind: "unchanged", status: "active" });
    expect(given.written).toEqual([]);
  });

  it("no resucita una cuenta dada de baja", async () => {
    const given = activationDoubles({
      record: recordWith({ accountStatus: "inactive" }),
      emailConfirmed: true,
    });

    const result = await activateAccountIfComplete(given, USER_ID, {
      now: NOW,
    });

    expect(result).toEqual({ kind: "unchanged", status: "inactive" });
    expect(given.written).toEqual([]);
  });

  it("falla con contexto si la identidad no tiene fila de miembro", async () => {
    const given = activationDoubles({ record: null, emailConfirmed: true });

    await expect(
      activateAccountIfComplete(given, USER_ID, { now: NOW }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});
