import { beforeEach, describe, expect, it } from "vitest";
import {
  type IdentityConfirmationReader,
  type MemberAccountRecord,
  MemberNotFoundError,
  type MemberProfile,
} from "@/lib/auth/account-activation";
import {
  AccountAlreadyResolvedError,
  type AccountCompletionGateways,
  type CompletedValues,
  CompletionValidationError,
  completeRegistration,
  describeAccountCompletion,
} from "@/lib/auth/complete-registration";

/**
 * RF-2 del PRD de E2: la cuenta `incomplete` pide sólo lo que le falta y pasa
 * a `active` en cuanto no falta nada, sin que nadie intervenga.
 */

const NOW = new Date("2026-09-12T10:00:00+10:00");
const MEMBER_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";

const FULL_PROFILE: MemberProfile = {
  country: "AU",
  dateOfBirth: "1994-03-08",
  membershipType: "Full",
  guardianConsentAt: null,
};

type Store = {
  readonly gateways: AccountCompletionGateways;
  readonly writes: CompletedValues[];
  /** Los miembros que quedaron activados, en orden. */
  readonly activations: string[];
  profile: MemberProfile;
};

function storeWith(options: {
  readonly record: MemberAccountRecord | null;
  readonly emailConfirmed?: boolean;
}): Store {
  const writes: CompletedValues[] = [];
  const activations: string[] = [];
  const identities: IdentityConfirmationReader = {
    isEmailConfirmed: async () => options.emailConfirmed ?? true,
  };
  const store: Store = {
    profile: options.record?.profile ?? FULL_PROFILE,
    writes,
    activations,
    gateways: {
      accounts: {
        findByUserId: async () =>
          options.record === null
            ? null
            : { ...options.record, profile: store.profile },
        activateMember: async (memberId) => {
          activations.push(memberId);
        },
        updateProfile: async (_memberId, values) => {
          writes.push(values);
          store.profile = { ...store.profile, ...values };
        },
      },
      identities,
    },
  };
  return store;
}

function incompleteRecord(
  profile: Partial<MemberProfile>,
): MemberAccountRecord {
  return {
    memberId: MEMBER_ID,
    accountStatus: "incomplete",
    profile: { ...FULL_PROFILE, ...profile },
  };
}

describe("completar registro: pide sólo lo que falta", () => {
  it("nombra el único dato que falta", async () => {
    const store = storeWith({ record: incompleteRecord({ country: null }) });

    await expect(
      describeAccountCompletion(store.gateways, { userId: USER_ID, now: NOW }),
    ).resolves.toEqual({ accountStatus: "incomplete", pending: ["country"] });
  });

  it("nombra los varios que faltan cuando falta más de uno", async () => {
    const store = storeWith({
      record: incompleteRecord({ country: null, membershipType: null }),
      emailConfirmed: false,
    });

    const completion = await describeAccountCompletion(store.gateways, {
      userId: USER_ID,
      now: NOW,
    });

    expect(completion.pending).toEqual([
      "country",
      "membershipType",
      "emailConfirmation",
    ]);
  });

  it("no pide nada a una cuenta que ya está activa", async () => {
    const store = storeWith({
      record: {
        memberId: MEMBER_ID,
        accountStatus: "active",
        profile: FULL_PROFILE,
      },
    });

    await expect(
      describeAccountCompletion(store.gateways, { userId: USER_ID, now: NOW }),
    ).resolves.toEqual({ accountStatus: "active", pending: [] });
  });

  it("no activa nada mientras siga faltando algo", async () => {
    const store = storeWith({ record: incompleteRecord({ country: null }) });

    await describeAccountCompletion(store.gateways, {
      userId: USER_ID,
      now: NOW,
    });

    expect(store.activations).toEqual([]);
  });

  /** El estado que deja un corte entre las dos escrituras de guardar: el
   * perfil completo y la cuenta todavía `incomplete`. Sin reconciliar aquí, la
   * frontera la devolvería a esta pantalla para siempre y no le quedaría
   * ningún dato que mandar para salir. */
  it("activa sola la cuenta a la que ya no le falta nada pero quedó incompleta", async () => {
    const store = storeWith({ record: incompleteRecord({}) });

    const completion = await describeAccountCompletion(store.gateways, {
      userId: USER_ID,
      now: NOW,
    });

    expect(completion).toEqual({ accountStatus: "active", pending: [] });
    expect(store.activations).toEqual([MEMBER_ID]);
    // Reconciliar no es escribir el perfil: sólo mira si ya está completo.
    expect(store.writes).toEqual([]);
  });

  it("falla con un error propio cuando la identidad no tiene fila de miembro", async () => {
    const store = storeWith({ record: null });

    await expect(
      describeAccountCompletion(store.gateways, { userId: USER_ID, now: NOW }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});

describe("completar registro: guardar", () => {
  it("activa la cuenta al guardar el último dato, sin que nadie intervenga", async () => {
    const store = storeWith({ record: incompleteRecord({ country: null }) });

    const completion = await completeRegistration(store.gateways, {
      userId: USER_ID,
      values: { country: "AU" },
      now: NOW,
    });

    expect(store.writes).toEqual([{ country: "AU" }]);
    expect(store.activations).toEqual([MEMBER_ID]);
    expect(completion).toEqual({ accountStatus: "active", pending: [] });
  });

  it("sigue incompleta, y no se activa, mientras quede otro pendiente", async () => {
    const store = storeWith({
      record: incompleteRecord({ country: null, membershipType: null }),
    });

    const completion = await completeRegistration(store.gateways, {
      userId: USER_ID,
      values: { country: "AU" },
      now: NOW,
    });

    expect(store.activations).toEqual([]);
    expect(completion).toEqual({
      accountStatus: "incomplete",
      pending: ["membershipType"],
    });
  });

  it("no se activa mientras el correo siga sin confirmar", async () => {
    const store = storeWith({
      record: incompleteRecord({ country: null }),
      emailConfirmed: false,
    });

    const completion = await completeRegistration(store.gateways, {
      userId: USER_ID,
      values: { country: "AU" },
      now: NOW,
    });

    expect(store.activations).toEqual([]);
    expect(completion.pending).toEqual(["emailConfirmation"]);
  });

  it("no se activa un menor mientras no haya consentimiento del tutor", async () => {
    const store = storeWith({
      record: incompleteRecord({ dateOfBirth: null }),
    });

    const completion = await completeRegistration(store.gateways, {
      userId: USER_ID,
      values: { dateOfBirth: "2012-05-20" },
      now: NOW,
    });

    expect(store.activations).toEqual([]);
    expect(completion.pending).toEqual(["guardianConsent"]);
  });

  it("conserva lo que ya había escrito, y no lo reescribe", async () => {
    const store = storeWith({
      record: incompleteRecord({ membershipType: null }),
    });

    await completeRegistration(store.gateways, {
      userId: USER_ID,
      values: { membershipType: "Student" },
      now: NOW,
    });

    expect(store.writes).toEqual([{ membershipType: "Student" }]);
    expect(store.profile.country).toBe("AU");
    expect(store.profile.dateOfBirth).toBe("1994-03-08");
  });

  it("normaliza el país igual que el registro", async () => {
    const store = storeWith({ record: incompleteRecord({ country: null }) });

    await completeRegistration(store.gateways, {
      userId: USER_ID,
      values: { country: " au " },
      now: NOW,
    });

    expect(store.writes).toEqual([{ country: "AU" }]);
  });
});

describe("completar registro: lo que rechaza", () => {
  async function rejectionOf(
    values: Record<string, string>,
  ): Promise<CompletionValidationError> {
    const store = storeWith({
      record: incompleteRecord({
        country: null,
        dateOfBirth: null,
        membershipType: null,
      }),
    });
    try {
      await completeRegistration(store.gateways, {
        userId: USER_ID,
        values,
        now: NOW,
      });
    } catch (error) {
      expect(store.writes).toEqual([]);
      return error as CompletionValidationError;
    }
    throw new Error("se esperaba un rechazo y no lo hubo");
  }

  it("rechaza un país que no es un código ISO conocido, igual que el registro", async () => {
    const error = await rejectionOf({ country: "Australia" });

    expect(error).toBeInstanceOf(CompletionValidationError);
    expect(error.issues.map((issue) => issue.field)).toEqual(["country"]);
  });

  it("rechaza un tipo de membresía fuera del conjunto cerrado", async () => {
    const error = await rejectionOf({ membershipType: "Platinum" });

    expect(error.issues.map((issue) => issue.field)).toEqual([
      "membershipType",
    ]);
  });

  it("rechaza una fecha de nacimiento que no existe en el calendario", async () => {
    const error = await rejectionOf({ dateOfBirth: "2026-02-30" });

    expect(error.issues.map((issue) => issue.field)).toEqual(["dateOfBirth"]);
  });

  it("rechaza una fecha de nacimiento en el futuro", async () => {
    const error = await rejectionOf({ dateOfBirth: "2027-01-01" });

    expect(error.issues.map((issue) => issue.field)).toEqual(["dateOfBirth"]);
  });

  it("devuelve todos los campos malos a la vez, no el primero", async () => {
    const error = await rejectionOf({
      country: "Australia",
      membershipType: "Platinum",
    });

    expect(error.issues.map((issue) => issue.field)).toEqual([
      "country",
      "membershipType",
    ]);
  });

  it("rechaza un cuerpo que no trae ningún dato que guardar", async () => {
    const error = await rejectionOf({});

    expect(error.issues).toEqual([]);
  });

  it("rechaza cambiar un dato que la cuenta ya tiene: eso es editar el perfil, y es E5", async () => {
    const store = storeWith({ record: incompleteRecord({ country: null }) });

    await expect(
      completeRegistration(store.gateways, {
        userId: USER_ID,
        values: { country: "AU", membershipType: "Casual" },
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(CompletionValidationError);
    expect(store.writes).toEqual([]);
  });
});

describe("completar registro: cuentas que no se completan", () => {
  let store: Store;

  beforeEach(() => {
    store = storeWith({
      record: {
        memberId: MEMBER_ID,
        accountStatus: "active",
        profile: FULL_PROFILE,
      },
    });
  });

  it("no deja completar una cuenta que ya está activa", async () => {
    await expect(
      completeRegistration(store.gateways, {
        userId: USER_ID,
        values: { country: "NZ" },
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(AccountAlreadyResolvedError);
  });

  it("no escribe nada cuando rechaza la cuenta", async () => {
    await completeRegistration(store.gateways, {
      userId: USER_ID,
      values: { country: "NZ" },
      now: NOW,
    }).catch(() => undefined);

    expect(store.writes).toEqual([]);
    expect(store.activations).toEqual([]);
  });

  it("no deja completar una identidad sin fila de miembro", async () => {
    const orphan = storeWith({ record: null });

    await expect(
      completeRegistration(orphan.gateways, {
        userId: USER_ID,
        values: { country: "NZ" },
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});
