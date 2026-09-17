import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  SUPABASE_URL_ENV,
  readSupabaseConfig,
  readSupabaseServiceRoleConfig,
} from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import {
  type AuditLogWriter,
  createSupabaseAuditLogWriter,
} from "@/lib/audit/audit-log";
import {
  type IdentityConfirmationReader,
  type MemberAccountRecord,
  type MemberAccountStore,
} from "./account-activation";
import type {
  GuardianConsent,
  GuardianConsentWriter,
} from "./guardian-consent";
import { ACCOUNT_STATUSES, type AccountStatus } from "./account-status";
import type {
  CompletedValues,
  MemberProfileWriter,
} from "./complete-registration";
import type { EmailConfirmationGateway } from "./email-confirmation";
import type { EmailRequestLog } from "./email-request-log";
import type { RegistrationRequestLog } from "./registration-rate-limit";
import {
  type EmailDeliveryAvailabilityCheck,
  createEmailDeliveryAvailabilityCheck,
} from "@/lib/email/email-delivery-availability";
import {
  connectResendEmailSender,
  createResendProviderProbe,
} from "@/lib/email/resend-email-sender";
import { createSupabaseEmailSendBudget } from "@/lib/email/supabase-email-send-budget";
import type { EmailLocaleDirectory } from "@/lib/email/email-locale";
import {
  type ConfirmationTokenIssuer,
  createConfirmationEmailGateway,
} from "./confirmation-email-sender";
import type {
  AuthIdentityGateway,
  ConfirmationEmailGateway,
  MemberDirectory,
  RegistrationGateways,
} from "./register-member";
import { createSupabaseEmailRequestLog } from "./supabase-email-request-log";
import { createSupabaseRegistrationRequestLog } from "./supabase-registration-request-log";

/**
 * Adaptadores entre los puertos del registro y Supabase. Todo lo de aquí es de
 * servidor: usa la llave de servicio, que nunca puede llegar al navegador.
 */

const MEMBERS_TABLE = "members";
const CLUBS_TABLE = "clubs";
const CONFIRMATION_EMAIL_REQUESTS_TABLE = "confirmation_email_requests";

/** Release 1 opera un solo club (NFR-009 ya deja club_id en cada tabla para
 * cuando no sea así). Es el club que siembra la migración 0001. */
export const DEFAULT_CLUB_SLUG = "victoria-seadragons";

export type ClubDirectory = {
  findClubIdBySlug(slug: string): Promise<string>;
};

export type SupabaseAuthGateways = {
  /** Sin lo que necesita el club: la disponibilidad del envío y el límite del
   * registro. Ver `emailDeliveryForClub` y `registrationRequestsForClub`. */
  readonly registration: Omit<
    RegistrationGateways,
    "emailDelivery" | "registrationRequests"
  >;
  readonly confirmations: EmailConfirmationGateway;
  readonly clubs: ClubDirectory;
  /** Leer la fila del socio y escribir lo que le faltaba son la misma pieza:
   * las usa la pantalla de completar registro, y todas van por la llave de
   * servicio (ver `createMemberAccountStore`). */
  readonly accounts: MemberAccountStore &
    MemberProfileWriter &
    GuardianConsentWriter;
  readonly identities: IdentityConfirmationReader;
  /** La bitácora de NFR-010. Va por la llave de servicio, que es la única que
   * `0002_audit_log.sql` deja escribir. */
  readonly audit: AuditLogWriter;
  readonly confirmationEmail: ConfirmationEmailGateway;
  /** El idioma de los correos de cada socio, guardado en su fila. */
  readonly emailLocales: EmailLocaleDirectory;
  /** El límite del reenvío de la confirmación. Pide el club porque cada fila
   * lleva `club_id` (NFR-009). */
  readonly confirmationEmailRequestsForClub: (
    clubId: string,
  ) => EmailRequestLog;
  /** Si ahora se pueden mandar correos (#154). Pide el club porque cada
   * petición anotada en el cupo lleva `club_id` (NFR-009). */
  readonly emailDeliveryForClub: (
    clubId: string,
  ) => EmailDeliveryAvailabilityCheck;
  /** El límite de peticiones del registro (#173). Pide el club porque cada
   * fila anotada lleva `club_id` (NFR-009). */
  readonly registrationRequestsForClub: (
    clubId: string,
  ) => RegistrationRequestLog;
};

export type SupabaseAuthGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: SupabaseAuthGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

type Environment = Readonly<Record<string, string | undefined>>;

/** El error que devuelve Supabase Auth cuando el correo ya tiene cuenta. Se
 * mira el código y, como red, el texto: la respuesta neutra del registro
 * depende de distinguir este caso de una caída del servicio, y confundirlos
 * sería responder "revisa tu correo" a alguien cuyo registro se perdió. */
const EMAIL_EXISTS_CODE = "email_exists";
const EMAIL_EXISTS_MESSAGE_PATTERN = /already\b.*\bregistered/i;

function isAlreadyRegistered(error: {
  readonly code?: string;
  readonly message: string;
}): boolean {
  return (
    error.code === EMAIL_EXISTS_CODE ||
    EMAIL_EXISTS_MESSAGE_PATTERN.test(error.message)
  );
}

function createIdentityGateway(
  serviceClient: SupabaseClient,
): AuthIdentityGateway {
  return {
    async createIdentity({ email, password }) {
      // email_confirm en false a propósito: la cuenta nace sin confirmar
      // (FR-083 y la decisión del 11 de septiembre de 2026). Crearla ya
      // confirmada sería apagar la confirmación por la puerta de atrás.
      const { data, error } = await serviceClient.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
      });
      if (error) {
        if (isAlreadyRegistered(error)) {
          return { kind: "already_registered" };
        }
        throw new Error(
          `Supabase Auth rechazó la creación de la identidad: ${error.message}`,
        );
      }
      if (!data.user) {
        throw new Error(
          "Supabase Auth aceptó la creación de la identidad pero no devolvió el usuario.",
        );
      }
      return { kind: "created", userId: data.user.id };
    },

    async deleteIdentity(userId) {
      const { error } = await serviceClient.auth.admin.deleteUser(userId);
      if (error) {
        throw new Error(
          `No se pudo borrar la identidad ${userId}: ${error.message}`,
        );
      }
    },
  };
}

function createMemberDirectory(serviceClient: SupabaseClient): MemberDirectory {
  return {
    async insertMember(row) {
      const { error } = await serviceClient.from(MEMBERS_TABLE).insert(row);
      if (error) {
        throw new Error(
          `No se pudo crear la fila de miembro: ${error.message}`,
        );
      }
    },
  };
}

/** Con una dirección sin cuenta, el enlace de alta sin contraseña no crea la
 * cuenta: Supabase Auth responde este código y se queja de la contraseña. */
const SIGNUP_VALIDATION_FAILED_CODE = "validation_failed";
const MISSING_PASSWORD_MESSAGE_PATTERN = /password/i;

/** Ver `createConfirmationTokenIssuer`: el tipo del SDK exige el campo, y lo
 * que se quiere es justo no mandar ninguna. */
const NO_PASSWORD = "";

function hasNoPendingConfirmation(error: {
  readonly code?: string;
  readonly message: string;
}): boolean {
  return (
    error.code === EMAIL_EXISTS_CODE ||
    (error.code === SIGNUP_VALIDATION_FAILED_CODE &&
      MISSING_PASSWORD_MESSAGE_PATTERN.test(error.message))
  );
}

/**
 * Emite el enlace del correo de confirmación sin mandar nada: el correo lo
 * manda Resend (#137).
 *
 * Pide el enlace de alta sin contraseña, y eso es seguro por cómo responde
 * Supabase Auth, comprobado contra seadragons-dev el 14 de septiembre de 2026
 * y fijado en `registration.integration.test.ts`. Con una cuenta sin
 * confirmar emite el enlace y no toca la contraseña. Con una cuenta ya
 * confirmada responde `email_exists`. Con una dirección sin cuenta responde
 * `validation_failed` y no la crea, que es lo que importa: el reenvío es
 * público, y con una contraseña cualquiera crearía cuentas a quien se le
 * antojara.
 */
export function createConfirmationTokenIssuer(
  serviceClient: SupabaseClient,
): ConfirmationTokenIssuer {
  return {
    async issueConfirmationToken(email) {
      const { data, error } = await serviceClient.auth.admin.generateLink({
        type: "signup",
        email,
        password: NO_PASSWORD,
      });
      if (error) {
        return hasNoPendingConfirmation(error)
          ? { kind: "no_pending_confirmation" }
          : { kind: "failed", error };
      }
      return {
        kind: "issued",
        tokenHash: data.properties.hashed_token,
        userId: data.user.id,
      };
    },
  };
}

/** Lee una columna de texto de una fila que llega como unknown. supabase-js no
 * conoce el esquema de este proyecto, así que estrechar es la alternativa a
 * reescribir a mano la forma de la tabla o a colar un cast. */
function readText(
  row: Record<string, unknown>,
  column: string,
  table: string,
): string | null {
  const value = row[column];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(
      `La columna ${table}.${column} devolvió ${typeof value} y se esperaba texto.`,
    );
  }
  return value;
}

export function readRequiredText(
  row: Record<string, unknown>,
  column: string,
  table: string,
): string {
  const value = readText(row, column, table);
  if (value === null) {
    throw new Error(`La columna ${table}.${column} llegó vacía.`);
  }
  return value;
}

function createEmailConfirmationGateway(
  anonClient: SupabaseClient,
): EmailConfirmationGateway {
  return {
    async confirmEmail({ tokenHash, type }) {
      // Un enlace caducado, ya usado o de otro proyecto no es un fallo del
      // servidor: es un enlace que no vale, y la pantalla lo dice.
      const { data, error } = await anonClient.auth.verifyOtp({
        type,
        token_hash: tokenHash,
      });
      if (error) {
        return { kind: "rejected", reason: error.message };
      }
      if (!data.user) {
        return {
          kind: "rejected",
          reason: "El enlace no identificó ninguna cuenta.",
        };
      }
      return { kind: "confirmed", userId: data.user.id };
    },
  };
}

function createClubDirectory(serviceClient: SupabaseClient): ClubDirectory {
  return {
    async findClubIdBySlug(slug) {
      const { data, error } = await serviceClient
        .from(CLUBS_TABLE)
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (error) {
        throw new Error(`No se pudo leer el club ${slug}: ${error.message}`);
      }
      if (!data) {
        throw new Error(`El club ${slug} no existe en la base de datos.`);
      }
      return readRequiredText(data, "id", CLUBS_TABLE);
    },
  };
}

function readAccountStatus(row: Record<string, unknown>): AccountStatus {
  const value = readRequiredText(row, "account_status", MEMBERS_TABLE);
  const status = ACCOUNT_STATUSES.find((candidate) => candidate === value);
  if (status === undefined) {
    throw new Error(
      `${value} no es un estado de cuenta conocido; los conocidos son ${ACCOUNT_STATUSES.join(", ")}.`,
    );
  }
  return status;
}

function toMemberAccountRecord(
  row: Record<string, unknown>,
): MemberAccountRecord {
  return {
    memberId: readRequiredText(row, "id", MEMBERS_TABLE),
    clubId: readRequiredText(row, "club_id", MEMBERS_TABLE),
    accountStatus: readAccountStatus(row),
    profile: {
      country: readText(row, "country", MEMBERS_TABLE),
      dateOfBirth: readText(row, "date_of_birth", MEMBERS_TABLE),
      membershipType: readText(row, "membership_type", MEMBERS_TABLE),
      guardianConsentAt: readText(row, "guardian_consent_at", MEMBERS_TABLE),
      registeredAt: readRequiredText(row, "created_at", MEMBERS_TABLE),
    },
  };
}

const MEMBER_ACCOUNT_COLUMNS =
  "id, club_id, account_status, country, date_of_birth, membership_type, guardian_consent_at, created_at";

/** Las columnas de `members` que escribe completar registro, con el nombre que
 * tienen en la base. La conversión vive aquí y no en el dominio: snake_case es
 * de la fila, no del modelo. */
function toMemberColumns(values: CompletedValues): Record<string, string> {
  return {
    ...(values.country === undefined ? {} : { country: values.country }),
    ...(values.dateOfBirth === undefined
      ? {}
      : { date_of_birth: values.dateOfBirth }),
    ...(values.membershipType === undefined
      ? {}
      : { membership_type: values.membershipType }),
  };
}

/**
 * Va por la llave de servicio, y no por el cliente con la sesión del socio, a
 * propósito: `0003_members.sql` no le da a `authenticated` ningún privilegio
 * de escritura sobre su propia fila, justo para que `role` y `account_status`
 * no los pueda mover el dueño ni atacando la API directamente (AC-039). El
 * servidor identifica a quien pide por su cookie de sesión y sólo entonces
 * escribe, acotado al `memberId` de esa persona.
 */
function createMemberAccountStore(
  serviceClient: SupabaseClient,
): MemberAccountStore & MemberProfileWriter & GuardianConsentWriter {
  return {
    async recordGuardianConsent(memberId: string, consent: GuardianConsent) {
      const { data, error } = await serviceClient
        .from(MEMBERS_TABLE)
        .update({
          guardian_name: consent.guardianName,
          guardian_email: consent.guardianEmail,
          guardian_consent_at: consent.consentedAt,
        })
        .eq("id", memberId)
        // Las dos condiciones cierran la carrera entre leer la fila y escribir:
        // un consentimiento ya registrado no se pisa, y una cuenta que dejó de
        // estar a medias no recibe uno. Sin fila afectada no hubo escritura.
        .is("guardian_consent_at", null)
        .eq("account_status", "incomplete")
        .select("id");
      if (error) {
        throw new Error(
          `No se pudo registrar el consentimiento del tutor del miembro ${memberId}: ${error.message}`,
        );
      }
      return data.length > 0 ? "recorded" : "already_recorded";
    },

    async findByUserId(userId) {
      const { data, error } = await serviceClient
        .from(MEMBERS_TABLE)
        .select(MEMBER_ACCOUNT_COLUMNS)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        throw new Error(
          `No se pudo leer la fila de miembro de la identidad ${userId}: ${error.message}`,
        );
      }
      return data === null ? null : toMemberAccountRecord(data);
    },

    async updateProfile(memberId, values) {
      const { error } = await serviceClient
        .from(MEMBERS_TABLE)
        .update(toMemberColumns(values))
        .eq("id", memberId);
      if (error) {
        throw new Error(
          `No se pudo guardar el perfil del miembro ${memberId}: ${error.message}`,
        );
      }
    },

    async activateMember(memberId) {
      const { error } = await serviceClient
        .from(MEMBERS_TABLE)
        .update({ account_status: "active" })
        .eq("id", memberId)
        // La condición sobre el estado no sobra. Entre leer la fila y escribir
        // este `update` cabe una baja de socio (FR-085, E5), y sin ella la
        // baja se revive sola: sólo se activa lo que todavía está a medias.
        .eq("account_status", "incomplete");
      if (error) {
        throw new Error(
          `No se pudo activar el miembro ${memberId}: ${error.message}`,
        );
      }
    },
  };
}

export function createEmailLocaleDirectory(
  serviceClient: SupabaseClient,
): EmailLocaleDirectory {
  return {
    async findStoredEmailLocale(userId) {
      const { data, error } = await serviceClient
        .from(MEMBERS_TABLE)
        .select("email_locale")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        throw new Error(
          `No se pudo leer el idioma de los correos de la identidad ${userId}: ${error.message}`,
        );
      }
      return data === null
        ? null
        : readText(data, "email_locale", MEMBERS_TABLE);
    },
  };
}

function createIdentityConfirmationReader(
  serviceClient: SupabaseClient,
): IdentityConfirmationReader {
  return {
    async isEmailConfirmed(userId) {
      const { data, error } =
        await serviceClient.auth.admin.getUserById(userId);
      if (error) {
        throw new Error(
          `No se pudo leer la identidad ${userId}: ${error.message}`,
        );
      }
      if (!data.user) {
        throw new Error(`La identidad ${userId} no existe.`);
      }
      return Boolean(data.user.email_confirmed_at);
    },
  };
}

/** Las variables que necesita cualquier ruta de cuentas. Se piden juntas a
 * propósito: un entorno con la llave anónima pero sin la de servicio no puede
 * registrar a nadie, y decirlo de una vez evita tres listas distintas. */
function missingAuthKeys(env: Environment): readonly string[] {
  const anon = readSupabaseConfig(env);
  const service = readSupabaseServiceRoleConfig(env);
  return [
    ...(anon.kind === "missing" ? anon.missingKeys : []),
    // SUPABASE_URL_ENV falta en las dos configuraciones a la vez y sólo debe
    // nombrarse una.
    ...(service.kind === "missing"
      ? service.missingKeys.filter((key) => key !== SUPABASE_URL_ENV)
      : []),
  ];
}

/** Mensaje único de "esto no está configurado" para las rutas de cuentas: las
 * tres piden el mismo entorno y tienen que decir lo mismo cuando falta. */
export function describeMissingAuthKeys(
  missingKeys: readonly string[],
): string {
  return `El servicio de cuentas no está configurado: faltan ${missingKeys.join(", ")}.`;
}

/** Raíz de composición de las rutas de cuentas. Devuelve las variables que
 * faltan en vez de lanzar, para que la ruta pueda responder 503 nombrándolas,
 * igual que hace el endpoint de salud. */
export function createSupabaseAuthGateways(
  env: Environment,
): SupabaseAuthGatewaysResult {
  const anonConfig = readSupabaseConfig(env);
  const serviceConfig = readSupabaseServiceRoleConfig(env);
  const missingKeys = missingAuthKeys(env);
  if (
    missingKeys.length > 0 ||
    anonConfig.kind === "missing" ||
    serviceConfig.kind === "missing"
  ) {
    return { kind: "unconfigured", missingKeys };
  }

  const serviceClient = createServiceRoleClient(env);
  const anonClient = createClient(anonConfig.url, anonConfig.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const emails = connectResendEmailSender(env);
  const emailLocales = createEmailLocaleDirectory(serviceClient);
  const confirmationEmail = createConfirmationEmailGateway({
    tokens: createConfirmationTokenIssuer(serviceClient),
    emails,
    emailLocales,
  });

  return {
    kind: "ready",
    gateways: {
      registration: {
        identities: createIdentityGateway(serviceClient),
        members: createMemberDirectory(serviceClient),
        confirmationEmail,
      },
      confirmations: createEmailConfirmationGateway(anonClient),
      clubs: createClubDirectory(serviceClient),
      accounts: createMemberAccountStore(serviceClient),
      identities: createIdentityConfirmationReader(serviceClient),
      audit: createSupabaseAuditLogWriter(serviceClient),
      confirmationEmail,
      emailLocales,
      confirmationEmailRequestsForClub: (clubId) =>
        createSupabaseEmailRequestLog(serviceClient, {
          table: CONFIRMATION_EMAIL_REQUESTS_TABLE,
          clubId,
        }),
      registrationRequestsForClub: (clubId) =>
        createSupabaseRegistrationRequestLog(serviceClient, {
          clubId,
          // La llave de servicio hace de clave del hash de los sujetos. Es un
          // secreto que este código ya necesita y que nunca sale del servidor,
          // así que no hace falta una variable nueva que alguien tenga que
          // acordarse de poner en cada entorno. Ver `hashRegistrationSubject`.
          hashSecret: serviceConfig.serviceRoleKey,
        }),
      emailDeliveryForClub: (clubId) =>
        createEmailDeliveryAvailabilityCheck({
          connection: emails,
          provider: createResendProviderProbe(env),
          budget: createSupabaseEmailSendBudget(serviceClient, clubId),
        }),
    },
  };
}
