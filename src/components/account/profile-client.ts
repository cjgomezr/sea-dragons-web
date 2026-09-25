import { readStringAt } from "@/lib/api/read-string-at";
import { ACCOUNT_PROFILE_API_PATH } from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import { AUF_NUMBER_MAX_LENGTH } from "@/lib/members/member-record";
import {
  AUF_VERIFIED_REASON,
  FULL_NAME_MAX_LENGTH,
  type OwnAuf,
  type OwnProfile,
  type OwnProfileSubmission,
  PROFILE_ISSUE_CODES,
  type ProfileIssueCode,
} from "@/lib/members/own-profile";
import {
  parseExperienceLevel,
  parseGender,
} from "@/lib/members/profile-fields";
import {
  type RequestFailure,
  readRequestFailure,
} from "@/components/auth/request-failure";

/**
 * Guardar el perfil propio y reducir la respuesta a lo que la pantalla
 * necesita: la ficha guardada, o por qué no salió. Como en los demás
 * formularios de la cuenta, se guarda el código y no la frase, para que el
 * aviso cambie de idioma con el interruptor.
 */

export type ProfileSaveResult =
  | { readonly kind: "saved"; readonly profile: OwnProfile }
  | {
      readonly kind: "failed";
      readonly failure: RequestFailure;
      /** El `reason` de un 400, que dice qué campo no valió. */
      readonly reason: string | null;
    };

/** El AUF de la respuesta. Un estado que no se reconoce, o uno registrado
 * sin número, deja la respuesta sin valer. */
function readSavedAuf(payload: unknown): OwnAuf | null {
  const status = readStringAt(payload, ["data", "auf", "status"]);
  if (status === "none") {
    return { status };
  }
  const number = readStringAt(payload, ["data", "auf", "number"]);
  if ((status !== "pending" && status !== "verified") || number === null) {
    return null;
  }
  return {
    status,
    number,
    expiry: readStringAt(payload, ["data", "auf", "expiry"]),
  };
}

/** La ficha que devuelve un 200, sin fiarse de su forma. Un catálogo en null
 * es un campo vacío; con un valor que no se reconoce, la respuesta no vale.
 * La posición es un id del catálogo del club (#299): la valida el servidor. */
function readSavedProfile(payload: unknown): OwnProfile | null {
  const fullName = readStringAt(payload, ["data", "fullName"]);
  const auf = readSavedAuf(payload);
  if (fullName === null || auf === null) {
    return null;
  }
  const experienceLevel = readStringAt(payload, ["data", "experienceLevel"]);
  const gender = readStringAt(payload, ["data", "gender"]);
  const profile: OwnProfile = {
    fullName,
    country: readStringAt(payload, ["data", "country"]),
    positionId: readStringAt(payload, ["data", "positionId"]),
    experienceLevel: parseExperienceLevel(experienceLevel),
    gender: parseGender(gender),
    auf,
  };
  const isRecognized =
    (experienceLevel === null || profile.experienceLevel !== null) &&
    (gender === null || profile.gender !== null);
  return isRecognized ? profile : null;
}

/** El cuerpo que espera la API: el AUF va en dos campos planos, y sin él no
 * va ninguno, que es no tocarlo. */
function toRequestBody(
  submission: OwnProfileSubmission,
): Readonly<Record<string, string | null>> {
  const { auf, ...fields } = submission;
  return auf === null
    ? fields
    : { ...fields, aufNumber: auf.number, aufExpiry: auf.expiry };
}

export async function saveOwnProfile(
  submission: OwnProfileSubmission,
): Promise<ProfileSaveResult> {
  let response: Response;
  try {
    response = await fetch(ACCOUNT_PROFILE_API_PATH, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toRequestBody(submission)),
    });
  } catch {
    // El detalle técnico no le sirve a quien mira el formulario.
    return { kind: "failed", failure: "network", reason: null };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      kind: "failed",
      failure: readRequestFailure(payload),
      reason: readStringAt(payload, ["error", "reason"]),
    };
  }
  const profile = readSavedProfile(payload);
  return profile === null
    ? { kind: "failed", failure: "unrecognized_response", reason: null }
    : { kind: "saved", profile };
}

export function describeProfileIssue(
  translate: Translator,
  code: ProfileIssueCode,
): string {
  switch (code) {
    case "full_name_missing":
      return translate("account.profile.issue.fullNameMissing");
    case "full_name_too_long":
      return translate("account.profile.issue.fullNameTooLong", {
        max: FULL_NAME_MAX_LENGTH,
      });
    case "country_unknown":
      return translate("account.profile.issue.countryUnknown");
    case "position_unknown":
      return translate("account.profile.issue.positionUnknown");
    case "experience_level_unknown":
      return translate("account.profile.issue.experienceLevelUnknown");
    case "gender_unknown":
      return translate("account.profile.issue.genderUnknown");
    case "auf_number_missing":
      return translate("account.profile.issue.aufNumberMissing");
    case "auf_number_too_long":
      return translate("account.profile.issue.aufNumberTooLong", {
        max: AUF_NUMBER_MAX_LENGTH,
      });
    case "auf_expiry_not_a_date":
      return translate("account.profile.issue.aufExpiryNotADate");
    case "auf_expiry_before_joined":
      return translate("account.profile.issue.aufExpiryBeforeJoined");
  }
}

function parseProfileIssueCode(value: string | null): ProfileIssueCode | null {
  return PROFILE_ISSUE_CODES.find((code) => code === value) ?? null;
}

/** Lo que el servidor puede responder que no, en el idioma de la pantalla. */
export function describeProfileFailure(
  translate: Translator,
  failure: RequestFailure,
  reason: string | null,
): string {
  const issue = parseProfileIssueCode(reason);
  if (failure === "validation_error" && issue !== null) {
    return describeProfileIssue(translate, issue);
  }
  if (failure === "forbidden" && reason === AUF_VERIFIED_REASON) {
    return translate("account.profile.error.aufVerified");
  }
  switch (failure) {
    case "network":
      return translate("account.profile.error.network");
    case "unauthenticated":
      return translate("account.profile.error.signInRequired");
    case "forbidden":
      return translate("account.profile.error.forbidden");
    default:
      return translate("account.profile.error.unexpected");
  }
}
