import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import { EVENT_TYPES } from "./event-creation";
import type {
  EventChanges,
  EventManagementGateways,
  ManagedEvent,
  ManagedEventWrite,
} from "./event-management";
import { findClubGroupIds } from "./supabase-event-gateways";

/**
 * Editar y cancelar eventos contra Supabase (#314).
 *
 * Va por la llave de servicio: `authenticated` no puede escribir en las
 * tablas de eventos (`0034_events.sql`). Editar pasa por `update_event`
 * (`0040_update_event.sql`), que cambia el evento y su audiencia en una sola
 * transacción. Cancelar toca una sola fila y va directo por PostgREST.
 *
 * Las dos escrituras llevan la misma guarda que el dominio (programado y sin
 * empezar), por si el evento cambió entre leerlo y escribirlo.
 */

const EVENTS_TABLE = "events";
const UPDATE_EVENT_FUNCTION = "update_event";

const MANAGED_EVENT_COLUMNS =
  "id, series_id, title, event_type, starts_on, start_time, location, notes, audience, status, cancelled_at, event_groups(group_id)";

/** Postgres devuelve un `time` como `HH:MM:SS`; el dominio habla en `HH:MM`. */
const HOURS_AND_MINUTES_LENGTH = 5;

type Environment = Readonly<Record<string, string | undefined>>;

const managedEventRowSchema = z.object({
  id: z.string(),
  series_id: z.string().nullable(),
  title: z.string(),
  event_type: z.enum(EVENT_TYPES),
  starts_on: z.string(),
  start_time: z.string(),
  location: z.string(),
  notes: z.string().nullable(),
  audience: z.enum(["all", "groups"]),
  status: z.enum(["scheduled", "cancelled"]),
  cancelled_at: z.string().nullable(),
  event_groups: z.array(z.object({ group_id: z.string() })),
});

type ManagedEventRow = z.infer<typeof managedEventRowSchema>;

function toManagedEvent(row: ManagedEventRow): ManagedEvent {
  const event = {
    id: row.id,
    seriesId: row.series_id,
    title: row.title,
    eventType: row.event_type,
    startsOn: row.starts_on,
    startTime: row.start_time.slice(0, HOURS_AND_MINUTES_LENGTH),
    location: row.location,
    notes: row.notes,
    audience:
      row.audience === "all"
        ? { kind: "club" as const }
        : {
            kind: "groups" as const,
            groupIds: row.event_groups.map((group) => group.group_id),
          },
  };
  if (row.status === "scheduled") {
    return { ...event, status: "scheduled" };
  }
  if (row.cancelled_at === null) {
    throw new Error(
      `El evento cancelado ${row.id} no tiene hora de cancelación.`,
    );
  }
  return {
    ...event,
    status: "cancelled",
    cancelledAt: new Date(row.cancelled_at).toISOString(),
  };
}

async function findEvent(
  serviceClient: SupabaseClient,
  query: { readonly clubId: string; readonly eventId: string },
): Promise<ManagedEvent | null> {
  const { data, error } = await serviceClient
    .from(EVENTS_TABLE)
    .select(MANAGED_EVENT_COLUMNS)
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
    : toManagedEvent(managedEventRowSchema.parse(data));
}

/** Sólo las claves que cambian, con los nombres de la base, que es lo que
 * lee `update_event`. */
function toChangesArgument(changes: EventChanges): Record<string, unknown> {
  const { audience } = changes;
  return {
    ...(changes.title === undefined ? {} : { title: changes.title }),
    ...(changes.eventType === undefined
      ? {}
      : { event_type: changes.eventType }),
    ...(changes.startsOn === undefined ? {} : { starts_on: changes.startsOn }),
    ...(changes.startTime === undefined
      ? {}
      : { start_time: changes.startTime }),
    ...(changes.location === undefined ? {} : { location: changes.location }),
    ...(changes.notes === undefined ? {} : { notes: changes.notes }),
    ...(audience === undefined
      ? {}
      : {
          audience: audience.kind === "club" ? "all" : "groups",
          group_ids: audience.kind === "groups" ? audience.groupIds : [],
        }),
  };
}

async function updateEvent(
  serviceClient: SupabaseClient,
  update: {
    readonly clubId: string;
    readonly eventId: string;
    readonly changes: EventChanges;
  },
): Promise<ManagedEventWrite> {
  const { data, error } = await serviceClient.rpc(UPDATE_EVENT_FUNCTION, {
    acting_club_id: update.clubId,
    target_event_id: update.eventId,
    changes: toChangesArgument(update.changes),
  });
  if (error) {
    throw new Error(
      `No se pudo editar el evento ${update.eventId} del club ${update.clubId}: ${error.message}`,
    );
  }
  return z.boolean().parse(data) ? "saved" : "closed";
}

async function cancelEvent(
  serviceClient: SupabaseClient,
  cancellation: {
    readonly clubId: string;
    readonly eventId: string;
    readonly cancelledAt: Date;
  },
): Promise<ManagedEventWrite> {
  const cancelledAt = cancellation.cancelledAt.toISOString();
  const { data, error } = await serviceClient
    .from(EVENTS_TABLE)
    .update({ status: "cancelled", cancelled_at: cancelledAt })
    .eq("club_id", cancellation.clubId)
    .eq("id", cancellation.eventId)
    .eq("status", "scheduled")
    .gt("starts_at", cancelledAt)
    .select("id");
  if (error) {
    throw new Error(
      `No se pudo cancelar el evento ${cancellation.eventId} del club ${cancellation.clubId}: ${error.message}`,
    );
  }
  return data.length === 0 ? "closed" : "saved";
}

export function createEventManagementGateways(
  serviceClient: SupabaseClient,
): EventManagementGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    events: {
      findClubGroupIds: (query) => findClubGroupIds(serviceClient, query),
    },
    managedEvents: {
      findEvent: (query) => findEvent(serviceClient, query),
      updateEvent: (update) => updateEvent(serviceClient, update),
      cancelEvent: (cancellation) => cancelEvent(serviceClient, cancellation),
    },
  };
}

export type EventManagementGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: EventManagementGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición para editar y cancelar. Devuelve las variables que
 * faltan en vez de lanzar, como las demás. */
export function createSupabaseEventManagementGateways(
  env: Environment,
): EventManagementGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createEventManagementGateways(createServiceRoleClient(env)),
  };
}
