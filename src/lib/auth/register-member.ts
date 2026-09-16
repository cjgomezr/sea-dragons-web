import type {
  EmailDeliveryAvailability,
  EmailDeliveryAvailabilityCheck,
} from "@/lib/email/email-delivery-availability";
import {
  type MembershipType,
  type RegistrationDetails,
  type RegistrationIssue,
  type RegistrationRequest,
  validateRegistration,
} from "./registration";

export type IdentityCreation =
  | { readonly kind: "created"; readonly userId: string }
  | { readonly kind: "already_registered" };

/** Lo que el registro necesita del servicio de identidad. Es un puerto y no el
 * cliente de Supabase directamente porque ningún test de esta lógica puede
 * crear cuentas de verdad ni mandar correos. */
export type AuthIdentityGateway = {
  createIdentity(credentials: {
    readonly email: string;
    readonly password: string;
  }): Promise<IdentityCreation>;
  deleteIdentity(userId: string): Promise<void>;
};

/** Columnas de `public.members` que escribe el registro. Nombres en snake_case
 * porque es la fila que va a la base, no un modelo de la aplicación. */
export type NewMemberRow = {
  readonly club_id: string;
  readonly user_id: string;
  readonly full_name: string;
  readonly email: string;
  readonly country: string;
  readonly date_of_birth: string;
  readonly membership_type: MembershipType;
  readonly role: "Player";
  readonly account_status: "incomplete";
};

export type MemberDirectory = {
  insertMember(row: NewMemberRow): Promise<void>;
};

/** Lo que contestó el servicio de correo al pedirle el envío. Es sólo para los
 * registros del servidor, y el motivo nunca lleva la dirección. El límite va
 * aparte del fallo genérico porque es el que se agota con dos registros
 * seguidos.
 *
 * Nunca llega al cliente (#147). Sólo se intenta enviar a una cuenta sin
 * confirmar, así que un fallo del envío delata que esa dirección tiene cuenta:
 * cualquier campo de la respuesta que dependa de esto es un oráculo. */
export type RequestedConfirmationEmail =
  | { readonly kind: "requested" }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "rate_limited"; readonly reason: string };

/** `not_requested`: no se pidió. La cuenta ya existía, ya había confirmado su
 * correo, la dirección no tiene cuenta, o el envío no estaba disponible. */
export type ConfirmationEmailOutcome =
  RequestedConfirmationEmail | { readonly kind: "not_requested" };

/** Devuelve el fallo en vez de lanzarlo: el correo de confirmación se pide
 * pero no decide si el registro salió bien. Un envío fallido deja la cuenta
 * creada y la pantalla ofrece reenviarlo. Quien llama decide qué hacer con el
 * fallo; nadie lo ignora.
 *
 * `appUrl` es la dirección de la petición que lo pide: el enlace del correo
 * vuelve a ese mismo despliegue. */
export type ConfirmationEmailGateway = {
  requestConfirmationEmail(
    email: string,
    appUrl: string,
  ): Promise<ConfirmationEmailOutcome>;
};

export type RegistrationGateways = {
  readonly identities: AuthIdentityGateway;
  readonly members: MemberDirectory;
  readonly confirmationEmail: ConfirmationEmailGateway;
  readonly emailDelivery: EmailDeliveryAvailabilityCheck;
};

/** `email_unavailable`: ahora no se pueden mandar correos (#154). Se decide
 * antes de mirar la cuenta, así que sale igual para cualquier dirección. */
export type ConfirmationReceiptOutcome =
  "confirmation_pending" | "email_unavailable";

/** Respuesta del registro y del reenvío. Es deliberadamente pobre: es la MISMA
 * exista o no ya una cuenta con ese correo, porque enumerar cuentas desde el
 * formulario de registro es una fuga de datos personales. No lleva id de
 * miembro ni de identidad por lo mismo, ni dice si el correo a esa dirección
 * salió (ver `RequestedConfirmationEmail`). */
export type RegistrationReceipt = {
  readonly outcome: ConfirmationReceiptOutcome;
  readonly email: string;
};

export function receiptOutcomeFor(
  emailDelivery: EmailDeliveryAvailability,
): ConfirmationReceiptOutcome {
  return emailDelivery.kind === "available"
    ? "confirmation_pending"
    : "email_unavailable";
}

/** Un registro válido que todavía no ha tocado ninguna cuenta. El recibo se
 * responde ya; `deliver` crea la cuenta y pide el correo, y va después de
 * responder: saber si la dirección tenía cuenta exige intentar crearla, y lo
 * que tardara la respuesta en esperarlo la delataría (#158).
 * `emailDelivery` lleva el motivo de un envío no disponible, para el registro
 * del servidor. */
export type PendingRegistration = {
  readonly receipt: RegistrationReceipt;
  readonly emailDelivery: EmailDeliveryAvailability;
  readonly deliver: () => Promise<ConfirmationEmailOutcome>;
};

export class RegistrationValidationError extends Error {
  readonly issues: readonly RegistrationIssue[];

  constructor(issues: readonly RegistrationIssue[]) {
    super(
      `La solicitud de registro no es válida: ${issues
        .map((issue) => `${issue.field}: ${issue.message}`)
        .join(" ")}`,
    );
    this.name = "RegistrationValidationError";
    this.issues = issues;
  }
}

export class IdentityCreationError extends Error {
  constructor(cause: unknown) {
    super(
      `No se pudo crear la identidad del registro: ${describeCause(cause)}`,
    );
    this.name = "IdentityCreationError";
    this.cause = cause;
  }
}

/** Qué pasó con la identidad cuando la fila de miembro no se pudo escribir.
 * `orphaned` es el caso que hay que poder ver en los registros: quedó una
 * identidad sin socio y alguien tiene que borrarla a mano. */
export type IdentityRollback = "deleted" | "orphaned";

export class MemberRecordError extends Error {
  readonly identityRollback: IdentityRollback;

  constructor(cause: unknown, identityRollback: IdentityRollback) {
    super(
      identityRollback === "deleted"
        ? `No se pudo crear la fila de miembro y se deshizo la identidad: ${describeCause(cause)}`
        : `No se pudo crear la fila de miembro Y TAMPOCO borrar la identidad recién creada, que queda huérfana: ${describeCause(cause)}`,
    );
    this.name = "MemberRecordError";
    this.cause = cause;
    this.identityRollback = identityRollback;
  }
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Crear la identidad y crear la fila de miembro son dos escrituras en dos
 * sistemas distintos, así que no hay transacción que las cubra. La garantía es
 * el orden más una compensación: primero la identidad (si falla, no hay nada
 * que deshacer y no queda ninguna fila de miembro huérfana), después la fila;
 * si la fila falla, se borra la identidad. Si ese borrado también falla, el
 * error lo dice en vez de dejarlo pasar. */
async function insertMemberOrUndoIdentity(
  gateways: RegistrationGateways,
  row: NewMemberRow,
): Promise<void> {
  try {
    await gateways.members.insertMember(row);
  } catch (memberError) {
    try {
      await gateways.identities.deleteIdentity(row.user_id);
    } catch {
      throw new MemberRecordError(memberError, "orphaned");
    }
    throw new MemberRecordError(memberError, "deleted");
  }
}

async function createIdentity(
  gateways: RegistrationGateways,
  credentials: { readonly email: string; readonly password: string },
): Promise<IdentityCreation> {
  try {
    return await gateways.identities.createIdentity(credentials);
  } catch (error) {
    throw new IdentityCreationError(error);
  }
}

export type RegistrationInput = {
  readonly request: RegistrationRequest;
  readonly clubId: string;
  readonly now: Date;
  readonly appUrl: string;
};

type AccountDelivery = {
  readonly details: RegistrationDetails;
  readonly input: RegistrationInput;
  readonly emailDelivery: EmailDeliveryAvailability;
};

async function createAccountAndRequestEmail(
  gateways: RegistrationGateways,
  { details, input, emailDelivery }: AccountDelivery,
): Promise<ConfirmationEmailOutcome> {
  const identity = await createIdentity(gateways, {
    email: details.email,
    password: details.password,
  });
  // Con una cuenta previa no se pide el correo: se lo mandaría a esa persona
  // en cada intento y gastaría el cupo.
  if (identity.kind === "already_registered") {
    return { kind: "not_requested" };
  }

  await insertMemberOrUndoIdentity(gateways, {
    club_id: input.clubId,
    user_id: identity.userId,
    full_name: details.fullName,
    email: details.email,
    country: details.country,
    date_of_birth: details.dateOfBirth,
    membership_type: details.membershipType,
    role: "Player",
    account_status: "incomplete",
  });

  // La cuenta no depende del correo y se crea igual. El enlace no se emite:
  // uno nuevo invalida el anterior, y emitirlo sin poder mandarlo le rompería
  // a la persona el que ya tuviera.
  if (emailDelivery.kind === "unavailable") {
    return { kind: "not_requested" };
  }

  return gateways.confirmationEmail.requestConfirmationEmail(
    details.email,
    input.appUrl,
  );
}

/** RF-1 y RF-2 del PRD de E2: valida en el acto y deja preparada la creación
 * de la identidad y el socio, con la misma respuesta exista o no la cuenta.
 * La cuenta nace `incomplete` con el rol Player (FR-008, FR-083).
 * Lanza `RegistrationValidationError` sin tocar ningún servicio: la validación
 * no depende de ninguna cuenta, así que puede responderse antes. */
export async function prepareRegistration(
  gateways: RegistrationGateways,
  input: RegistrationInput,
): Promise<PendingRegistration> {
  const validation = validateRegistration(input.request, { now: input.now });
  if (!validation.ok) {
    throw new RegistrationValidationError(validation.issues);
  }
  const details = validation.details;
  // Después de validar, para que una solicitud inválida no gaste cupo.
  const emailDelivery = await gateways.emailDelivery.checkAvailability(
    input.now,
  );

  return {
    receipt: {
      outcome: receiptOutcomeFor(emailDelivery),
      email: details.email,
    },
    emailDelivery,
    deliver: () =>
      createAccountAndRequestEmail(gateways, { details, input, emailDelivery }),
  };
}
