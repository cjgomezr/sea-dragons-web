import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { createSupabaseMemberGroupsGateway } from "@/lib/groups/supabase-member-groups-gateway";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  SessionVideoEvent,
  SessionVideoGateways,
  SessionVideosGateway,
} from "./session-video";

/**
 * El vídeo de una sesión contra Supabase (#965).
 *
 * Va por la llave de servicio, como editar un evento: `authenticated` sólo
 * puede leer `events` (`0034_events.sql`), y quién puede poner el vídeo lo
 * decide el dominio con el rol y la audiencia antes de escribir. Cada
 * escritura filtra además por el club de quien llama.
 */

const EVENTS_TABLE = "events";

type Environment = Readonly<Record<string, string | undefined>>;

type EventQuery = { readonly clubId: string; readonly eventId: string };

const videoEventRowSchema = z.object({
  id: z.string(),
  status: z.enum(["scheduled", "cancelled"]),
  audience: z.enum(["all", "groups"]),
  video_url: z.string().nullable(),
  event_groups: z.array(z.object({ group_id: z.string() })),
});

function toSessionVideoEvent(row: unknown): SessionVideoEvent {
  const parsed = videoEventRowSchema.parse(row);
  return {
    id: parsed.id,
    status: parsed.status,
    audience:
      parsed.audience === "all"
        ? { kind: "club" }
        : {
            kind: "groups",
            groupIds: parsed.event_groups.map((group) => group.group_id),
          },
    videoUrl: parsed.video_url,
  };
}

async function findEvent(
  serviceClient: SupabaseClient,
  query: EventQuery,
): Promise<SessionVideoEvent | null> {
  const { data, error } = await serviceClient
    .from(EVENTS_TABLE)
    .select("id, status, audience, video_url, event_groups(group_id)")
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

async function writeVideo(
  serviceClient: SupabaseClient,
  query: EventQuery & { readonly url: string | null },
): Promise<void> {
  const { error } = await serviceClient
    .from(EVENTS_TABLE)
    .update({ video_url: query.url })
    .eq("club_id", query.clubId)
    .eq("id", query.eventId);
  if (error) {
    throw new Error(
      `No se pudo guardar el vídeo del evento ${query.eventId} del club ${query.clubId}: ${error.message}`,
    );
  }
}

function createSessionVideosGateway(
  serviceClient: SupabaseClient,
): SessionVideosGateway {
  return {
    findEvent: (query) => findEvent(serviceClient, query),
    saveVideo: (video) => writeVideo(serviceClient, video),
    removeVideo: (query) => writeVideo(serviceClient, { ...query, url: null }),
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
    },
  };
}
