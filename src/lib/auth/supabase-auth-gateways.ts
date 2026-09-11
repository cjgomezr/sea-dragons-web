import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  SUPABASE_URL_ENV,
  readSupabaseConfig,
  readSupabaseServiceRoleConfig,
} from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import {
  ACCOUNT_STATUSES,
  type AccountStatus,
  type IdentityConfirmationReader,
  type MemberAccountRecord,
  type MemberAccountStore,
} from "./account-activation";
import type { EmailConfirmationGateway } from "./email-confirmation";
import type {
  AuthIdentityGateway,
  ConfirmationEmailGateway,
  MemberDirectory,
  RegistrationGateways,
} from "./register-member";

/**
 * Adaptadores entre los puertos del registro y Supabase. Todo lo de aquí es de
 * servidor: usa la llave de servicio, que nunca puede llegar al navegador.
 */

const MEMBERS_TABLE = "members";
const CLUBS_TABLE = "clubs";

/** Release 1 opera un solo club (NFR-009 ya deja club_id en cada tabla para
 * cuando no sea así). Es el club que siembra la migración 0001. */
export const DEFAULT_CLUB_SLUG = "victoria-seadragons";

export type ClubDirectory = {
  findClubIdBySlug(slug: string): Promise<string>;
};

export type SupabaseAuthGateways = {
  readonly registration: RegistrationGateways;
  readonly confirmations: EmailConfirmationGateway;
  readonly clubs: ClubDirectory;
  readonly accounts: MemberAccountStore;
  readonly identities: IdentityConfirmationReader;
  readonly confirmationEmail: ConfirmationEmailGateway;
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

function createConfirmationEmailGateway(
  anonClient: SupabaseClient,
): ConfirmationEmailGateway {
  return {
    async requestConfirmationEmail(email) {
      const { error } = await anonClient.auth.resend({
        type: "signup",
        email,
      });
      return error
        ? { kind: "failed", reason: error.message }
        : { kind: "requested" };
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

function readRequiredText(
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
    accountStatus: readAccountStatus(row),
    profile: {
      country: readText(row, "country", MEMBERS_TABLE),
      dateOfBirth: readText(row, "date_of_birth", MEMBERS_TABLE),
      membershipType: readText(row, "membership_type", MEMBERS_TABLE),
      guardianConsentAt: readText(row, "guardian_consent_at", MEMBERS_TABLE),
    },
  };
}

const MEMBER_ACCOUNT_COLUMNS =
  "id, account_status, country, date_of_birth, membership_type, guardian_consent_at";

function createMemberAccountStore(
  serviceClient: SupabaseClient,
): MemberAccountStore {
  return {
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

    async updateAccountStatus(memberId, status) {
      const { error } = await serviceClient
        .from(MEMBERS_TABLE)
        .update({ account_status: status })
        .eq("id", memberId);
      if (error) {
        throw new Error(
          `No se pudo cambiar el estado del miembro ${memberId} a ${status}: ${error.message}`,
        );
      }
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
  const missingKeys = missingAuthKeys(env);
  if (missingKeys.length > 0 || anonConfig.kind === "missing") {
    return { kind: "unconfigured", missingKeys };
  }

  const serviceClient = createServiceRoleClient(env);
  const anonClient = createClient(anonConfig.url, anonConfig.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const confirmationEmail = createConfirmationEmailGateway(anonClient);

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
      confirmationEmail,
    },
  };
}
