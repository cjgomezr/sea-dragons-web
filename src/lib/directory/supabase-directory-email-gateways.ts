import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { parseAccountStatus } from "@/lib/auth/account-status";
import { readRequiredText } from "@/lib/auth/supabase-auth-gateways";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readClubBrand } from "@/lib/club/supabase-club-brand";
import {
  connectResendBatchEmailSender,
  createResendProviderProbe,
} from "@/lib/email/resend-email-sender";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  DirectoryEmailGateways,
  DirectoryEmailQuotaGateway,
  DirectoryEmailRecipient,
  DirectoryEmailReservation,
} from "./directory-email";

/**
 * Adaptador entre el correo del directorio (#501) y Supabase y Resend.
 *
 * Va por la llave de servicio: `directory_email_sends` y sus funciones son
 * sólo del servidor (`0059_directory_email_sends.sql`), y la policy de
 * `members` deja a un socio ver sólo su propia fila. Quién escribe lo decidió
 * antes la cookie de sesión, y los socios se leen sólo del club de quien
 * escribe (NFR-009).
 */

const SENDS_TABLE = "directory_email_sends";
const RESERVE_FUNCTION = "reserve_directory_email_quota";
const COUNT_FUNCTION = "count_directory_emails_since";
const MEMBERS_TABLE = "members";
const RECIPIENT_COLUMNS =
  "user_id, full_name, email, account_status, email_locale";

type Environment = Readonly<Record<string, string | undefined>>;

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function describeUnexpected(value: unknown): string {
  return `${RESERVE_FUNCTION} devolvió ${JSON.stringify(value)}, que este adaptador no reconoce.`;
}

/** La respuesta de la función, estrechada. Lo que no cuadra es un esquema que
 * cambió sin que este archivo se enterara, no un envío que se pueda dar por
 * bueno. */
function toReservation(data: unknown): DirectoryEmailReservation {
  if (!isRow(data)) {
    throw new Error(describeUnexpected(data));
  }
  if (data.outcome === "reserved" && typeof data.send_id === "string") {
    return { kind: "reserved", sendId: data.send_id };
  }
  if (data.outcome === "exceeded" && typeof data.remaining === "number") {
    return { kind: "exceeded", remaining: data.remaining };
  }
  if (data.outcome === "duplicate") {
    return { kind: "duplicate" };
  }
  throw new Error(describeUnexpected(data));
}

export function createDirectoryEmailQuotaGateway(
  serviceClient: SupabaseClient,
): DirectoryEmailQuotaGateway {
  return {
    async countSentSince(windowStart) {
      const { data, error } = await serviceClient.rpc(COUNT_FUNCTION, {
        window_start: windowStart.toISOString(),
      });
      if (error) {
        throw new Error(
          `No se pudo llamar a ${COUNT_FUNCTION}: ${error.message}`,
        );
      }
      if (typeof data !== "number") {
        throw new Error(
          `${COUNT_FUNCTION} devolvió ${JSON.stringify(data)} en vez de un número.`,
        );
      }
      return data;
    },

    async reserve(request) {
      const { data, error } = await serviceClient.rpc(RESERVE_FUNCTION, {
        target_club_id: request.clubId,
        sender_user_id: request.senderId,
        send_request_id: request.requestId,
        recipient_count: request.recipientCount,
        quota_limit: request.limit,
        window_start: request.windowStart.toISOString(),
      });
      if (error) {
        throw new Error(
          `No se pudo llamar a ${RESERVE_FUNCTION}: ${error.message}`,
        );
      }
      return toReservation(data);
    },

    async settle(sendId, deliveredCount) {
      const { data, error } = await serviceClient
        .from(SENDS_TABLE)
        .update({ sent_count: deliveredCount })
        .eq("id", sendId)
        .select("id");
      if (error) {
        throw new Error(
          `No se pudo apuntar cuántos salieron del envío ${sendId}: ${error.message}`,
        );
      }
      if (data.length !== 1) {
        throw new Error(`No existe el envío ${sendId} en ${SENDS_TABLE}.`);
      }
    },
  };
}

function toRecipient(row: Row): DirectoryEmailRecipient {
  const status = readRequiredText(row, "account_status", MEMBERS_TABLE);
  const parsedStatus = parseAccountStatus(status);
  if (parsedStatus === null) {
    throw new Error(
      `${MEMBERS_TABLE}.account_status devolvió ${status}, que el catálogo no reconoce.`,
    );
  }
  return {
    userId: readRequiredText(row, "user_id", MEMBERS_TABLE),
    fullName: readRequiredText(row, "full_name", MEMBERS_TABLE),
    email: readRequiredText(row, "email", MEMBERS_TABLE),
    status: parsedStatus,
    locale: readRequiredText(row, "email_locale", MEMBERS_TABLE),
  };
}

export function createDirectoryEmailRecipientsGateway(
  serviceClient: SupabaseClient,
): DirectoryEmailGateways["recipients"] {
  return {
    async findEmailRecipients(clubId, userIds) {
      const { data, error } = await serviceClient
        .from(MEMBERS_TABLE)
        .select(RECIPIENT_COLUMNS)
        .eq("club_id", clubId)
        .in("user_id", [...userIds]);
      if (error) {
        throw new Error(
          `No se pudieron leer los destinatarios del club ${clubId}: ${error.message}`,
        );
      }
      return data.map(toRecipient);
    },
  };
}

export type DirectoryEmailGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: DirectoryEmailGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición para el endpoint del correo. Sin Resend configurado
 * sigue lista: el dominio responde entonces que el envío no está disponible,
 * y el cupo se puede leer igual. */
export function createSupabaseDirectoryEmailGateways(
  env: Environment,
): DirectoryEmailGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  const serviceClient = createServiceRoleClient(env);
  return {
    kind: "ready",
    gateways: {
      members: createRoleRequestGateways(serviceClient).members,
      recipients: createDirectoryEmailRecipientsGateway(serviceClient),
      quota: createDirectoryEmailQuotaGateway(serviceClient),
      delivery: {
        connection: connectResendBatchEmailSender(env),
        provider: createResendProviderProbe(env),
      },
      brand: { readClubBrand },
      audit: createSupabaseAuditLogWriter(serviceClient),
      log: (message, details) => console.error(message, details),
    },
  };
}
