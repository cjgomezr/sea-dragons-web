import { MemberNotFoundError } from "@/lib/auth/account-activation";
import { isKnownCountryCode } from "@/lib/geo/countries";
import {
  type ExperienceLevel,
  type Gender,
  type Position,
  parseExperienceLevel,
  parseGender,
  parsePosition,
} from "./profile-fields";

/**
 * El perfil propio (#241, RF-3 del PRD de E5): lo que un miembro puede cambiar
 * de su ficha (FR-084), contado sin Supabase delante.
 *
 * La decisión B3 de docs/preguntas-abiertas.md parte la ficha en dos. El
 * miembro edita su nombre, país, posición, nivel y género; el rol, el AUF, los
 * grupos y el estado son del Admin. Este módulo sólo sabe de los cinco
 * primeros: arma lo que se escribe campo a campo, así que nada más puede
 * colarse hasta la base aunque llegue en la petición.
 */

/** Largo máximo del nombre, en caracteres y no en unidades UTF-16. */
export const FULL_NAME_MAX_LENGTH = 120;

/** La ficha tal como la ve y la edita su dueño. El país puede faltar en una
 * fila vieja; al guardar se exige. */
export type OwnProfile = {
  readonly fullName: string;
  readonly country: string | null;
  readonly position: Position | null;
  readonly experienceLevel: ExperienceLevel | null;
  readonly gender: Gender | null;
};

/** Lo que llega a guardarse, sin validar todavía. Null en los tres catálogos
 * es vaciarlos a propósito. */
export type OwnProfileSubmission = {
  readonly fullName: string;
  readonly country: string;
  readonly position: string | null;
  readonly experienceLevel: string | null;
  readonly gender: string | null;
};

export type ProfileField = keyof OwnProfileSubmission;

export const PROFILE_ISSUE_CODES = [
  "full_name_missing",
  "full_name_too_long",
  "country_unknown",
  "position_unknown",
  "experience_level_unknown",
  "gender_unknown",
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

export type OwnProfileGateways = {
  readonly profiles: {
    findOwnProfile(userId: string): Promise<OwnProfile | null>;
    /** Null cuando la identidad no tiene fila de miembro. */
    updateOwnProfile(
      userId: string,
      profile: OwnProfile,
    ): Promise<OwnProfile | null>;
  };
};

/** Los caracteres del nombre que se guardaría, contados como `char_length`:
 * un emoji es uno. El formulario lo usa para avisar antes de enviar. */
export function countFullNameCharacters(fullName: string): number {
  return [...fullName.trim()].length;
}

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

function collectIssues(
  submission: OwnProfileSubmission,
): readonly ProfileIssue[] {
  const fullNameIssue = validateFullName(submission.fullName);
  const checks: readonly [ProfileField, ProfileIssueCode | null][] = [
    ["fullName", fullNameIssue],
    [
      "country",
      isKnownCountryCode(submission.country) ? null : "country_unknown",
    ],
    [
      "position",
      isInCatalogOrEmpty(submission.position, parsePosition)
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

/** Valida todos los campos a la vez y devuelve la ficha normalizada, o lanza
 * con cada campo que no vale: quien llama a la API no descubre los errores de
 * uno en uno. */
function toValidProfile(submission: OwnProfileSubmission): OwnProfile {
  const issues = collectIssues(submission);
  if (issues.length > 0) {
    throw new ProfileValidationError(issues);
  }
  return {
    fullName: submission.fullName.trim(),
    country: submission.country.trim().toUpperCase(),
    position: parsePosition(submission.position),
    experienceLevel: parseExperienceLevel(submission.experienceLevel),
    gender: parseGender(submission.gender),
  };
}

export async function readOwnProfile(
  gateways: OwnProfileGateways,
  userId: string,
): Promise<OwnProfile> {
  const profile = await gateways.profiles.findOwnProfile(userId);
  if (profile === null) {
    throw new MemberNotFoundError(userId);
  }
  return profile;
}

export async function updateOwnProfile(
  gateways: OwnProfileGateways,
  request: {
    readonly userId: string;
    readonly submission: OwnProfileSubmission;
  },
): Promise<OwnProfile> {
  const profile = toValidProfile(request.submission);
  const saved = await gateways.profiles.updateOwnProfile(
    request.userId,
    profile,
  );
  if (saved === null) {
    throw new MemberNotFoundError(request.userId);
  }
  return saved;
}
