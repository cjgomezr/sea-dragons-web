import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  FULL_NAME_MAX_LENGTH,
  type OwnAuf,
  type OwnAufChange,
  OwnAufVerifiedError,
  type OwnProfile,
  type OwnProfileFields,
  type OwnProfileGateways,
  type OwnProfileSubmission,
  ProfileValidationError,
  readOwnProfile,
  updateOwnProfile,
} from "@/lib/members/own-profile";

/**
 * El perfil propio (#241, FR-084, AC-039): lo que un miembro puede cambiar de
 * su ficha, contado sin Supabase delante. Nombre, país, posición, nivel y
 * género, y desde #274 su AUF, que queda sin verificar hasta que un Admin lo
 * confirme. Nada más de lo que la decisión B3 reserva al Admin.
 */

const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";

/** El día del club en que ingresó: ningún vencimiento puede ser anterior. */
const JOINED_ON = "2024-03-06";

const NO_AUF: OwnAuf = { status: "none" };

const STORED: OwnProfile = {
  fullName: "Nerea Ruiz",
  country: "AU",
  position: "Defender",
  experienceLevel: "Intermediate",
  gender: "female",
  auf: NO_AUF,
};

const VALID_FIELDS = {
  fullName: "Nerea Ruiz Soto",
  country: "ES",
  position: "Forward",
  experienceLevel: "Advanced",
  gender: "undisclosed",
} as const satisfies OwnProfileFields;

const VALID_SUBMISSION: OwnProfileSubmission = {
  ...VALID_FIELDS,
  auf: null,
};

type ProfileWrite = {
  readonly userId: string;
  readonly fields: OwnProfileFields;
  readonly auf: OwnAufChange;
};

type FakeProfiles = {
  readonly gateways: OwnProfileGateways;
  readonly writes: ProfileWrite[];
};

/** El AUF que queda después de un cambio, como lo dejaría la base. */
function aufAfter(change: OwnAufChange, stored: OwnAuf): OwnAuf {
  return change.kind === "keep"
    ? stored
    : { status: "pending", number: change.number, expiry: change.expiry };
}

function fakeProfiles(
  stored: OwnProfile | null = STORED,
  options: { readonly verifiedMeanwhile?: boolean } = {},
): FakeProfiles {
  const writes: ProfileWrite[] = [];
  return {
    writes,
    gateways: {
      profiles: {
        findOwnProfile: async () =>
          stored === null ? null : { profile: stored, joinedOn: JOINED_ON },
        updateOwnProfile: async (userId, fields, auf) => {
          if (stored === null) {
            return { kind: "member_not_found" };
          }
          if (auf.kind === "propose" && options.verifiedMeanwhile === true) {
            return { kind: "auf_verified" };
          }
          writes.push({ userId, fields, auf });
          return {
            kind: "updated",
            profile: { ...fields, auf: aufAfter(auf, stored.auf) },
          };
        },
      },
    },
  };
}

async function captureValidationError(
  submission: OwnProfileSubmission,
): Promise<ProfileValidationError> {
  const { gateways } = fakeProfiles();
  const error: unknown = await updateOwnProfile(gateways, {
    userId: USER_ID,
    submission,
  }).catch((caught: unknown) => caught);
  if (!(error instanceof ProfileValidationError)) {
    throw new Error("se esperaba un ProfileValidationError");
  }
  return error;
}

describe("editar el perfil propio", () => {
  it("guarda los cinco campos editables de quien llama", async () => {
    const { gateways, writes } = fakeProfiles();

    const saved = await updateOwnProfile(gateways, {
      userId: USER_ID,
      submission: VALID_SUBMISSION,
    });

    expect(saved).toEqual({ ...VALID_FIELDS, auf: NO_AUF });
    expect(writes).toEqual([
      { userId: USER_ID, fields: VALID_FIELDS, auf: { kind: "keep" } },
    ]);
  });

  it("guarda el nombre sin los espacios de los extremos", async () => {
    const { gateways, writes } = fakeProfiles();

    await updateOwnProfile(gateways, {
      userId: USER_ID,
      submission: { ...VALID_SUBMISSION, fullName: "  Nerea Ruiz  " },
    });

    expect(writes[0]?.fields.fullName).toBe("Nerea Ruiz");
  });

  it("normaliza el país a mayúsculas", async () => {
    const { gateways, writes } = fakeProfiles();

    await updateOwnProfile(gateways, {
      userId: USER_ID,
      submission: { ...VALID_SUBMISSION, country: "nz" },
    });

    expect(writes[0]?.fields.country).toBe("NZ");
  });

  it("deja sin valor la posición, el nivel y el género vaciados", async () => {
    const { gateways, writes } = fakeProfiles();

    await updateOwnProfile(gateways, {
      userId: USER_ID,
      submission: {
        ...VALID_SUBMISSION,
        position: null,
        experienceLevel: null,
        gender: null,
      },
    });

    expect(writes[0]?.fields).toMatchObject({
      position: null,
      experienceLevel: null,
      gender: null,
    });
  });

  it.each(["", "   "])(
    "rechaza un nombre vacío o de solo espacios (%j)",
    async (fullName) => {
      const error = await captureValidationError({
        ...VALID_SUBMISSION,
        fullName,
      });

      expect(error.issues).toEqual([
        { field: "fullName", code: "full_name_missing" },
      ]);
    },
  );

  it("rechaza un nombre de más de 120 caracteres", async () => {
    const error = await captureValidationError({
      ...VALID_SUBMISSION,
      fullName: "a".repeat(FULL_NAME_MAX_LENGTH + 1),
    });

    expect(error.issues).toEqual([
      { field: "fullName", code: "full_name_too_long" },
    ]);
  });

  it("acepta 120 caracteres contados como letras y no como unidades UTF-16", async () => {
    const { gateways, writes } = fakeProfiles();
    const fullName = "🐉".repeat(FULL_NAME_MAX_LENGTH);

    await updateOwnProfile(gateways, {
      userId: USER_ID,
      submission: { ...VALID_SUBMISSION, fullName },
    });

    expect(writes[0]?.fields.fullName).toBe(fullName);
  });

  it("rechaza valores fuera de su catálogo y dice cuáles", async () => {
    const error = await captureValidationError({
      fullName: "Nerea Ruiz",
      country: "XX",
      position: "Striker",
      experienceLevel: "expert",
      gender: "other",
      auf: null,
    });

    expect(error.issues).toEqual([
      { field: "country", code: "country_unknown" },
      { field: "position", code: "position_unknown" },
      { field: "experienceLevel", code: "experience_level_unknown" },
      { field: "gender", code: "gender_unknown" },
    ]);
  });

  it("no escribe nada cuando algún campo no vale", async () => {
    const { gateways, writes } = fakeProfiles();

    await updateOwnProfile(gateways, {
      userId: USER_ID,
      submission: { ...VALID_SUBMISSION, position: "Striker" },
    }).catch(() => undefined);

    expect(writes).toEqual([]);
  });

  it("no escribe los campos reservados al Admin aunque lleguen en el cuerpo", async () => {
    const { gateways, writes } = fakeProfiles();
    const withReservedFields = {
      ...VALID_SUBMISSION,
      role: "Admin",
      groups: ["Senior Squad"],
      status: "active",
    };

    await updateOwnProfile(gateways, {
      userId: USER_ID,
      submission: withReservedFields,
    });

    expect(Object.keys(writes[0]?.fields ?? {}).sort()).toEqual([
      "country",
      "experienceLevel",
      "fullName",
      "gender",
      "position",
    ]);
  });

  it("lanza MemberNotFoundError cuando la identidad no tiene fila", async () => {
    const { gateways } = fakeProfiles(null);

    await expect(
      updateOwnProfile(gateways, {
        userId: USER_ID,
        submission: VALID_SUBMISSION,
      }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});

describe("leer el perfil propio", () => {
  it("devuelve la ficha de quien llama", async () => {
    const { gateways } = fakeProfiles();

    await expect(readOwnProfile(gateways, USER_ID)).resolves.toEqual(STORED);
  });

  it("lanza MemberNotFoundError cuando la identidad no tiene fila", async () => {
    const { gateways } = fakeProfiles(null);

    await expect(readOwnProfile(gateways, USER_ID)).rejects.toBeInstanceOf(
      MemberNotFoundError,
    );
  });
});

const PENDING_AUF: OwnAuf = {
  status: "pending",
  number: "AUF-100",
  expiry: "2027-06-30",
};

const VERIFIED_AUF: OwnAuf = {
  status: "verified",
  number: "AUF-100",
  expiry: "2027-06-30",
};

function proposing(
  number: string,
  expiry: string | null = "2027-06-30",
): OwnProfileSubmission {
  return { ...VALID_SUBMISSION, auf: { number, expiry } };
}

async function captureAufError(
  stored: OwnProfile,
  submission: OwnProfileSubmission,
): Promise<unknown> {
  const { gateways } = fakeProfiles(stored);
  return updateOwnProfile(gateways, { userId: USER_ID, submission }).catch(
    (caught: unknown) => caught,
  );
}

describe("AUF propuesto por el miembro", () => {
  it("guarda el número y el vencimiento sin verificar", async () => {
    const { gateways, writes } = fakeProfiles();

    const saved = await updateOwnProfile(gateways, {
      userId: USER_ID,
      submission: proposing("  AUF-100  "),
    });

    expect(writes[0]?.auf).toEqual({
      kind: "propose",
      number: "AUF-100",
      expiry: "2027-06-30",
    });
    expect(saved.auf).toEqual(PENDING_AUF);
  });

  it("acepta un AUF sin vencimiento conocido, como al Admin", async () => {
    const { gateways, writes } = fakeProfiles();

    await updateOwnProfile(gateways, {
      userId: USER_ID,
      submission: proposing("AUF-100", null),
    });

    expect(writes[0]?.auf).toEqual({
      kind: "propose",
      number: "AUF-100",
      expiry: null,
    });
  });

  it("deja cambiar otra vez un AUF sin verificar, y sigue sin verificar", async () => {
    const { gateways, writes } = fakeProfiles({ ...STORED, auf: PENDING_AUF });

    const saved = await updateOwnProfile(gateways, {
      userId: USER_ID,
      submission: proposing("AUF-200", "2028-01-31"),
    });

    expect(writes[0]?.auf.kind).toBe("propose");
    expect(saved.auf).toEqual({
      status: "pending",
      number: "AUF-200",
      expiry: "2028-01-31",
    });
  });

  it("niega cambiar un AUF verificado", async () => {
    const error = await captureAufError(
      { ...STORED, auf: VERIFIED_AUF },
      proposing("AUF-200"),
    );

    expect(error).toBeInstanceOf(OwnAufVerifiedError);
  });

  it("niega también cambiar sólo el vencimiento de un AUF verificado", async () => {
    const error = await captureAufError(
      { ...STORED, auf: VERIFIED_AUF },
      proposing("AUF-100", "2029-12-31"),
    );

    expect(error).toBeInstanceOf(OwnAufVerifiedError);
  });

  it("no escribe nada cuando el AUF verificado no se puede cambiar", async () => {
    const { gateways, writes } = fakeProfiles({ ...STORED, auf: VERIFIED_AUF });

    await updateOwnProfile(gateways, {
      userId: USER_ID,
      submission: proposing("AUF-200"),
    }).catch(() => undefined);

    expect(writes).toEqual([]);
  });

  it("deja guardar el resto del perfil si el AUF verificado llega igual", async () => {
    const { gateways, writes } = fakeProfiles({ ...STORED, auf: VERIFIED_AUF });

    const saved = await updateOwnProfile(gateways, {
      userId: USER_ID,
      submission: proposing("AUF-100", "2027-06-30"),
    });

    expect(writes[0]?.auf).toEqual({ kind: "keep" });
    expect(saved.auf).toEqual(VERIFIED_AUF);
  });

  it("niega el cambio si un Admin lo verificó mientras se guardaba", async () => {
    const { gateways } = fakeProfiles(
      { ...STORED, auf: PENDING_AUF },
      { verifiedMeanwhile: true },
    );

    await expect(
      updateOwnProfile(gateways, {
        userId: USER_ID,
        submission: proposing("AUF-200"),
      }),
    ).rejects.toBeInstanceOf(OwnAufVerifiedError);
  });

  it.each(["", "   "])("rechaza un número vacío (%j)", async (number) => {
    const error = await captureValidationError(proposing(number));

    expect(error.issues).toEqual([
      { field: "aufNumber", code: "auf_number_missing" },
    ]);
  });

  it("rechaza un número de más de 40 caracteres", async () => {
    const error = await captureValidationError(proposing("A".repeat(41)));

    expect(error.issues).toEqual([
      { field: "aufNumber", code: "auf_number_too_long" },
    ]);
  });

  it("rechaza un vencimiento que no es un día del calendario", async () => {
    const error = await captureValidationError(
      proposing("AUF-100", "2027-02-30"),
    );

    expect(error.issues).toEqual([
      { field: "aufExpiry", code: "auf_expiry_not_a_date" },
    ]);
  });

  it("rechaza un vencimiento anterior a su fecha de ingreso", async () => {
    const error = await captureAufError(
      STORED,
      proposing("AUF-100", "2024-03-05"),
    );

    expect(error).toBeInstanceOf(ProfileValidationError);
    expect(error).toMatchObject({
      issues: [{ field: "aufExpiry", code: "auf_expiry_before_joined" }],
    });
  });

  it("acepta un vencimiento el mismo día de su ingreso", async () => {
    const { gateways, writes } = fakeProfiles();

    await updateOwnProfile(gateways, {
      userId: USER_ID,
      submission: proposing("AUF-100", JOINED_ON),
    });

    expect(writes[0]?.auf.kind).toBe("propose");
  });

  it("no toca el AUF cuando la petición no lo trae", async () => {
    const { gateways, writes } = fakeProfiles({ ...STORED, auf: PENDING_AUF });

    const saved = await updateOwnProfile(gateways, {
      userId: USER_ID,
      submission: VALID_SUBMISSION,
    });

    expect(writes[0]?.auf).toEqual({ kind: "keep" });
    expect(saved.auf).toEqual(PENDING_AUF);
  });
});
