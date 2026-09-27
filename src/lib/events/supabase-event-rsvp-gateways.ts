import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { createSupabaseMemberGroupsGateway } from "@/lib/groups/supabase-member-groups-gateway";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type { EventRsvpGateways, NewEventRsvp, RsvpEvent } from "./event-rsvp";

/**
 * Responder a un evento contra Supabase (#308).
 *
 * Va por la llave de servicio: `authenticated` sólo puede leer sus
 * respuestas (`0038_event_rsvps.sql`), porque quién puede responder depende
 * de la audiencia y de la hora, y eso lo decide el dominio antes de escribir.
 */

const EVENTS_TABLE = "events";
const RSVPS_TABLE = "event_rsvps";
/** La clave primaria de `event_rsvps`: el upsert choca con ella y reescribe
 * la fila en vez de duplicarla. */
const RSVP_CONFLICT_TARGET = "event_id,user_id";

type Environment = Readonly<Record<string, string | undefined>>;

const rsvpEventRowSchema = z.object({
  id: z.string(),
  club_id: z.string(),
  status: z.enum(["scheduled", "cancelled"]),
  starts_at: z.string(),
  audience: z.enum(["all", "groups"]),
  event_groups: z.array(z.object({ group_id: z.string() })),
});

function toRsvpEvent(row: z.infer<typeof rsvpEventRowSchema>): RsvpEvent {
  return {
    id: row.id,
    clubId: row.club_id,
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
): Promise<RsvpEvent | null> {
  const { data, error } = await serviceClient
    .from(EVENTS_TABLE)
    .select("id, club_id, status, starts_at, audience, event_groups(group_id)")
    .eq("club_id", query.clubId)
    .eq("id", query.eventId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer el evento ${query.eventId} del club ${query.clubId}: ${error.message}`,
    );
  }
  return data === null ? null : toRsvpEvent(rsvpEventRowSchema.parse(data));
}

async function saveResponse(
  serviceClient: SupabaseClient,
  rsvp: NewEventRsvp,
): Promise<void> {
  const { error } = await serviceClient.from(RSVPS_TABLE).upsert(
    {
      event_id: rsvp.eventId,
      user_id: rsvp.userId,
      club_id: rsvp.clubId,
      response: rsvp.response,
      responded_at: rsvp.respondedAt.toISOString(),
    },
    { onConflict: RSVP_CONFLICT_TARGET },
  );
  if (error) {
    throw new Error(
      `No se pudo guardar la respuesta de ${rsvp.userId} al evento ${rsvp.eventId}: ${error.message}`,
    );
  }
}

export function createEventRsvpGateways(
  serviceClient: SupabaseClient,
): EventRsvpGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    memberGroups: createSupabaseMemberGroupsGateway(serviceClient),
    rsvps: {
      findEvent: (query) => findEvent(serviceClient, query),
      saveResponse: (rsvp) => saveResponse(serviceClient, rsvp),
    },
  };
}

export type EventRsvpGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: EventRsvpGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición para el endpoint de RSVP. Devuelve las variables que
 * faltan en vez de lanzar, como las demás. */
export function createSupabaseEventRsvpGateways(
  env: Environment,
): EventRsvpGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createEventRsvpGateways(createServiceRoleClient(env)),
  };
}
