import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  type ClubPositions,
  type ClubPositionsGateway,
  isAcceptablePosition,
  offeredPositions,
} from "@/lib/club/club-positions";
import { isRealCalendarDate } from "@/lib/auth/registration";
import { isKnownCountryCode } from "@/lib/geo/countries";
import { isAufNumberTooLong } from "./member-record";
import {
  type ExperienceLevel,
  type Gender,
  parseExperienceLevel,
  parseGender,
} from "./profile-fields";

/**
 * El perfil propio (#241, RF-3 del PRD de E5): lo que un miembro puede cambiar
 * de su ficha (FR-084), contado sin Supabase delante.
 *
 * La decisión B3 de docs/preguntas-abiertas.md parte la ficha en dos. El
 * miembro edita su nombre, país, posición, nivel y género; el rol, los grupos
 * y el estado son del Admin. Este módulo sólo sabe de esos cinco y del AUF:
 * arma lo que se escribe campo a campo, así que nada más puede colarse hasta
 * la base aunque llegue en la petición.
 *
 * El AUF lo escribía sólo el Admin hasta #274. Ahora lo propone también el
 * miembro, y lo que propone queda sin verificar hasta que un Admin lo
 * confirme (BR-008). Una vez verificado, sólo el Admin lo corrige.
 *
 * La posición es una del catálogo de su club (#299): una activa, o la
 * archivada que ya tenía. Una vez que la cambia, no puede volver a ella.
 */

/** Largo máximo del nombre, en caracteres y no en unidades UTF-16. */
export const FULL_NAME_MAX_LENGTH = 120;

/** Los cinco campos que el miembro edita libremente. El país puede faltar
 * en una fila vieja; al guardar se exige. */
export type OwnProfileFields = {
  readonly fullName: string;
  readonly country: string | null;
  /** Una posición del catálogo del club, o null sin posición. */
  readonly positionId: string | null;
  readonly experienceLevel: ExperienceLevel | null;
  readonly gender: Gender | null;
};

/** El registro federativo tal como lo ve su dueño: si lo tiene, y si un
 * Admin ya lo confirmó. */
export type OwnAuf =
  | { readonly status: "none" }
  | {
      readonly status: "pending" | "verified";
      readonly number: string;
      /** YYYY-MM-DD, o null si el registro no tiene vencimiento conocido. */
      readonly expiry: string | null;
    };

/** La ficha tal como la ve y la edita su dueño. */
export type OwnProfile = OwnProfileFields & { readonly auf: OwnAuf };

/** El AUF que el miembro manda, sin validar todavía. */
export type AufProposal = {
  readonly number: string;
  readonly expiry: string | null;
};

/** Lo que llega a guardarse, sin validar todavía. Null en los tres catálogos
 * es vaciarlos a propósito. `auf` en null es no tocar el registro: el miembro
 * no puede borrarlo, sólo proponer otro. */
export type OwnProfileSubmission = {
  readonly fullName: string;
  readonly country: string;
  readonly positionId: string | null;
  readonly experienceLevel: string | null;
  readonly gender: string | null;
  readonly auf: AufProposal | null;
};

/** Lo que el guardado hace con el AUF: dejarlo como está, o escribir la
 * propuesta sin verificar. */
export type OwnAufChange =
  | { readonly kind: "keep" }
  | {
      readonly kind: "propose";
      readonly number: string;
      readonly expiry: string | null;
    };

export type ProfileField = keyof OwnProfileFields | "aufNumber" | "aufExpiry";

export const PROFILE_ISSUE_CODES = [
  "full_name_missing",
  "full_name_too_long",
  "country_unknown",
  "position_unknown",
  "experience_level_unknown",
  "gender_unknown",
  "auf_number_missing",
  "auf_number_too_long",
  "auf_expiry_not_a_date",
  "auf_expiry_before_joined",
] as const;

export type ProfileIssueCode = (typeof PROFILE_ISSUE_CODES)[number];

export type ProfileIssue = {
  readonly field: ProfileField;
  readonly code: ProfileIssueCode;
};

export class ProfileValidationError extends Error {
  readonly issues: readonly ProfileIssue[];

  constructor(issues: readonly ProfileIssue[]) {
    super(
      `El perfil trae campos que no valen: ${issues
        .map((issue) => `${issue.field} (${issue.code})`)
        .join(", ")}.`,
    );
    this.name = "ProfileValidationError";
    this.issues = issues;
  }
}

/** El `reason` con el que la API rechaza cambiar un AUF verificado. La
 * pantalla lo lee para decirlo. */
export const AUF_VERIFIED_REASON = "auf_verified";

/** El AUF ya está verificado: sólo un Admin lo corrige. */
export class OwnAufVerifiedError extends Error {
  constructor() {
    super("Tu AUF ya está verificado: sólo un Admin puede cambiarlo.");
    this.name = "OwnAufVerifiedError";
  }
}

/** La ficha con lo que hace falta para validar el AUF y que no se sirve. */
export type StoredOwnProfile = {
  readonly profile: OwnProfile;
  /** YYYY-MM-DD, el día del club en que ingresó (#237). */
  readonly joinedOn: string;
  /** De qué club son las posiciones que puede elegir (#299). */
  readonly clubId: string;
};

/** La ficha y las posiciones que su desplegable ofrece, en el orden del
 * club. Vacías si el club archivó todas y el miembro no tiene ninguna. */
export type OwnProfileScreen = {
  readonly profile: OwnProfile;
  readonly positionOptions: ClubPositions;
};

export type OwnProfileUpdateResult =
  | { readonly kind: "updated"; readonly profile: OwnProfile }
  | { readonly kind: "member_not_found" }
  /** Un Admin lo verificó entre la lectura y la escritura. */
  | { readonly kind: "auf_verified" };

export type OwnProfileGateways = {
  readonly positions: ClubPositionsGateway;
  readonly profiles: {
    /** Null cuando la identidad no tiene fila de miembro. */
    findOwnProfile(userId: string): Promise<StoredOwnProfile | null>;
    /** Los campos y el AUF en una sola escritura. Una propuesta sólo se
     * escribe si el AUF sigue sin verificar. */
    updateOwnProfile(
      userId: string,
      fields: OwnProfileFields,
      auf: OwnAufChange,
    ): Promise<OwnProfileUpdateResult>;
  };
};

/** Los caracteres del nombre que se guardaría, contados como `char_length`:
 * un emoji es uno. */
function countFullNameCharacters(fullName: string): number {
  return [...fullName.trim()].length;
}

/** La usan el formulario, para avisar antes de enviar, y el dominio, para
 * rechazar lo que llegue sin pasar por él. */
export function validateFullName(fullName: string): ProfileIssueCode | null {
  const length = countFullNameCharacters(fullName);
  if (length === 0) {
    return "full_name_missing";
  }
  return length > FULL_NAME_MAX_LENGTH ? "full_name_too_long" : null;
}

/** Un catálogo acepta null (vaciado a propósito) o uno de sus valores. */
function isInCatalogOrEmpty(
  value: string | null,
  parse: (value: unknown) => unknown,
): boolean {
  return value === null || parse(value) !== null;
}

/** Contra qué se valida la posición: el catálogo del club y la que ya
 * tiene, que puede estar archivada. */
type PositionContext = {
  readonly positions: ClubPositions;
  readonly currentId: string | null;
};

function fieldIssuesOf(
  submission: OwnProfileSubmission,
  { positions, currentId }: PositionContext,
): readonly ProfileIssue[] {
  const fullNameIssue = validateFullName(submission.fullName);
  const checks: readonly [ProfileField, ProfileIssueCode | null][] = [
    ["fullName", fullNameIssue],
    [
      "country",
      isKnownCountryCode(submission.country) ? null : "country_unknown",
    ],
    [
      "positionId",
      isAcceptablePosition(positions, {
        chosenId: submission.positionId,
        currentId,
      })
        ? null
        : "position_unknown",
    ],
    [
      "experienceLevel",
      isInCatalogOrEmpty(submission.experienceLevel, parseExperienceLevel)
        ? null
        : "experience_level_unknown",
    ],
    [
      "gender",
      isInCatalogOrEmpty(submission.gender, parseGender)
        ? null
        : "gender_unknown",
    ],
  ];
  return checks.flatMap(([field, code]) =>
    code === null ? [] : [{ field, code }],
  );
}

/** El número lo exige: a diferencia del Admin, el miembro no puede borrar
 * su registro dejándolo vacío. El resto son las reglas de la ficha del
 * Admin. La usan el formulario, para avisar antes de enviar, y el dominio. */
export function validateAufNumber(number: string): ProfileIssueCode | null {
  if (number.trim() === "") {
    return "auf_number_missing";
  }
  return isAufNumberTooLong(number) ? "auf_number_too_long" : null;
}

function aufIssuesOf(auf: AufProposal | null): readonly ProfileIssue[] {
  if (auf === null) {
    return [];
  }
  const checks: readonly [ProfileField, ProfileIssueCode | null][] = [
    ["aufNumber", validateAufNumber(auf.number)],
    [
      "aufExpiry",
      auf.expiry === null || isRealCalendarDate(auf.expiry)
        ? null
        : "auf_expiry_not_a_date",
    ],
  ];
  return checks.flatMap(([field, code]) =>
    code === null ? [] : [{ field, code }],
  );
}

/** Valida todos los campos a la vez y devuelve los cinco normalizados, o
 * lanza con cada campo que no vale: quien llama a la API no descubre los
 * errores de uno en uno. */
function toValidFields(
  submission: OwnProfileSubmission,
  positionContext: PositionContext,
): OwnProfileFields {
  const issues = [
    ...fieldIssuesOf(submission, positionContext),
    ...aufIssuesOf(submission.auf),
  ];
  if (issues.length > 0) {
    throw new ProfileValidationError(issues);
  }
  return {
    fullName: submission.fullName.trim(),
    country: submission.country.trim().toUpperCase(),
    positionId: submission.positionId,
    experienceLevel: parseExperienceLevel(submission.experienceLevel),
    gender: parseGender(submission.gender),
  };
}

function isSameAuf(stored: OwnAuf, proposal: AufProposal): boolean {
  return (
    stored.status !== "none" &&
    stored.number === proposal.number &&
    stored.expiry === proposal.expiry
  );
}

/**
 * Qué hacer con el AUF que llega. Llegar igual que el guardado no es
 * cambiarlo: así el formulario puede mandar siempre lo que enseña, y un AUF
 * verificado no impide guardar el nombre. El vencimiento se compara con el
 * ingreso (#237), como en la ficha del Admin.
 */
function planAufChange(
  stored: StoredOwnProfile,
  auf: AufProposal | null,
): OwnAufChange {
  if (auf === null) {
    return { kind: "keep" };
  }
  const proposal = { number: auf.number.trim(), expiry: auf.expiry };
  if (isSameAuf(stored.profile.auf, proposal)) {
    return { kind: "keep" };
  }
  if (stored.profile.auf.status === "verified") {
    throw new OwnAufVerifiedError();
  }
  if (proposal.expiry !== null && proposal.expiry < stored.joinedOn) {
    throw new ProfileValidationError([
      { field: "aufExpiry", code: "auf_expiry_before_joined" },
    ]);
  }
  return { kind: "propose", ...proposal };
}

async function findStoredProfile(
  gateways: OwnProfileGateways,
  userId: string,
): Promise<StoredOwnProfile> {
  const stored = await gateways.profiles.findOwnProfile(userId);
  if (stored === null) {
    throw new MemberNotFoundError(userId);
  }
  return stored;
}

export async function readOwnProfile(
  gateways: OwnProfileGateways,
  userId: string,
): Promise<OwnProfileScreen> {
  const { profile, clubId } = await findStoredProfile(gateways, userId);
  const positions = await gateways.positions.findClubPositions(clubId);
  return {
    profile,
    positionOptions: offeredPositions(positions, profile.positionId),
  };
}

export async function updateOwnProfile(
  gateways: OwnProfileGateways,
  request: {
    readonly userId: string;
    readonly submission: OwnProfileSubmission;
  },
): Promise<OwnProfile> {
  const stored = await findStoredProfile(gateways, request.userId);
  const positions = await gateways.positions.findClubPositions(stored.clubId);
  const fields = toValidFields(request.submission, {
    positions,
    currentId: stored.profile.positionId,
  });
  const auf = planAufChange(stored, request.submission.auf);
  const result = await gateways.profiles.updateOwnProfile(
    request.userId,
    fields,
    auf,
  );
  switch (result.kind) {
    case "member_not_found":
      throw new MemberNotFoundError(request.userId);
    case "auf_verified":
      throw new OwnAufVerifiedError();
    case "updated":
      return result.profile;
  }
}
