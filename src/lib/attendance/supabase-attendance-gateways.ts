import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { ACCOUNT_STATUSES } from "@/lib/auth/account-status";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { EVENT_TYPES } from "@/lib/events/event-creation";
import { RSVP_RESPONSES } from "@/lib/events/event-rsvp";
import { createSupabaseAudienceMembersGateway } from "@/lib/notifications/supabase-audience-members";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  AttendanceSessionsGateways,
  RecentTraining,
} from "./attendance-sessions";
import {
  ATTENDANCE_STATUSES,
  type AttendanceEvent,
  type AttendanceGateways,
  type AttendanceRecord,
  type AttendanceSaveOutcome,
  type MemberRsvp,
  type NewAttendanceSheet,
  type SheetMemberRecord,
} from "./attendance-sheet";

/**
 * Pasar lista contra Supabase (#393).
 *
 * Va por la llave de servicio: `authenticated` sólo lee sus propias filas de
 * asistencia (`0043_attendance_records.sql`) y no escribe ninguna. El servidor
 * ya comprobó que quien llama es Admin o Coach, y cada consulta va acotada a
 * su club o a un evento de su club.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const EVENTS_TABLE = "events";
const MEMBERS_TABLE = "members";
const RSVPS_TABLE = "event_rsvps";
const ATTENDANCE_TABLE = "attendance_records";
const SAVE_SHEET_FUNCTION = "save_attendance_sheet";
const TRAINING_TYPE = "training";
const SCHEDULED_STATUS = "scheduled";

const attendanceEventRowSchema = z.object({
  id: z.string(),
  club_id: z.string(),
  event_type: z.enum(EVENT_TYPES),
  title: z.string(),
  status: z.enum(["scheduled", "cancelled"]),
  starts_at: z.string(),
  audience: z.enum(["all", "groups"]),
  event_groups: z.array(z.object({ group_id: z.string() })),
});

const memberRowsSchema = z.array(
  z.object({
    user_id: z.string(),
    full_name: z.string(),
    account_status: z.enum(ACCOUNT_STATUSES),
  }),
);

const rsvpRowsSchema = z.array(
  z.object({ user_id: z.string(), response: z.enum(RSVP_RESPONSES) }),
);

const attendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);

const recordRowsSchema = z.array(
  z.object({ user_id: z.string(), status: attendanceStatusSchema }),
);

const saveOutcomeSchema = z.enum([
  "saved",
  "not_found",
  "not_started",
  "cancelled",
]);

const recentTrainingRowsSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    starts_at: z.string(),
    attendance_records: z.array(z.object({ status: attendanceStatusSchema })),
  }),
);

function toAttendanceEvent(
  row: z.infer<typeof attendanceEventRowSchema>,
): AttendanceEvent {
  return {
    id: row.id,
    clubId: row.club_id,
    eventType: row.event_type,
    title: row.title,
    status: row.status,
    startsAt: new Date(row.starts_at),
    audience:
      row.audience === "all"
        ? { kind: "club" }
        : {
            kind: "groups",
            groupIds: row.event_groups.map((group) => group.group_id),
          },
  };
}

async function findEvent(
  serviceClient: SupabaseClient,
  query: { readonly clubId: string; readonly eventId: string },
): Promise<AttendanceEvent | null> {
  const { data, error } = await serviceClient
    .from(EVENTS_TABLE)
    .select(
      "id, club_id, event_type, title, status, starts_at, audience, event_groups(group_id)",
    )
    .eq("club_id", query.clubId)
    .eq("id", query.eventId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer el evento ${query.eventId} del club ${query.clubId}: ${error.message}`,
    );
  }
  return data === null
    ? null
    : toAttendanceEvent(attendanceEventRowSchema.parse(data));
}

async function findMembers(
  serviceClient: SupabaseClient,
  query: { readonly clubId: string; readonly userIds: readonly string[] },
): Promise<readonly SheetMemberRecord[]> {
  if (query.userIds.length === 0) {
    return [];
  }
  const { data, error } = await serviceClient
    .from(MEMBERS_TABLE)
    .select("user_id, full_name, account_status")
    .eq("club_id", query.clubId)
    .in("user_id", query.userIds);
  if (error) {
    throw new Error(
      `No se pudieron leer los miembros de la hoja en el club ${query.clubId}: ${error.message}`,
    );
  }
  return memberRowsSchema.parse(data).map((row) => ({
    userId: row.user_id,
    fullName: row.full_name,
    status: row.account_status,
  }));
}

async function findRsvps(
  serviceClient: SupabaseClient,
  eventId: string,
): Promise<readonly MemberRsvp[]> {
  const { data, error } = await serviceClient
    .from(RSVPS_TABLE)
    .select("user_id, response")
    .eq("event_id", eventId);
  if (error) {
    throw new Error(
      `No se pudieron leer las respuestas al evento ${eventId}: ${error.message}`,
    );
  }
  return rsvpRowsSchema
    .parse(data)
    .map((row) => ({ userId: row.user_id, response: row.response }));
}

async function findRecords(
  serviceClient: SupabaseClient,
  eventId: string,
): Promise<readonly AttendanceRecord[]> {
  const { data, error } = await serviceClient
    .from(ATTENDANCE_TABLE)
    .select("user_id, status")
    .eq("event_id", eventId);
  if (error) {
    throw new Error(
      `No se pudo leer la asistencia del evento ${eventId}: ${error.message}`,
    );
  }
  return recordRowsSchema
    .parse(data)
    .map((row) => ({ userId: row.user_id, status: row.status }));
}

async function saveSheet(
  serviceClient: SupabaseClient,
  sheet: NewAttendanceSheet,
): Promise<AttendanceSaveOutcome> {
  const { data, error } = await serviceClient.rpc(SAVE_SHEET_FUNCTION, {
    acting_club_id: sheet.clubId,
    acting_user_id: sheet.recordedBy,
    target_event_id: sheet.eventId,
    records: sheet.records.map((record) => ({
      user_id: record.userId,
      status: record.status,
    })),
  });
  if (error) {
    throw new Error(
      `No se pudo guardar la asistencia del evento ${sheet.eventId}: ${error.message}`,
    );
  }
  return saveOutcomeSchema.parse(data);
}

async function findRecentTrainings(
  serviceClient: SupabaseClient,
  query: {
    readonly clubId: string;
    readonly since: Date;
    readonly until: Date;
  },
): Promise<readonly RecentTraining[]> {
  const { data, error } = await serviceClient
    .from(EVENTS_TABLE)
    .select("id, title, starts_at, attendance_records(status)")
    .eq("club_id", query.clubId)
    .eq("event_type", TRAINING_TYPE)
    .eq("status", SCHEDULED_STATUS)
    .gte("starts_at", query.since.toISOString())
    .lte("starts_at", query.until.toISOString());
  if (error) {
    throw new Error(
      `No se pudieron leer las sesiones recientes del club ${query.clubId}: ${error.message}`,
    );
  }
  return recentTrainingRowsSchema.parse(data).map((row) => ({
    eventId: row.id,
    title: row.title,
    startsAt: new Date(row.starts_at),
    statuses: row.attendance_records.map((record) => record.status),
  }));
}

export function createAttendanceGateways(
  serviceClient: SupabaseClient,
): AttendanceGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    audience: createSupabaseAudienceMembersGateway(serviceClient),
    sheets: {
      findEvent: (query) => findEvent(serviceClient, query),
      findMembers: (query) => findMembers(serviceClient, query),
      findRsvps: (eventId) => findRsvps(serviceClient, eventId),
      findRecords: (eventId) => findRecords(serviceClient, eventId),
      saveSheet: (sheet) => saveSheet(serviceClient, sheet),
    },
    audit: createSupabaseAuditLogWriter(serviceClient),
  };
}

export function createAttendanceSessionsGateways(
  serviceClient: SupabaseClient,
): AttendanceSessionsGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    sessions: {
      findRecentTrainings: (query) => findRecentTrainings(serviceClient, query),
    },
  };
}

export type AttendanceWiring<Gateways> =
  | { readonly kind: "ready"; readonly gateways: Gateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

function wire<Gateways>(
  env: Environment,
  create: (serviceClient: SupabaseClient) => Gateways,
): AttendanceWiring<Gateways> {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return { kind: "ready", gateways: create(createServiceRoleClient(env)) };
}

/** Raíz de composición de la hoja. Devuelve las variables que faltan en vez
 * de lanzar, como las demás. */
export function createSupabaseAttendanceGateways(
  env: Environment,
): AttendanceWiring<AttendanceGateways> {
  return wire(env, createAttendanceGateways);
}

/** Raíz de composición de las sesiones recientes. */
export function createSupabaseAttendanceSessionsGateways(
  env: Environment,
): AttendanceWiring<AttendanceSessionsGateways> {
  return wire(env, createAttendanceSessionsGateways);
}
