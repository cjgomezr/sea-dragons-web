import type { CardSubmissionStatus } from "@/components/account/use-card-submission";
import type {
  MemberRecordField,
  MemberRecordIssueCode,
} from "@/lib/members/member-record";
import { FIELD_OF_CONTACT_ISSUE } from "./MemberRecordContact";
import {
  type MemberRecordFailure,
  readIssueCode,
} from "./member-record-client";

/**
 * El campo de cada rechazo de la API de la ficha (#242), para que cada
 * tarjeta de la ficha (#773) enseñe junto a su campo el aviso que es suyo y
 * deje el resto para el aviso general.
 */

const FIELD_OF_ISSUE = {
  auf_number_too_long: "aufNumber",
  auf_expiry_not_a_date: "aufExpiry",
  auf_expiry_before_joined: "aufExpiry",
  date_of_birth_not_a_date: "dateOfBirth",
  date_of_birth_in_future: "dateOfBirth",
  date_of_birth_too_early: "dateOfBirth",
  date_of_birth_required: "dateOfBirth",
  ...FIELD_OF_CONTACT_ISSUE,
} as const satisfies Record<MemberRecordIssueCode, MemberRecordField>;

export type RecordFieldIssue<Field extends MemberRecordField> = {
  readonly field: Field;
  readonly code: MemberRecordIssueCode;
};

/** El aviso de campo que trajo el envío, si el servidor rechazó uno de los
 * campos de la tarjeta. */
export function serverFieldIssueOf<Field extends MemberRecordField>(
  status: CardSubmissionStatus<MemberRecordFailure>,
  fields: readonly Field[],
): RecordFieldIssue<Field> | null {
  if (status.kind !== "failed") {
    return null;
  }
  const code = readIssueCode(status);
  if (code === null) {
    return null;
  }
  const field = FIELD_OF_ISSUE[code];
  return isOneOf(field, fields) ? { field, code } : null;
}

function isOneOf<Field extends MemberRecordField>(
  field: MemberRecordField,
  fields: readonly Field[],
): field is Field {
  return (fields as readonly MemberRecordField[]).includes(field);
}
