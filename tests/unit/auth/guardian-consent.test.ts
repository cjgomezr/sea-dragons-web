import { describe, expect, it } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import {
  type MemberAccountRecord,
  type MemberProfile,
  listPendingRequirements,
} from "@/lib/auth/account-activation";
import {
  AccountAlreadyResolvedError,
  type CompletedValues,
  completeRegistration,
} from "@/lib/auth/complete-registration";
import {
  type GuardianConsent,
  GuardianConsentAlreadyRecordedError,
  type GuardianConsentGateways,
  GuardianConsentNotRequiredError,
  type GuardianConsentRequest,
  GuardianConsentValidationError,
  recordGuardianConsent,
} from "@/lib/auth/guardian-consent";

/**
 * RF-3 del PRD de E2 (FR-082, NFR-012): un registrante menor de 18 no tiene
 * cuenta activa hasta que queda registrado el consentimiento de su tutor, con
 * nombre, correo y marca de tiempo.
 *
 * La edad que manda es la del DÍA DEL REGISTRO en Melbourne, no la de hoy:
 * quien se registró con 17 y cumple 18 esperando al tutor sigue necesitando el
 * consentimiento. Es la decisión que el ticket #134 pide dejar escrita.
 */

const MEMBER_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

/** Las 10:00 del 12 de septiembre de 2026 en Melbourne (AEST, UTC+10). */
const REGISTERED_AT = "2026-09-12T00:00:00.000Z";
const NOW = new Date("2026-09-14T02:00:00.000Z");

/** 16 años el día del registro. */
const SIXTEEN_YEAR_OLD_BIRTH = "2010-05-20";

const ADULT_PROFILE: MemberProfile = {
  country: "AU",
  dateOfBirth: "1994-03-08",
  membershipType: "Full",
  guardianConsentAt: null,
  registeredAt: REGISTERED_AT,
};

const VALID_REQUEST: GuardianConsentRequest = {
  guardianName: "Marta Silva",
  guardianEmail: "marta.silva@example.test",
  consent: true,
};

function pendingFor(profile: Partial<MemberProfile>): readonly string[] {
  return listPendingRequirements({
    profile: { ...ADULT_PROFILE, ...profile },
    emailConfirmed: true,
  });
}

function incompleteRecord(
  profile: Partial<MemberProfile>,
  overrides: Partial<MemberAccountRecord> = {},
): MemberAccountRecord {
  return {
    memberId: MEMBER_ID,
    clubId: CLUB_ID,
    accountStatus: "incomplete",
    profile: { ...ADULT_PROFILE, ...profile },
    ...overrides,
  };
}

type RecordedConsent = {
  readonly memberId: string;
  readonly consent: GuardianConsent;
};

type Doubles = {
  readonly gateways: GuardianConsentGateways & {
    readonly accounts: {
      updateProfile(memberId: string, values: CompletedValues): Promise<void>;
    };
  };
  readonly consents: RecordedConsent[];
  readonly audits: AuditLogInsertRow[];
  readonly activations: string[];
};

/** Dobles de los tres puertos. `lostRace` simula que otra petición registró
 * el consentimiento entre la lectura de la fila y la escritura. */
function doublesFor(
  record: MemberAccountRecord,
  options: { readonly lostRace?: boolean } = {},
): Doubles {
  const consents: RecordedConsent[] = [];
  const audits: AuditLogInsertRow[] = [];
  const activations: string[] = [];
  let profile = record.profile;

  return {
    consents,
    audits,
    activations,
    gateways: {
      accounts: {
        findByUserId: async () => ({ ...record, profile }),
        activateMember: async (memberId) => {
          activations.push(memberId);
        },
        updateProfile: async (_memberId, values) => {
          profile = { ...profile, ...values };
        },
        recordGuardianConsent: async (memberId, consent) => {
          if (options.lostRace) {
            return "already_recorded";
          }
          consents.push({ memberId, consent });
          profile = { ...profile, guardianConsentAt: consent.consentedAt };
          return "recorded";
        },
      },
      identities: { isEmailConfirmed: async () => true },
      audit: {
        insertAuditLogRow: async (row) => {
          audits.push(row);
          return { error: null };
        },
      },
    },
  };
}

async function rejectionOf(
  doubles: Doubles,
  request: GuardianConsentRequest,
): Promise<unknown> {
  try {
    await recordGuardianConsent(doubles.gateways, {
      userId: USER_ID,
      request,
      now: NOW,
    });
  } catch (error) {
    return error;
  }
  throw new Error("se esperaba un rechazo y no lo hubo");
}

describe("consentimiento de tutor", () => {
  it("16 años sin consentimiento deja la cuenta incomplete", async () => {
    const doubles = doublesFor(
      incompleteRecord({
        dateOfBirth: SIXTEEN_YEAR_OLD_BIRTH,
        membershipType: null,
      }),
    );

    const completion = await completeRegistration(doubles.gateways, {
      userId: USER_ID,
      values: { membershipType: "Student" },
      now: NOW,
    });

    expect(completion).toEqual({
      accountStatus: "incomplete",
      pending: ["guardianConsent"],
    });
    expect(doubles.activations).toEqual([]);
  });

  it("con los tres datos del tutor la cuenta se activa", async () => {
    const doubles = doublesFor(
      incompleteRecord({ dateOfBirth: SIXTEEN_YEAR_OLD_BIRTH }),
    );

    const completion = await recordGuardianConsent(doubles.gateways, {
      userId: USER_ID,
      request: VALID_REQUEST,
      now: NOW,
    });

    expect(completion).toEqual({ accountStatus: "active", pending: [] });
    expect(doubles.activations).toEqual([MEMBER_ID]);
  });

  it("18 años justos no requiere consentimiento", () => {
    // Cumple 18 el mismo día del registro: el borde es "menor de 18".
    expect(pendingFor({ dateOfBirth: "2008-09-12" })).toEqual([]);
  });

  it("17 años y 364 días sí lo requiere", () => {
    // Cumple 18 al día siguiente del registro.
    expect(pendingFor({ dateOfBirth: "2008-09-13" })).toEqual([
      "guardianConsent",
    ]);
  });

  it("cuenta el día del registro en Melbourne, no en UTC", () => {
    // 15:00 UTC del 11 es la 01:00 del 12 en Melbourne: ese día ya cumple 18.
    expect(
      pendingFor({
        dateOfBirth: "2008-09-12",
        registeredAt: "2026-09-11T15:00:00.000Z",
      }),
    ).toEqual([]);
  });

  it("cumplir 18 después del registro no levanta el requisito", async () => {
    // Se registró con 17 años y 364 días. Dos días después ya tiene 18, y el
    // consentimiento sigue haciendo falta y se sigue aceptando.
    const bornDayAfterRegistration = "2008-09-13";
    expect(pendingFor({ dateOfBirth: bornDayAfterRegistration })).toEqual([
      "guardianConsent",
    ]);
    const doubles = doublesFor(
      incompleteRecord({ dateOfBirth: bornDayAfterRegistration }),
    );

    const completion = await recordGuardianConsent(doubles.gateways, {
      userId: USER_ID,
      request: VALID_REQUEST,
      now: new Date("2026-09-20T02:00:00.000Z"),
    });

    expect(completion.accountStatus).toBe("active");
  });

  it.each([
    ["sin el nombre del tutor", { guardianName: "  " }, "guardianName"],
    [
      "con un correo del tutor que no lo es",
      { guardianEmail: "marta" },
      "guardianEmail",
    ],
    ["sin marcar el consentimiento", { consent: false }, "consent"],
  ] as const)(
    "no se puede marcar el consentimiento por API %s",
    async (_case, override, field) => {
      const doubles = doublesFor(
        incompleteRecord({ dateOfBirth: SIXTEEN_YEAR_OLD_BIRTH }),
      );

      const error = await rejectionOf(doubles, {
        ...VALID_REQUEST,
        ...override,
      });

      expect(error).toBeInstanceOf(GuardianConsentValidationError);
      expect(
        (error as GuardianConsentValidationError).issues.map(
          (issue) => issue.field,
        ),
      ).toEqual([field]);
      expect(doubles.consents).toEqual([]);
      expect(doubles.audits).toEqual([]);
      expect(doubles.activations).toEqual([]);
    },
  );

  it("la marca de tiempo queda guardada y la bitácora de auditoría registra el hecho", async () => {
    const doubles = doublesFor(
      incompleteRecord({ dateOfBirth: SIXTEEN_YEAR_OLD_BIRTH }),
    );

    await recordGuardianConsent(doubles.gateways, {
      userId: USER_ID,
      request: VALID_REQUEST,
      now: NOW,
    });

    expect(doubles.consents).toEqual([
      {
        memberId: MEMBER_ID,
        consent: {
          guardianName: "Marta Silva",
          guardianEmail: "marta.silva@example.test",
          consentedAt: NOW.toISOString(),
        },
      },
    ]);
    expect(doubles.audits).toEqual([
      {
        club_id: CLUB_ID,
        actor_id: USER_ID,
        action: "auth.guardian_consent_recorded",
        entity_type: "member",
        entity_id: MEMBER_ID,
        result: "success",
        metadata: null,
      },
    ]);
  });
});

describe("consentimiento de tutor: lo que no se acepta", () => {
  it("normaliza el nombre y el correo del tutor antes de guardarlos", async () => {
    const doubles = doublesFor(
      incompleteRecord({ dateOfBirth: SIXTEEN_YEAR_OLD_BIRTH }),
    );

    await recordGuardianConsent(doubles.gateways, {
      userId: USER_ID,
      request: {
        guardianName: "  Marta Silva ",
        guardianEmail: " Marta.Silva@Example.test ",
        consent: true,
      },
      now: NOW,
    });

    expect(doubles.consents[0]?.consent).toMatchObject({
      guardianName: "Marta Silva",
      guardianEmail: "marta.silva@example.test",
    });
  });

  it("no lo pide ni lo acepta de quien era mayor de edad el día del registro", async () => {
    const doubles = doublesFor(incompleteRecord({ dateOfBirth: "2008-09-12" }));

    const error = await rejectionOf(doubles, VALID_REQUEST);

    expect(error).toBeInstanceOf(GuardianConsentNotRequiredError);
    expect(doubles.consents).toEqual([]);
  });

  it("no lo acepta mientras no se sepa la fecha de nacimiento", async () => {
    const doubles = doublesFor(incompleteRecord({ dateOfBirth: null }));

    const error = await rejectionOf(doubles, VALID_REQUEST);

    expect(error).toBeInstanceOf(GuardianConsentNotRequiredError);
  });

  it("no reescribe un consentimiento que ya está registrado", async () => {
    const doubles = doublesFor(
      incompleteRecord({
        dateOfBirth: SIXTEEN_YEAR_OLD_BIRTH,
        guardianConsentAt: "2026-09-13T00:00:00.000Z",
      }),
    );

    const error = await rejectionOf(doubles, VALID_REQUEST);

    expect(error).toBeInstanceOf(GuardianConsentAlreadyRecordedError);
    expect(doubles.consents).toEqual([]);
  });

  it("no audita un consentimiento que otra petición registró a la vez", async () => {
    const doubles = doublesFor(
      incompleteRecord({ dateOfBirth: SIXTEEN_YEAR_OLD_BIRTH }),
      { lostRace: true },
    );

    const error = await rejectionOf(doubles, VALID_REQUEST);

    expect(error).toBeInstanceOf(GuardianConsentAlreadyRecordedError);
    expect(doubles.audits).toEqual([]);
    expect(doubles.activations).toEqual([]);
  });

  it("no toca una cuenta que ya no está incompleta", async () => {
    const doubles = doublesFor(
      incompleteRecord(
        { dateOfBirth: SIXTEEN_YEAR_OLD_BIRTH },
        { accountStatus: "inactive" },
      ),
    );

    const error = await rejectionOf(doubles, VALID_REQUEST);

    expect(error).toBeInstanceOf(AccountAlreadyResolvedError);
    expect(doubles.consents).toEqual([]);
  });

  it("no deja en la bitácora ni el nombre ni el correo del tutor", async () => {
    const doubles = doublesFor(
      incompleteRecord({ dateOfBirth: SIXTEEN_YEAR_OLD_BIRTH }),
    );

    await recordGuardianConsent(doubles.gateways, {
      userId: USER_ID,
      request: VALID_REQUEST,
      now: NOW,
    });

    const audited = JSON.stringify(doubles.audits);
    expect(audited).not.toContain(VALID_REQUEST.guardianName);
    expect(audited).not.toContain(VALID_REQUEST.guardianEmail);
  });
});
