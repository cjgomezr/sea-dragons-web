import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { cachedClubPositions } from "@/lib/club/supabase-club-positions";
import { EVENT_TYPES } from "@/lib/events/event-creation";
import { toHoursAndMinutes } from "@/lib/events/supabase-event-management-gateways";
import { createSupabaseMemberGroupsGateway } from "@/lib/groups/supabase-member-groups-gateway";
import { createSupabaseNotificationWriter } from "@/lib/notifications/supabase-notification-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type { MyTeamGateways } from "./my-team";
import {
  TEAM_IDS,
  TEAM_SPLIT_MODES,
  type NewTeamSplit,
  type PlayerRecord,
  type SquadResponse,
  type StoredTeamSplit,
  type TeamBuilderEvent,
  type TeamBuilderGateways,
  type TeamSplitPublication,
  type TeamSplitSaveOutcome,
  type TeamSplitsGateway,
} from "./team-builder";

/**
 * El team builder contra Supabase (#401).
 *
 * Va por la llave de servicio: `authenticated` no lee las respuestas de los
 * demás (`0038`), ni las evaluaciones (FR-055), ni un reparto en borrador
 * (`0046`), y no escribe ninguno. El servidor ya comprobó quién llama, y cada
 * consulta va acotada a su club o a un evento de su club.
 *
 * La escuadra son dos lecturas sea cual sea su tamaño: las respuestas vivas
 * del evento y los jugadores con su posición y sus notas anidadas.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const EVENTS_TABLE = "events";
const MEMBERS_TABLE = "members";
const SPLITS_TABLE = "team_splits";
const RESPONSES_FUNCTION = "live_event_rsvps";
const SAVE_SPLIT_FUNCTION = "save_team_split";
const PUBLISH_SPLIT_FUNCTION = "publish_team_split";

/** La posición por la clave compuesta que la ata al club (`0025`). */
const PLAYER_COLUMNS = [
  "user_id, full_name, position_id",
  "position:club_positions!members_position_same_club_fkey(coverage)",
  "member_evaluations(member_evaluation_ratings(rating))",
].join(", ");

const SPLIT_COLUMNS = [
  "team_a_name, team_a_color, team_b_name, team_b_color, mode, published_at",
  "team_split_members(user_id, team)",
].join(", ");

const eventRowSchema = z.object({
  id: z.string(),
  club_id: z.string(),
  event_type: z.enum(EVENT_TYPES),
  title: z.string(),
  status: z.enum(["scheduled", "cancelled"]),
  starts_on: z.string(),
  start_time: z.string(),
  audience: z.enum(["all", "groups"]),
  event_groups: z.array(z.object({ group_id: z.string() })),
});

const responseRowsSchema = z.array(
  z.object({ user_id: z.string(), response: z.enum(["yes", "maybe"]) }),
);

// Como en la lista de Evaluaciones: PostgREST sirve la evaluación como lista
// porque la clave foránea es compuesta; la restricción única deja una.
const playerRowsSchema = z.array(
  z.object({
    user_id: z.string(),
    full_name: z.string(),
    position_id: z.string().nullable(),
    position: z
      .object({
        coverage: z.enum(["goalkeeper", "defender", "forward"]).nullable(),
      })
      .nullable(),
    member_evaluations: z
      .array(
        z.object({
          member_evaluation_ratings: z.array(z.object({ rating: z.number() })),
        }),
      )
      .max(1),
  }),
);

const assignmentRowSchema = z.object({
  user_id: z.string(),
  team: z.enum(TEAM_IDS),
});

const splitRowSchema = z.object({
  team_a_name: z.string(),
  team_a_color: z.string(),
  team_b_name: z.string(),
  team_b_color: z.string(),
  mode: z.enum(TEAM_SPLIT_MODES),
  published_at: z.string().nullable(),
  team_split_members: z.array(assignmentRowSchema),
});

const rejectionSchema = z.object({
  outcome: z.enum(["not_found", "not_buildable", "cancelled", "past", "empty"]),
});

const publishedSchema = z.object({
  outcome: z.literal("published"),
  published_at: z.string(),
  team_a_name: z.string(),
  team_a_color: z.string(),
  team_b_name: z.string(),
  team_b_color: z.string(),
  previous: z.array(assignmentRowSchema),
  current: z.array(assignmentRowSchema),
});

const publicationSchema = z.union([publishedSchema, rejectionSchema]);

const saveOutcomeSchema = z.enum([
  "saved",
  "not_found",
  "not_buildable",
  "cancelled",
  "past",
]);

function toAssignments(
  rows: readonly z.infer<typeof assignmentRowSchema>[],
): StoredTeamSplit["assignments"] {
  return rows.map((row) => ({ userId: row.user_id, team: row.team }));
}

function toEvent(row: z.infer<typeof eventRowSchema>): TeamBuilderEvent {
  return {
    id: row.id,
    clubId: row.club_id,
    eventType: row.event_type,
    title: row.title,
    status: row.status,
    startsOn: row.starts_on,
    startTime: toHoursAndMinutes(row.start_time),
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
): Promise<TeamBuilderEvent | null> {
  const { data, error } = await serviceClient
    .from(EVENTS_TABLE)
    .select(
      "id, club_id, event_type, title, status, starts_on, start_time, audience, event_groups(group_id)",
    )
    .eq("club_id", query.clubId)
    .eq("id", query.eventId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer el evento ${query.eventId} del club ${query.clubId}: ${error.message}`,
    );
  }
  return data === null ? null : toEvent(eventRowSchema.parse(data));
}

async function findLiveResponses(
  serviceClient: SupabaseClient,
  eventId: string,
): Promise<readonly SquadResponse[]> {
  const { data, error } = await serviceClient.rpc(RESPONSES_FUNCTION, {
    p_event_ids: [eventId],
  });
  if (error) {
    throw new Error(
      `No se pudo leer quién va al evento ${eventId}: ${error.message}`,
    );
  }
  return responseRowsSchema
    .parse(data)
    .map((row) => ({ userId: row.user_id, response: row.response }));
}

async function findPlayers(
  serviceClient: SupabaseClient,
  query: { readonly clubId: string; readonly userIds: readonly string[] },
): Promise<readonly PlayerRecord[]> {
  if (query.userIds.length === 0) {
    return [];
  }
  const { data, error } = await serviceClient
    .from(MEMBERS_TABLE)
    .select(PLAYER_COLUMNS)
    .eq("club_id", query.clubId)
    .in("user_id", query.userIds);
  if (error) {
    throw new Error(
      `No se pudieron leer los jugadores del club ${query.clubId}: ${error.message}`,
    );
  }
  return playerRowsSchema.parse(data).map((row) => {
    const [evaluation] = row.member_evaluations;
    return {
      userId: row.user_id,
      fullName: row.full_name,
      positionId: row.position_id,
      coverage: row.position === null ? null : row.position.coverage,
      ratings:
        evaluation === undefined
          ? null
          : evaluation.member_evaluation_ratings.map(({ rating }) => rating),
    };
  });
}

async function findSplit(
  serviceClient: SupabaseClient,
  eventId: string,
): Promise<StoredTeamSplit | null> {
  const { data, error } = await serviceClient
    .from(SPLITS_TABLE)
    .select(SPLIT_COLUMNS)
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer el reparto del evento ${eventId}: ${error.message}`,
    );
  }
  if (data === null) {
    return null;
  }
  const row = splitRowSchema.parse(data);
  return {
    teams: {
      a: { name: row.team_a_name, color: row.team_a_color },
      b: { name: row.team_b_name, color: row.team_b_color },
    },
    mode: row.mode,
    publishedAt: row.published_at === null ? null : new Date(row.published_at),
    assignments: toAssignments(row.team_split_members),
  };
}

async function saveSplit(
  serviceClient: SupabaseClient,
  split: NewTeamSplit,
): Promise<TeamSplitSaveOutcome> {
  const { data, error } = await serviceClient.rpc(SAVE_SPLIT_FUNCTION, {
    acting_club_id: split.clubId,
    acting_user_id: split.savedBy,
    target_event_id: split.eventId,
    split: {
      mode: split.mode,
      team_a_name: split.teams.a.name,
      team_a_color: split.teams.a.color,
      team_b_name: split.teams.b.name,
      team_b_color: split.teams.b.color,
      assignments: split.assignments.map((assignment) => ({
        user_id: assignment.userId,
        team: assignment.team,
      })),
    },
  });
  if (error) {
    throw new Error(
      `No se pudo guardar el reparto del evento ${split.eventId}: ${error.message}`,
    );
  }
  return saveOutcomeSchema.parse(data);
}

async function publishSplit(
  serviceClient: SupabaseClient,
  query: { readonly clubId: string; readonly eventId: string },
): Promise<TeamSplitPublication> {
  const { data, error } = await serviceClient.rpc(PUBLISH_SPLIT_FUNCTION, {
    acting_club_id: query.clubId,
    target_event_id: query.eventId,
  });
  if (error) {
    throw new Error(
      `No se pudo publicar el reparto del evento ${query.eventId}: ${error.message}`,
    );
  }
  const row = publicationSchema.parse(data);
  if (row.outcome !== "published") {
    return { kind: row.outcome };
  }
  return {
    kind: "published",
    publishedAt: new Date(row.published_at),
    teams: {
      a: { name: row.team_a_name, color: row.team_a_color },
      b: { name: row.team_b_name, color: row.team_b_color },
    },
    previous: toAssignments(row.previous),
    current: toAssignments(row.current),
  };
}

function createTeamSplitsGateway(
  serviceClient: SupabaseClient,
): TeamSplitsGateway {
  return {
    findEvent: (query) => findEvent(serviceClient, query),
    findLiveResponses: (eventId) => findLiveResponses(serviceClient, eventId),
    findPlayers: (query) => findPlayers(serviceClient, query),
    findSplit: (eventId) => findSplit(serviceClient, eventId),
    saveSplit: (split) => saveSplit(serviceClient, split),
    publishSplit: (query) => publishSplit(serviceClient, query),
  };
}

export function createTeamBuilderGateways(
  serviceClient: SupabaseClient,
): TeamBuilderGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    teams: createTeamSplitsGateway(serviceClient),
    positions: cachedClubPositions,
    notifications: createSupabaseNotificationWriter(serviceClient),
    audit: createSupabaseAuditLogWriter(serviceClient),
  };
}

export function createMyTeamGateways(
  serviceClient: SupabaseClient,
): MyTeamGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    memberGroups: createSupabaseMemberGroupsGateway(serviceClient),
    teams: createTeamSplitsGateway(serviceClient),
    positions: cachedClubPositions,
  };
}

export type TeamsWiring<Gateways> =
  | { readonly kind: "ready"; readonly gateways: Gateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

function wire<Gateways>(
  env: Environment,
  create: (serviceClient: SupabaseClient) => Gateways,
): TeamsWiring<Gateways> {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return { kind: "ready", gateways: create(createServiceRoleClient(env)) };
}

/** Raíz de composición del builder. Devuelve las variables que faltan en vez
 * de lanzar, como las demás. */
export function createSupabaseTeamBuilderGateways(
  env: Environment,
): TeamsWiring<TeamBuilderGateways> {
  return wire(env, createTeamBuilderGateways);
}

/** Raíz de composición de "mi equipo". */
export function createSupabaseMyTeamGateways(
  env: Environment,
): TeamsWiring<MyTeamGateways> {
  return wire(env, createMyTeamGateways);
}
