import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { createSupabaseMemberGroupsGateway } from "@/lib/groups/supabase-member-groups-gateway";
import { createSupabaseAudienceMembersGateway } from "@/lib/notifications/supabase-audience-members";
import { createSupabaseNotificationWriter } from "@/lib/notifications/supabase-notification-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  SessionVideoEvent,
  SessionVideoGateways,
  SessionVideoSave,
  SessionVideosGateway,
} from "./session-video";
import { toHoursAndMinutes } from "./supabase-event-management-gateways";

/**
 * El vídeo de una sesión contra Supabase (#965).
 *
 * Va por la llave de servicio, como editar un evento: `authenticated` sólo
 * puede leer `events` (`0034_events.sql`), y quién puede poner el vídeo lo
 * decide el dominio con el rol y la audiencia antes de escribir. Cada
 * escritura filtra además por el club de quien llama.
 *
 * Poner el vídeo va por `set_event_video` (`0093_event_video_notice.sql`),
 * que dice en la misma sentencia si la sesión no tenía (#966).
 */

const EVENTS_TABLE = "events";
const SET_EVENT_VIDEO_FUNCTION = "set_event_video";

type Environment = Readonly<Record<string, string | undefined>>;

type EventQuery = { readonly clubId: string; readonly eventId: string };

const videoEventRowSchema = z.object({
  id: z.string(),
  status: z.enum(["scheduled", "cancelled"]),
  title: z.string(),
  starts_on: z.string(),
  start_time: z.string(),
  audience: z.enum(["all", "groups"]),
  event_groups: z.array(z.object({ group_id: z.string() })),
});

function toSessionVideoEvent(row: unknown): SessionVideoEvent {
  const parsed = videoEventRowSchema.parse(row);
  return {
    id: parsed.id,
    status: parsed.status,
    title: parsed.title,
    startsOn: parsed.starts_on,
    startTime: toHoursAndMinutes(parsed.start_time),
    audience:
      parsed.audience === "all"
        ? { kind: "club" }
        : {
            kind: "groups",
            groupIds: parsed.event_groups.map((group) => group.group_id),
          },
  };
}

async function findEvent(
  serviceClient: SupabaseClient,
  query: EventQuery,
): Promise<SessionVideoEvent | null> {
  const { data, error } = await serviceClient
    .from(EVENTS_TABLE)
    .select(
      "id, status, title, starts_on, start_time, audience, event_groups(group_id)",
    )
    .eq("club_id", query.clubId)
    .eq("id", query.eventId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer el evento ${query.eventId} del club ${query.clubId}: ${error.message}`,
    );
  }
  return data === null ? null : toSessionVideoEvent(data);
}

/** `true` si la sesión no tenía vídeo; `null` si no es de ese club. */
const wasEmptySchema = z.boolean().nullable();

async function saveVideo(
  serviceClient: SupabaseClient,
  video: EventQuery & { readonly url: string },
): Promise<SessionVideoSave> {
  const { data, error } = await serviceClient.rpc(SET_EVENT_VIDEO_FUNCTION, {
    p_club_id: video.clubId,
    p_event_id: video.eventId,
    p_url: video.url,
  });
  if (error) {
    throw new Error(
      `No se pudo guardar el vídeo del evento ${video.eventId} del club ${video.clubId}: ${error.message}`,
    );
  }
  const wasEmpty = wasEmptySchema.parse(data);
  if (wasEmpty === null) {
    throw new Error(
      `El evento ${video.eventId} ya no está en el club ${video.clubId}: no se guardó el vídeo.`,
    );
  }
  return wasEmpty ? "added" : "replaced";
}

async function removeVideo(
  serviceClient: SupabaseClient,
  query: EventQuery,
): Promise<void> {
  const { error } = await serviceClient
    .from(EVENTS_TABLE)
    .update({ video_url: null })
    .eq("club_id", query.clubId)
    .eq("id", query.eventId);
  if (error) {
    throw new Error(
      `No se pudo quitar el vídeo del evento ${query.eventId} del club ${query.clubId}: ${error.message}`,
    );
  }
}

function createSessionVideosGateway(
  serviceClient: SupabaseClient,
): SessionVideosGateway {
  return {
    findEvent: (query) => findEvent(serviceClient, query),
    saveVideo: (video) => saveVideo(serviceClient, video),
    removeVideo: (query) => removeVideo(serviceClient, query),
  };
}

export type SessionVideoGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: SessionVideoGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición del vídeo de una sesión. Devuelve las variables que
 * faltan en vez de lanzar, como las demás. */
export function createSupabaseSessionVideoGateways(
  env: Environment,
): SessionVideoGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  const serviceClient = createServiceRoleClient(env);
  return {
    kind: "ready",
    gateways: {
      members: createRoleRequestGateways(serviceClient).members,
      memberGroups: createSupabaseMemberGroupsGateway(serviceClient),
      sessionVideos: createSessionVideosGateway(serviceClient),
      eventAudience: createSupabaseAudienceMembersGateway(serviceClient),
      notifications: createSupabaseNotificationWriter(serviceClient),
    },
  };
}
