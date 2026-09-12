import {
  type IdentityConfirmationReader,
  type MemberAccountRecord,
  type MemberAccountStore,
  MemberNotFoundError,
  type MemberProfile,
  type PendingRequirement,
  listPendingRequirements,
} from "./account-activation";
import type { AccountStatus } from "./account-status";
import {
  type FieldValidation,
  type MembershipType,
  type RegistrationIssue,
  validateCountryField,
  validateDateOfBirthField,
  validateMembershipTypeField,
} from "./registration";

/**
 * Completar el registro de una cuenta `incomplete` (FR-083, RF-2 del PRD de
 * E2), contado sin Supabase delante.
 *
 * Lo que le falta a la cuenta no se decide aquí: se pregunta a
 * `listPendingRequirements`, que es la misma función que decide el paso a
 * `active`. Este módulo sólo valida lo que llega, lo escribe y vuelve a
 * preguntar.
 */

/** Los pendientes que se rellenan escribiendo. El consentimiento del tutor lo
 * da otra persona y la confirmación del correo llega por un enlace, así que
 * ninguno de los dos se manda a este endpoint. */
export const COMPLETION_FIELDS = [
  "country",
  "dateOfBirth",
  "membershipType",
] as const;

export type CompletionField = (typeof COMPLETION_FIELDS)[number];

/** Lo que llega del formulario o de la API: un subconjunto de los campos, sin
 * validar. Es parcial a propósito, porque a una cuenta casi nunca le faltan
 * los tres. */
export type CompletionValues = Partial<Record<CompletionField, string>>;

/** Lo mismo ya validado y normalizado. Es lo único que llega a la base. */
export type CompletedValues = {
  readonly country?: string;
  readonly dateOfBirth?: string;
  readonly membershipType?: MembershipType;
};

export type MemberProfileWriter = {
  updateProfile(memberId: string, values: CompletedValues): Promise<void>;
};

export type AccountCompletionGateways = {
  readonly accounts: MemberAccountStore & MemberProfileWriter;
  readonly identities: IdentityConfirmationReader;
};

/** En qué estado queda la cuenta y qué le sigue faltando. La pantalla dibuja
 * `pending` y la API lo devuelve tal cual. */
export type AccountCompletion = {
  readonly accountStatus: AccountStatus;
  readonly pending: readonly PendingRequirement[];
};

export class CompletionValidationError extends Error {
  readonly issues: readonly RegistrationIssue[];

  constructor(message: string, issues: readonly RegistrationIssue[] = []) {
    super(message);
    this.name = "CompletionValidationError";
    this.issues = issues;
  }
}

/** La cuenta ya no está `incomplete`, así que no hay registro que completar.
 * Es `active` (no falta nada) o `inactive` (una baja de socio, FR-085). */
export class AccountAlreadyResolvedError extends Error {
  readonly accountStatus: AccountStatus;

  constructor(accountStatus: AccountStatus) {
    super(
      `La cuenta ya está ${accountStatus} y no hay registro que completar.`,
    );
    this.name = "AccountAlreadyResolvedError";
    this.accountStatus = accountStatus;
  }
}

const REJECTED_VALUES_MESSAGE = "Hay datos que no se pueden guardar.";

const NOTHING_TO_SAVE_MESSAGE =
  "No enviaste ningún dato que guardar. Rellena al menos uno de los que faltan.";

/** El campo ya está en la fila. Cambiarlo es editar el perfil (FR-084), que es
 * E5 y tiene su propia pantalla: esta puerta sólo rellena huecos, y dejarla
 * escribir encima la convertiría en un editor de perfil sin sus reglas. */
const ALREADY_SET_MESSAGE =
  "Este dato ya está registrado y no se cambia desde aquí.";

/** Qué pasó con un campo: no venía, se acepta ya normalizado, o se rechaza. */
type FieldOutcome<T> =
  | { readonly kind: "absent" }
  | { readonly kind: "accepted"; readonly value: T }
  | { readonly kind: "rejected"; readonly message: string };

function takeField<T>(
  supplied: string | undefined,
  validate: (value: string) => FieldValidation<T>,
): FieldOutcome<T> {
  if (supplied === undefined) {
    return { kind: "absent" };
  }
  const validation = validate(supplied);
  return validation.ok
    ? { kind: "accepted", value: validation.value }
    : { kind: "rejected", message: validation.message };
}

function issuesOf(
  field: CompletionField,
  outcome: FieldOutcome<unknown>,
): readonly RegistrationIssue[] {
  return outcome.kind === "rejected"
    ? [{ field, message: outcome.message }]
    : [];
}

export type CompletionValidation =
  | { readonly ok: true; readonly values: CompletedValues }
  | { readonly ok: false; readonly issues: readonly RegistrationIssue[] };

/**
 * Valida y normaliza lo que llega, con los mismos criterios que el registro:
 * un país que no es un código ISO no lo es más por llegar por esta puerta.
 * Devuelve TODOS los campos malos, no el primero.
 *
 * Es pura y la usan los dos lados: el servidor antes de escribir, y el
 * formulario antes de mandar, para no obligar a un viaje por una fecha mal
 * escrita. Una segunda copia en el navegador acabaría siendo otra regla.
 */
export function validateCompletionValues(input: {
  readonly values: CompletionValues;
  readonly now: Date;
}): CompletionValidation {
  const { values, now } = input;
  const country = takeField(values.country, validateCountryField);
  const dateOfBirth = takeField(values.dateOfBirth, (value) =>
    validateDateOfBirthField(value, now),
  );
  const membershipType = takeField(
    values.membershipType,
    validateMembershipTypeField,
  );

  const issues = [
    ...issuesOf("country", country),
    ...issuesOf("dateOfBirth", dateOfBirth),
    ...issuesOf("membershipType", membershipType),
  ];
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    values: {
      ...(country.kind === "accepted" ? { country: country.value } : {}),
      ...(dateOfBirth.kind === "accepted"
        ? { dateOfBirth: dateOfBirth.value }
        : {}),
      ...(membershipType.kind === "accepted"
        ? { membershipType: membershipType.value }
        : {}),
    },
  };
}

/**
 * Los campos que llegan y la fila ya tiene. Es una comprobación del servidor y
 * no del formato: quien pide no puede cambiar lo que ya dio por esta puerta,
 * la tenga bien escrita o mal.
 */
function issuesForAlreadySetFields(
  values: CompletionValues,
  profile: MemberProfile,
): readonly RegistrationIssue[] {
  return COMPLETION_FIELDS.flatMap((field) =>
    values[field] !== undefined && profile[field] !== null
      ? [{ field, message: ALREADY_SET_MESSAGE }]
      : [],
  );
}

/** La fila de la cuenta que se va a completar, o el error de por qué no se
 * puede. Separado del resto para que `completeRegistration` se lea de un
 * vistazo. */
async function findIncompleteAccount(
  gateways: AccountCompletionGateways,
  userId: string,
): Promise<MemberAccountRecord> {
  const record = await gateways.accounts.findByUserId(userId);
  if (record === null) {
    throw new MemberNotFoundError(userId);
  }
  if (record.accountStatus !== "incomplete") {
    throw new AccountAlreadyResolvedError(record.accountStatus);
  }
  return record;
}

/** Qué le falta a la cuenta de quien pregunta. Lo consulta la pantalla de
 * completar registro para pedir sólo eso, y no lo que ya dio. */
export async function describeAccountCompletion(
  gateways: AccountCompletionGateways,
  input: { readonly userId: string; readonly now: Date },
): Promise<AccountCompletion> {
  const record = await gateways.accounts.findByUserId(input.userId);
  if (record === null) {
    throw new MemberNotFoundError(input.userId);
  }
  if (record.accountStatus !== "incomplete") {
    return { accountStatus: record.accountStatus, pending: [] };
  }
  return {
    accountStatus: "incomplete",
    pending: listPendingRequirements({
      profile: record.profile,
      emailConfirmed: await gateways.identities.isEmailConfirmed(input.userId),
      now: input.now,
    }),
  };
}

/**
 * Guarda los datos que faltaban y activa la cuenta si con eso ya no falta
 * nada. Nadie tiene que intervenir: el paso a `active` ocurre en la misma
 * petición que guardó el último dato.
 */
export async function completeRegistration(
  gateways: AccountCompletionGateways,
  input: {
    readonly userId: string;
    readonly values: CompletionValues;
    readonly now: Date;
  },
): Promise<AccountCompletion> {
  const record = await findIncompleteAccount(gateways, input.userId);

  const alreadySet = issuesForAlreadySetFields(input.values, record.profile);
  if (alreadySet.length > 0) {
    throw new CompletionValidationError(REJECTED_VALUES_MESSAGE, alreadySet);
  }

  const validation = validateCompletionValues({
    values: input.values,
    now: input.now,
  });
  if (!validation.ok) {
    throw new CompletionValidationError(
      REJECTED_VALUES_MESSAGE,
      validation.issues,
    );
  }
  if (Object.keys(validation.values).length === 0) {
    throw new CompletionValidationError(NOTHING_TO_SAVE_MESSAGE);
  }

  await gateways.accounts.updateProfile(record.memberId, validation.values);

  const pending = listPendingRequirements({
    profile: { ...record.profile, ...validation.values },
    emailConfirmed: await gateways.identities.isEmailConfirmed(input.userId),
    now: input.now,
  });
  if (pending.length > 0) {
    return { accountStatus: "incomplete", pending };
  }

  await gateways.accounts.updateAccountStatus(record.memberId, "active");
  return { accountStatus: "active", pending: [] };
}
