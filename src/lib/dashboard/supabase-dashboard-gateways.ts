import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createAttendanceSessionsGateways } from "@/lib/attendance/supabase-attendance-gateways";
import { createClubAttendanceRateGateways } from "@/lib/attendance/supabase-attendance-stats";
import { createSeasonAttendanceGateway } from "@/lib/attendance/supabase-season-attendance";
import { createClubAdministrationGateways } from "@/lib/auth/supabase-club-administration-gateways";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { createEventAgendaGateways } from "@/lib/events/supabase-event-agenda-gateways";
import { readText } from "@/lib/auth/supabase-auth-gateways";
import type { ProfileContact } from "@/lib/members/profile-contact";
import { readEmergencyContact } from "@/lib/members/supabase-profile-contact";
import { createMembershipGateway } from "@/lib/membership/supabase-membership-gateways";
import { createNewsGateways } from "@/lib/news/supabase-news-gateways";
import { createNewsSeenGateway } from "@/lib/news/supabase-news-seen-gateway";
import { createMyTeamGateways } from "@/lib/teams/supabase-team-builder-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  ActiveMembers,
  DashboardFailureLog,
  DashboardGateways,
  DashboardRosterGateway,
} from "./dashboard";
import type {
  DroppedPlayersGateway,
  PublishedSplitDrops,
  UnansweredGateway,
} from "./dashboard-management";

/**
 * Adaptador entre el dashboard (#424) y Supabase. Cada fuente se cablea con
 * el mismo adaptador que usa su sección; lo único nuevo son las lecturas de
 * `members` que ninguna sección hacía y quién no respondió al próximo
 * evento (#746).
 */

type Environment = Readonly<Record<string, string | undefined>>;

const MEMBERS_TABLE = "members";

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
    findNewsSeenAt: (userId) =>
      createNewsSeenGateway(serviceClient).findNewsSeenAt(userId),
    findOwnContact: (userId) => findOwnContact(serviceClient, userId),
  };
}

const UNANSWERED_FUNCTION = "event_unanswered_count";

/** `event_unanswered_count` (`0076`) sólo la ejecuta `service_role`. */
export function createUnansweredGateway(
  serviceClient: SupabaseClient,
): UnansweredGateway {
  return {
    async countUnanswered({ clubId, eventId }) {
      const { data, error } = await serviceClient.rpc(UNANSWERED_FUNCTION, {
        p_club_id: clubId,
        p_event_id: eventId,
      });
      if (error) {
        throw new Error(
          `No se pudo contar quién no respondió al evento ${eventId}: ${error.message}`,
        );
      }
      return z.number().int().nonnegative().parse(data);
    },
  };
}

const SPLITS_TABLE = "team_splits";
const RSVPS_TABLE = "event_rsvps";
const DECLINED_RESPONSE = "no";

const publishedSplitRowSchema = z.object({
  published_by: z.string().nullable(),
  team_split_members: z.array(z.object({ user_id: z.string() })),
});

const userIdRowsSchema = z.array(z.object({ user_id: z.string() }));

async function findDeclinedUserIds(
  serviceClient: SupabaseClient,
  query: { readonly eventId: string; readonly userIds: readonly string[] },
): Promise<readonly string[]> {
  if (query.userIds.length === 0) {
    return [];
  }
  const { data, error } = await serviceClient
    .from(RSVPS_TABLE)
    .select("user_id")
    .eq("event_id", query.eventId)
    .eq("response", DECLINED_RESPONSE)
    .in("user_id", query.userIds);
  if (error) {
    throw new Error(
      `No se pudo leer quién ya no viene al evento ${query.eventId}: ${error.message}`,
    );
  }
  return userIdRowsSchema.parse(data).map((row) => row.user_id);
}

/** #838: el reparto publicado del evento, quién lo publicó y cuáles de sus
 * asignados respondieron que no. */
async function findDroppedPlayers(
  serviceClient: SupabaseClient,
  query: { readonly clubId: string; readonly eventId: string },
): Promise<PublishedSplitDrops | null> {
  const { data, error } = await serviceClient
    .from(SPLITS_TABLE)
    .select("published_by, team_split_members(user_id)")
    .eq("club_id", query.clubId)
    .eq("event_id", query.eventId)
    .not("published_at", "is", null)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer el reparto publicado del evento ${query.eventId}: ${error.message}`,
    );
  }
  if (data === null) {
    return null;
  }
  const split = publishedSplitRowSchema.parse(data);
  return {
    publishedBy: split.published_by,
    droppedUserIds: await findDeclinedUserIds(serviceClient, {
      eventId: query.eventId,
      userIds: split.team_split_members.map((member) => member.user_id),
    }),
  };
}

export function createDroppedPlayersGateway(
  serviceClient: SupabaseClient,
): DroppedPlayersGateway {
  return {
    findDroppedPlayers: (query) => findDroppedPlayers(serviceClient, query),
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
  return {
    members: createRoleRequestGateways(serviceClient).members,
    clubRate: createClubAttendanceRateGateways(serviceClient).clubRate,
    agenda: createEventAgendaGateways(serviceClient),
    news: createNewsGateways(serviceClient),
    roster: createDashboardRosterGateway(serviceClient),
    membership: createMembershipGateway(serviceClient),
    myTeam: createMyTeamGateways(serviceClient),
    seasonAttendance: createSeasonAttendanceGateway(serviceClient),
    administration: createClubAdministrationGateways(serviceClient),
    attendanceSessions: createAttendanceSessionsGateways(serviceClient),
    unanswered: createUnansweredGateway(serviceClient),
    droppedPlayers: createDroppedPlayersGateway(serviceClient),
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
