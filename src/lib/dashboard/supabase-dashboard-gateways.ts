import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  createClubAttendanceRateGateways,
  createMemberAttendanceGateway,
} from "@/lib/attendance/supabase-attendance-stats";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { createEventAgendaGateways } from "@/lib/events/supabase-event-agenda-gateways";
import { readText } from "@/lib/auth/supabase-auth-gateways";
import type { ProfileContact } from "@/lib/members/profile-contact";
import { readEmergencyContact } from "@/lib/members/supabase-profile-contact";
import { createMembershipGateway } from "@/lib/membership/supabase-membership-gateways";
import { createNewsGateways } from "@/lib/news/supabase-news-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  ActiveMembers,
  DashboardFailureLog,
  DashboardGateways,
  DashboardRosterGateway,
} from "./dashboard";

/**
 * Adaptador entre el dashboard (#424) y Supabase. Cada fuente se cablea con
 * el mismo adaptador que usa su sección; lo único nuevo son las lecturas de
 * `members` que ninguna sección hacía.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const MEMBERS_TABLE = "members";

const newsSeenRowSchema = z.object({ news_seen_at: z.string().nullable() });

async function countMembers(
  query: PromiseLike<{
    readonly count: number | null;
    readonly error: { readonly message: string } | null;
  }>,
  context: string,
): Promise<number> {
  const { count, error } = await query;
  if (error) {
    throw new Error(`No se pudo contar ${context}: ${error.message}`);
  }
  if (count === null) {
    throw new Error(`La base no devolvió la cuenta de ${context}.`);
  }
  return count;
}

async function countActiveMembers(
  serviceClient: SupabaseClient,
  query: { readonly clubId: string; readonly joinedSince: string },
): Promise<ActiveMembers> {
  const activeOfClub = () =>
    serviceClient
      .from(MEMBERS_TABLE)
      .select("user_id", { count: "exact", head: true })
      .eq("club_id", query.clubId)
      .eq("account_status", "active");
  const [active, joinedRecently] = await Promise.all([
    countMembers(activeOfClub(), `los socios activos de ${query.clubId}`),
    countMembers(
      activeOfClub().gte("joined_on", query.joinedSince),
      `las altas de ${query.clubId} desde ${query.joinedSince}`,
    ),
  ]);
  return { active, joinedRecently };
}

async function findNewsSeenAt(
  serviceClient: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await serviceClient
    .from(MEMBERS_TABLE)
    .select("news_seen_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer la visita a Noticias de ${userId}: ${error.message}`,
    );
  }
  if (data === null) {
    throw new Error(`No hay ningún socio con el id ${userId}.`);
  }
  return newsSeenRowSchema.parse(data).news_seen_at;
}

/** Las mismas columnas y la misma lectura que el perfil propio (#496). */
const CONTACT_COLUMNS =
  "phone, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship";

async function findOwnContact(
  serviceClient: SupabaseClient,
  userId: string,
): Promise<ProfileContact> {
  const { data, error } = await serviceClient
    .from(MEMBERS_TABLE)
    .select(CONTACT_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer el contacto de ${userId}: ${error.message}`,
    );
  }
  if (data === null) {
    throw new Error(`No hay ningún socio con el id ${userId}.`);
  }
  return {
    phone: readText(data, "phone", MEMBERS_TABLE),
    emergencyContact: readEmergencyContact(data),
  };
}

export function createDashboardRosterGateway(
  serviceClient: SupabaseClient,
): DashboardRosterGateway {
  return {
    countActiveMembers: (query) => countActiveMembers(serviceClient, query),
    findNewsSeenAt: (userId) => findNewsSeenAt(serviceClient, userId),
    findOwnContact: (userId) => findOwnContact(serviceClient, userId),
  };
}

/** Una fuente caída no rompe la respuesta, así que el envoltorio de la API
 * nunca la ve: sin esto el fallo no quedaría en ningún sitio (RF-6). */
const consoleFailureLog: DashboardFailureLog = {
  report(source, error) {
    console.error("[api/v1/dashboard] fuente no disponible", {
      source,
      error,
    });
  },
};

export function createDashboardGateways(
  serviceClient: SupabaseClient,
): DashboardGateways {
  const members = createRoleRequestGateways(serviceClient).members;
  return {
    members,
    clubRate: createClubAttendanceRateGateways(serviceClient),
    ownAttendance: {
      members,
      attendance: createMemberAttendanceGateway(serviceClient),
    },
    agenda: createEventAgendaGateways(serviceClient),
    news: createNewsGateways(serviceClient),
    roster: createDashboardRosterGateway(serviceClient),
    membership: createMembershipGateway(serviceClient),
    failures: consoleFailureLog,
  };
}

export type DashboardGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: DashboardGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición del dashboard. Con la llave de servicio, como cada
 * sección: el club y la audiencia salen de la fila de quien llama. */
export function createSupabaseDashboardGateways(
  env: Environment,
): DashboardGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createDashboardGateways(createServiceRoleClient(env)),
  };
}
