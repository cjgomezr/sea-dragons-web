import type { Translator } from "@/lib/i18n/translator";
import type {
  ExistingMember,
  NewMemberField,
  NewMemberIssue,
  NewMemberIssueCode,
} from "@/lib/members/member-invitation";
import {
  type MemberCreationFailure,
  describeNewMemberIssue,
  isEmailTaken,
  readNewMemberIssueCode,
} from "./new-member-client";

/**
 * Los errores del panel de invitar (#862): los de antes de enviar, con la
 * misma regla que el servidor, o el campo que rechazó el servidor. Cada uno
 * sale junto a su campo y, con un enlace a él, en el resumen de arriba.
 */

export type FormIssue =
  | {
      readonly kind: "rule";
      readonly field: NewMemberField;
      readonly code: NewMemberIssueCode;
    }
  | {
      readonly kind: "emailTaken";
      readonly field: "email";
      /** Null si la cuenta no es de ningún socio del club. */
      readonly existingMember: ExistingMember | null;
    };

/** Los ids de los controles, que los avisos usan para describirlos y los
 * enlaces del resumen para enfocarlos. */
export const FIELD_IDS: Readonly<Record<NewMemberField, string>> = {
  fullName: "alta-nombre",
  email: "alta-correo",
  country: "alta-pais",
  positionId: "alta-posicion",
  experienceLevel: "alta-nivel",
  gender: "alta-genero",
  aufNumber: "alta-auf-numero",
  aufExpiry: "alta-auf-vencimiento",
};

export function issueIdOf(field: NewMemberField): string {
  return `${FIELD_IDS[field]}-aviso`;
}

/** Los campos que viven dentro de "Datos de jugador", que sale plegado. */
export const PLAYER_DETAIL_FIELDS = [
  "country",
  "positionId",
  "experienceLevel",
  "gender",
  "aufNumber",
  "aufExpiry",
] as const satisfies readonly NewMemberField[];

export function isPlayerDetailField(field: NewMemberField): boolean {
  return (PLAYER_DETAIL_FIELDS as readonly NewMemberField[]).includes(field);
}

/** De qué campo habla cada código, para colocar el aviso que manda el
 * servidor, que sólo trae el código. */
const FIELD_OF_ISSUE: Readonly<Record<NewMemberIssueCode, NewMemberField>> = {
  full_name_missing: "fullName",
  email_malformed: "email",
  country_unknown: "country",
  position_unknown: "positionId",
  experience_level_unknown: "experienceLevel",
  gender_unknown: "gender",
  auf_number_missing: "aufNumber",
  auf_number_too_long: "aufNumber",
  auf_expiry_missing: "aufExpiry",
  auf_expiry_not_a_date: "aufExpiry",
  auf_expiry_before_joined: "aufExpiry",
};

/** El campo que rechazó el servidor, si el rechazo es de un campo. */
export function serverIssueOf(
  failure: MemberCreationFailure,
): FormIssue | null {
  if (isEmailTaken(failure)) {
    return {
      kind: "emailTaken",
      field: "email",
      existingMember: failure.existingMember,
    };
  }
  const code = readNewMemberIssueCode(failure);
  return code === null
    ? null
    : { kind: "rule", field: FIELD_OF_ISSUE[code], code };
}

export function asFormIssues(
  issues: readonly NewMemberIssue[],
): readonly FormIssue[] {
  return issues.map(({ field, code }) => ({ kind: "rule", field, code }));
}

export function describeFormIssue(
  translate: Translator,
  issue: FormIssue,
): string {
  return issue.kind === "emailTaken"
    ? translate("newMember.error.emailTaken")
    : describeNewMemberIssue(translate, issue.code);
}

/** Cómo nombra el resumen a cada campo. Los del AUF llevan "AUF" delante:
 * junto al campo basta con "Número", pero arriba hay que decir de qué. */
export function summaryFieldName(
  translate: Translator,
  field: NewMemberField,
): string {
  switch (field) {
    case "fullName":
      return translate("newMember.fullName");
    case "email":
      return translate("newMember.email");
    case "country":
      return translate("newMember.country");
    case "positionId":
      return translate("newMember.position");
    case "experienceLevel":
      return translate("newMember.experienceLevel");
    case "gender":
      return translate("newMember.gender");
    case "aufNumber":
      return translate("newMember.summary.aufNumber");
    case "aufExpiry":
      return translate("newMember.summary.aufExpiry");
  }
}
