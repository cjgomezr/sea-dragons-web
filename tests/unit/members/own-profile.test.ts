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
import type { ClubPosition, ClubPositions } from "@/lib/club/club-positions";
import {
  DEFENDER,
  FORWARD,
  GOALKEEPER,
  SEEDED_POSITIONS,
} from "../helpers/seeded-positions";

/**
 * El perfil propio (#241, FR-084, AC-039): lo que un miembro puede cambiar de
 * su ficha, contado sin Supabase delante. Nombre, país, posición, nivel y
 * género, y desde #274 su AUF, que queda sin verificar hasta que un Admin lo
 * confirme. Nada más de lo que la decisión B3 reserva al Admin.
 */

const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

/** Una cuarta posición que el club archivó (#299). */
const UTILITY: ClubPosition = {
  id: "90000000-0000-4000-8000-000000000004",
  names: { en: "Utility", es: "Comodín" },
  isArchived: true,
};
const OTHER_CLUBS_POSITION_ID = "90000000-0000-4000-8000-000000000099";

/** Las del club, en su orden, con la archivada en medio. */
const CLUB_POSITIONS: ClubPositions = [GOALKEEPER, UTILITY, DEFENDER, FORWARD];

/** El día del club en que ingresó: ningún vencimiento puede ser anterior. */
const JOINED_ON = "2024-03-06";

const NO_AUF: OwnAuf = { status: "none" };

const STORED: OwnProfile = {
  fullName: "Nerea Ruiz",
  country: "AU",
  positionId: DEFENDER.id,
  experienceLevel: "Intermediate",
  gender: "female",
  auf: NO_AUF,
};

const VALID_FIELDS = {
  fullName: "Nerea Ruiz Soto",
  country: "ES",
  positionId: FORWARD.id,
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
  /** Los clubes de los que se leyeron las posiciones. */
  readonly positionsRead: string[];
  /** Las posiciones que cada lectura pidió que el catálogo conociera. */
  readonly positionsReferenced: (readonly string[])[];
};

/** El AUF que queda después de un cambio, como lo dejaría la base. */
function aufAfter(change: OwnAufChange, stored: OwnAuf): OwnAuf {
  return change.kind === "keep"
    ? stored
    : { status: "pending", number: change.number, expiry: change.expiry };
}

function fakeProfiles(
  stored: OwnProfile | null = STORED,
  options: {
    readonly verifiedMeanwhile?: boolean;
    readonly positions?: ClubPositions;
  } = {},
): FakeProfiles {
  const writes: ProfileWrite[] = [];
  const positionsRead: string[] = [];
  const positionsReferenced: (readonly string[])[] = [];
  return {
    writes,
    positionsRead,
    positionsReferenced,
    gateways: {
      positions: {
        findClubPositions: async (clubId, referencedIds) => {
          positionsRead.push(clubId);
          positionsReferenced.push(referencedIds);
          return options.positions ?? CLUB_POSITIONS;
        },
      },
      profiles: {
        findOwnProfile: async () =>
          stored === null
            ? null
            : { profile: stored, joinedOn: JOINED_ON, clubId: CLUB_ID },
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
        positionId: null,
        experienceLevel: null,
        gender: null,
      },
    });

    expect(writes[0]?.fields).toMatchObject({
      positionId: null,
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
      positionId: "Striker",
      experienceLevel: "expert",
      gender: "other",
      auf: null,
    });

    expect(error.issues).toEqual([
      { field: "country", code: "country_unknown" },
      { field: "positionId", code: "position_unknown" },
      { field: "experienceLevel", code: "experience_level_unknown" },
      { field: "gender", code: "gender_unknown" },
    ]);
  });

  it("no escribe nada cuando algún campo no vale", async () => {
    const { gateways, writes } = fakeProfiles();

    await updateOwnProfile(gateways, {
      userId: USER_ID,
      submission: { ...VALID_SUBMISSION, positionId: "Striker" },
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
      "positionId",
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
  it("devuelve la ficha de quien llama, con las posiciones que se le ofrecen", async () => {
    const { gateways } = fakeProfiles();

    await expect(readOwnProfile(gateways, USER_ID)).resolves.toEqual({
      profile: STORED,
      positionOptions: [GOALKEEPER, DEFENDER, FORWARD],
    });
  });

  it("lanza MemberNotFoundError cuando la identidad no tiene fila", async () => {
    const { gateways } = fakeProfiles(null);

    await expect(readOwnProfile(gateways, USER_ID)).rejects.toBeInstanceOf(
      MemberNotFoundError,
    );
  });
});

async function submitPosition(
  positionId: string | null,
  options: { readonly current: string | null },
): Promise<FakeProfiles & { readonly outcome: unknown }> {
  const fake = fakeProfiles({ ...STORED, positionId: options.current });
  const outcome: unknown = await updateOwnProfile(fake.gateways, {
    userId: USER_ID,
    submission: { ...VALID_SUBMISSION, positionId },
  }).catch((caught: unknown) => caught);
  return { ...fake, outcome };
}

function expectPositionRejected(outcome: unknown, writes: unknown[]): void {
  expect(outcome).toBeInstanceOf(ProfileValidationError);
  expect((outcome as ProfileValidationError).issues).toEqual([
    { field: "positionId", code: "position_unknown" },
  ]);
  expect(writes).toEqual([]);
}

describe("perfil propio: las posiciones del club (#299)", () => {
  it("lee las posiciones del club de quien llama", async () => {
    const { positionsRead } = await submitPosition(FORWARD.id, {
      current: null,
    });

    expect(positionsRead).toEqual([CLUB_ID]);
  });

  it("pide al catálogo la posición que tiene y la que elige", async () => {
    const { positionsReferenced } = await submitPosition(GOALKEEPER.id, {
      current: DEFENDER.id,
    });

    expect(positionsReferenced).toEqual([[DEFENDER.id, GOALKEEPER.id]]);
  });

  it("al leer, pide al catálogo la posición que tiene", async () => {
    const fake = fakeProfiles();

    await readOwnProfile(fake.gateways, USER_ID);

    expect(fake.positionsReferenced).toEqual([[DEFENDER.id]]);
  });

  it("guarda una posición activa del club", async () => {
    const { writes } = await submitPosition(GOALKEEPER.id, {
      current: DEFENDER.id,
    });

    expect(writes[0]?.fields.positionId).toBe(GOALKEEPER.id);
  });

  it("rechaza una posición archivada como valor nuevo", async () => {
    const { outcome, writes } = await submitPosition(UTILITY.id, {
      current: DEFENDER.id,
    });

    expectPositionRejected(outcome, writes);
  });

  it("deja guardar el perfil a quien conserva la posición archivada", async () => {
    const { writes } = await submitPosition(UTILITY.id, {
      current: UTILITY.id,
    });

    expect(writes[0]?.fields.positionId).toBe(UTILITY.id);
  });

  it("rechaza una posición de otro club", async () => {
    const { outcome, writes } = await submitPosition(OTHER_CLUBS_POSITION_ID, {
      current: null,
    });

    expectPositionRejected(outcome, writes);
  });

  it("ofrece la archivada, marcada, sólo a quien la tiene", async () => {
    const { gateways } = fakeProfiles({ ...STORED, positionId: UTILITY.id });

    const { positionOptions } = await readOwnProfile(gateways, USER_ID);

    expect(positionOptions).toEqual([GOALKEEPER, UTILITY, DEFENDER, FORWARD]);
  });

  it("no ofrece la archivada a quien tiene otra", async () => {
    const { gateways } = fakeProfiles();

    const { positionOptions } = await readOwnProfile(gateways, USER_ID);

    expect(positionOptions).not.toContainEqual(UTILITY);
  });

  it("no ofrece ninguna si el club archivó todas", async () => {
    const { gateways } = fakeProfiles(
      { ...STORED, positionId: null },
      {
        positions: SEEDED_POSITIONS.map((position) => ({
          ...position,
          isArchived: true,
        })),
      },
    );

    const { positionOptions } = await readOwnProfile(gateways, USER_ID);

    expect(positionOptions).toEqual([]);
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
