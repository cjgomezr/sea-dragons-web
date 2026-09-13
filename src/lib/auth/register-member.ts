import {
  type MembershipType,
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

/** El límite de envíos va aparte del fallo genérico porque pide otra cosa a
 * quien mira la pantalla: esperar, ya que reintentar en ese momento vuelve a
 * fallar. El motivo es para los registros del servidor y nunca lleva la
 * dirección. */
export type ConfirmationEmailOutcome =
  | { readonly kind: "requested" }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "rate_limited"; readonly reason: string };

/** Lo que la respuesta pública dice del envío. Sólo el tipo, sin el motivo. */
export type ConfirmationEmailDelivery = ConfirmationEmailOutcome["kind"];

/** Devuelve el fallo en vez de lanzarlo: el correo de confirmación se pide
 * pero no decide si el registro salió bien. El servicio incorporado de
 * Supabase manda 2 mensajes por hora y se niega a escribir fuera del equipo
 * del proyecto, así que un envío fallido es normal y la pantalla ofrece
 * reenviarlo. Quien llama decide qué hacer con el fallo; nadie lo ignora. */
export type ConfirmationEmailGateway = {
  requestConfirmationEmail(email: string): Promise<ConfirmationEmailOutcome>;
};

export type RegistrationGateways = {
  readonly identities: AuthIdentityGateway;
  readonly members: MemberDirectory;
  readonly confirmationEmail: ConfirmationEmailGateway;
};

/** Respuesta del registro. Es deliberadamente pobre: es la MISMA exista o no
 * ya una cuenta con ese correo, porque enumerar cuentas desde el formulario de
 * registro es una fuga de datos personales. No lleva id de miembro ni de
 * identidad por lo mismo. `confirmationEmail` depende sólo de si el envío
 * salió, nunca de si la cuenta existía (#147). */
export type RegistrationReceipt = {
  readonly outcome: "confirmation_pending";
  readonly email: string;
  readonly confirmationEmail: ConfirmationEmailDelivery;
};

export type RegistrationResult = {
  readonly receipt: RegistrationReceipt;
  readonly confirmationEmail: ConfirmationEmailOutcome;
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

const NEUTRAL_RECEIPT_OUTCOME = "confirmation_pending" as const;

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

/** RF-1 y RF-2 del PRD de E2: crea la identidad y el socio, y devuelve siempre
 * la misma respuesta neutra. La cuenta nace `incomplete` con el rol Player
 * (FR-008, FR-083). */
export async function registerMember(
  gateways: RegistrationGateways,
  input: {
    readonly request: RegistrationRequest;
    readonly clubId: string;
    readonly now: Date;
  },
): Promise<RegistrationResult> {
  const validation = validateRegistration(input.request, { now: input.now });
  if (!validation.ok) {
    throw new RegistrationValidationError(validation.issues);
  }
  const details = validation.details;

  const identity = await createIdentity(gateways, {
    email: details.email,
    password: details.password,
  });
  if (identity.kind === "created") {
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
  }

  // También con una cuenta previa. Si sólo las nuevas pidieran el correo, un
  // envío caído (y agotar el límite está al alcance de cualquiera) haría que
  // el recibo delatara qué direcciones ya tienen cuenta. Es lo mismo que puede
  // pedir cualquiera desde el reenvío, así que no abre nada nuevo.
  const confirmationEmail =
    await gateways.confirmationEmail.requestConfirmationEmail(details.email);

  return {
    receipt: {
      outcome: NEUTRAL_RECEIPT_OUTCOME,
      email: details.email,
      confirmationEmail: confirmationEmail.kind,
    },
    confirmationEmail,
  };
}
