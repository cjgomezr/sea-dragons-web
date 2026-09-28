import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import {
  type ClubAttendanceRate,
  type MemberAttendance,
  type MemberAttendanceGateway,
  toClubAttendanceRate,
  toMemberAttendance,
} from "./attendance-stats";
import type {
  ClubAttendanceRateGateways,
  ClubRateWindow,
} from "./club-attendance-rate";
import type { OwnAttendanceGateways } from "./own-attendance";

/**
 * Adaptador entre la asistencia contada (#394) y Supabase.
 *
 * Las dos funciones de `0045_attendance_stats.sql` sólo las ejecuta
 * `service_role`, como los conteos de RSVP: el servidor ya decidió quién
 * pregunta y de qué club, y pasa ese club.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const MEMBER_STATS_FUNCTION = "attendance_stats";
const CLUB_RATE_FUNCTION = "club_attendance_rate";

const memberStatsRowSchema = z.object({
  user_id: z.uuid(),
  eligible_sessions: z.number().int(),
  attended_sessions: z.number().int(),
  attendance_percent: z.number().int().nullable(),
});

// Una función de agregado sin `group by` devuelve siempre una fila.
const clubRateRowsSchema = z.tuple([
  z.object({
    total_records: z.number().int(),
    attendance_percent: z.number().int().nullable(),
  }),
]);

async function findMemberAttendance(
  serviceClient: SupabaseClient,
  clubId: string,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, MemberAttendance>> {
  const { data, error } = await serviceClient.rpc(MEMBER_STATS_FUNCTION, {
    p_club_id: clubId,
    p_user_ids: userIds,
  });
  if (error) {
    throw new Error(
      `No se pudo contar la asistencia de ${userIds.length} miembros del club ${clubId}: ${error.message}`,
    );
  }
  return new Map(
    z
      .array(memberStatsRowSchema)
      .parse(data)
      .map((row) => [
        row.user_id,
        toMemberAttendance({
          eligibleSessions: row.eligible_sessions,
          attendedSessions: row.attended_sessions,
          percent: row.attendance_percent,
        }),
      ]),
  );
}

async function findClubAttendanceRate(
  serviceClient: SupabaseClient,
  clubId: string,
  window: ClubRateWindow,
): Promise<ClubAttendanceRate> {
  const { data, error } = await serviceClient.rpc(CLUB_RATE_FUNCTION, {
    p_club_id: clubId,
    p_since: window.since,
    p_until: window.until,
  });
  if (error) {
    throw new Error(
      `No se pudo contar la asistencia del club ${clubId} del ${window.since} al ${window.until}: ${error.message}`,
    );
  }
  const [row] = clubRateRowsSchema.parse(data);
  return toClubAttendanceRate({
    totalRecords: row.total_records,
    percent: row.attendance_percent,
  });
}

export function createMemberAttendanceGateway(
  serviceClient: SupabaseClient,
): MemberAttendanceGateway {
  return {
    findMemberAttendance: (clubId, userIds) =>
      findMemberAttendance(serviceClient, clubId, userIds),
  };
}

export function createClubAttendanceRateGateways(
  serviceClient: SupabaseClient,
): ClubAttendanceRateGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    clubRate: {
      findClubAttendanceRate: (clubId, window) =>
        findClubAttendanceRate(serviceClient, clubId, window),
    },
  };
}

export type ClubAttendanceRateGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: ClubAttendanceRateGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición del endpoint de la tasa. Devuelve las variables que
 * faltan en vez de lanzar, como las demás. */
export function createSupabaseClubAttendanceRateGateways(
  env: Environment,
): ClubAttendanceRateGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createClubAttendanceRateGateways(createServiceRoleClient(env)),
  };
}

export type OwnAttendanceGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: OwnAttendanceGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición de la asistencia propia. Con la llave de servicio
 * aunque pregunte el propio miembro: la función sólo la ejecuta
 * `service_role`, y el club sale de su fila. */
export function createSupabaseOwnAttendanceGateways(
  env: Environment,
): OwnAttendanceGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  const serviceClient = createServiceRoleClient(env);
  return {
    kind: "ready",
    gateways: {
      members: createRoleRequestGateways(serviceClient).members,
      attendance: createMemberAttendanceGateway(serviceClient),
    },
  };
}
