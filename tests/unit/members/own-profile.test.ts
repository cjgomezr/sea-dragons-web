import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  FULL_NAME_MAX_LENGTH,
  type OwnProfile,
  type OwnProfileGateways,
  type OwnProfileSubmission,
  ProfileValidationError,
  readOwnProfile,
  updateOwnProfile,
} from "@/lib/members/own-profile";

/**
 * El perfil propio (#241, FR-084, AC-039): lo que un miembro puede cambiar de
 * su ficha, contado sin Supabase delante. Nombre, país, posición, nivel y
 * género; nada de lo que la decisión B3 reserva al Admin.
 */

const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";

const STORED: OwnProfile = {
  fullName: "Nerea Ruiz",
  country: "AU",
  position: "Defender",
  experienceLevel: "Intermediate",
  gender: "female",
};

const VALID_SUBMISSION: OwnProfileSubmission = {
  fullName: "Nerea Ruiz Soto",
  country: "ES",
  position: "Forward",
  experienceLevel: "Advanced",
  gender: "undisclosed",
};

type FakeProfiles = {
  readonly gateways: OwnProfileGateways;
  readonly writes: { userId: string; profile: OwnProfile }[];
};

function fakeProfiles(stored: OwnProfile | null = STORED): FakeProfiles {
  const writes: { userId: string; profile: OwnProfile }[] = [];
  return {
    writes,
    gateways: {
      profiles: {
        findOwnProfile: async () => stored,
        updateOwnProfile: async (userId, profile) => {
          writes.push({ userId, profile });
          return stored === null ? null : profile;
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

    expect(saved).toEqual(VALID_SUBMISSION);
    expect(writes).toEqual([{ userId: USER_ID, profile: VALID_SUBMISSION }]);
  });

  it("guarda el nombre sin los espacios de los extremos", async () => {
    const { gateways, writes } = fakeProfiles();

    await updateOwnProfile(gateways, {
      userId: USER_ID,
      submission: { ...VALID_SUBMISSION, fullName: "  Nerea Ruiz  " },
    });

    expect(writes[0]?.profile.fullName).toBe("Nerea Ruiz");
  });

  it("normaliza el país a mayúsculas", async () => {
    const { gateways, writes } = fakeProfiles();

    await updateOwnProfile(gateways, {
      userId: USER_ID,
      submission: { ...VALID_SUBMISSION, country: "nz" },
    });

    expect(writes[0]?.profile.country).toBe("NZ");
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

    expect(writes[0]?.profile).toMatchObject({
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

    expect(writes[0]?.profile.fullName).toBe(fullName);
  });

  it("rechaza valores fuera de su catálogo y dice cuáles", async () => {
    const error = await captureValidationError({
      fullName: "Nerea Ruiz",
      country: "XX",
      position: "Striker",
      experienceLevel: "expert",
      gender: "other",
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
      aufNumber: "AUF-1",
      aufExpiry: "2030-01-01",
      groups: ["Senior Squad"],
      status: "active",
    };

    await updateOwnProfile(gateways, {
      userId: USER_ID,
      submission: withReservedFields,
    });

    expect(Object.keys(writes[0]?.profile ?? {}).sort()).toEqual([
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
