import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import { EVENT_TYPES } from "./event-creation";
import { ISO_WEEKDAYS } from "./event-occurrences";
import type {
  ManagedSeries,
  SeriesEdit,
  SeriesManagementGateways,
} from "./series-management";
import {
  createEventManagementGateways,
  toChangesArgument,
  toHoursAndMinutes,
} from "./supabase-event-management-gateways";

/**
 * Editar y cancelar una serie contra Supabase (#315).
 *
 * Va por la llave de servicio, como editar un evento (#314): `authenticated`
 * no puede escribir en las tablas de eventos (`0034_events.sql`). Editar pasa
 * por `update_series` (`0041_update_series.sql`), que cambia la serie, sus
 * ocurrencias futuras y sus audiencias en una sola transacción. Cancelar es
 * un solo `update` sobre las ocurrencias, atómico por sí mismo, y va directo
 * por PostgREST.
 */

const EVENT_SERIES_TABLE = "event_series";
const EVENTS_TABLE = "events";
const UPDATE_SERIES_FUNCTION = "update_series";

const MANAGED_SERIES_COLUMNS =
  "id, title, event_type, start_time, location, notes, audience, weekdays, starts_on, ends_on, event_series_groups(group_id)";

type Environment = Readonly<Record<string, string | undefined>>;

const managedSeriesRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  event_type: z.enum(EVENT_TYPES),
  start_time: z.string(),
  location: z.string(),
  notes: z.string().nullable(),
  audience: z.enum(["all", "groups"]),
  weekdays: z.array(z.union(ISO_WEEKDAYS.map((day) => z.literal(day)))),
  starts_on: z.string(),
  ends_on: z.string(),
  event_series_groups: z.array(z.object({ group_id: z.string() })),
});

type ManagedSeriesRow = z.infer<typeof managedSeriesRowSchema>;

function toManagedSeries(row: ManagedSeriesRow): ManagedSeries {
  return {
    id: row.id,
    title: row.title,
    eventType: row.event_type,
    startTime: toHoursAndMinutes(row.start_time),
    location: row.location,
    notes: row.notes,
    audience:
      row.audience === "all"
        ? { kind: "club" }
        : {
            kind: "groups",
            groupIds: row.event_series_groups.map((group) => group.group_id),
          },
    weekdays: row.weekdays,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
  };
}

async function findSeries(
  serviceClient: SupabaseClient,
  query: { readonly clubId: string; readonly seriesId: string },
): Promise<ManagedSeries | null> {
  const { data, error } = await serviceClient
    .from(EVENT_SERIES_TABLE)
    .select(MANAGED_SERIES_COLUMNS)
    .eq("club_id", query.clubId)
    .eq("id", query.seriesId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer la serie ${query.seriesId} del club ${query.clubId}: ${error.message}`,
    );
  }
  return data === null
    ? null
    : toManagedSeries(managedSeriesRowSchema.parse(data));
}

async function updateSeries(
  serviceClient: SupabaseClient,
  update: {
    readonly clubId: string;
    readonly seriesId: string;
    readonly changes: SeriesEdit;
  },
): Promise<number> {
  const { data, error } = await serviceClient.rpc(UPDATE_SERIES_FUNCTION, {
    acting_club_id: update.clubId,
    target_series_id: update.seriesId,
    changes: toChangesArgument(update.changes),
  });
  if (error) {
    throw new Error(
      `No se pudo editar la serie ${update.seriesId} del club ${update.clubId}: ${error.message}`,
    );
  }
  return z.number().int().nonnegative().parse(data);
}

async function cancelSeries(
  serviceClient: SupabaseClient,
  cancellation: {
    readonly clubId: string;
    readonly seriesId: string;
    readonly cancelledAt: Date;
  },
): Promise<number> {
  const cancelledAt = cancellation.cancelledAt.toISOString();
  const { data, error } = await serviceClient
    .from(EVENTS_TABLE)
    .update({ status: "cancelled", cancelled_at: cancelledAt })
    .eq("club_id", cancellation.clubId)
    .eq("series_id", cancellation.seriesId)
    .eq("status", "scheduled")
    .gt("starts_at", cancelledAt)
    .select("id");
  if (error) {
    throw new Error(
      `No se pudo cancelar la serie ${cancellation.seriesId} del club ${cancellation.clubId}: ${error.message}`,
    );
  }
  return data.length;
}

export function createSeriesManagementGateways(
  serviceClient: SupabaseClient,
): SeriesManagementGateways {
  const { members, events } = createEventManagementGateways(serviceClient);
  return {
    members,
    events,
    managedSeries: {
      findSeries: (query) => findSeries(serviceClient, query),
      updateSeries: (update) => updateSeries(serviceClient, update),
      cancelSeries: (cancellation) => cancelSeries(serviceClient, cancellation),
    },
  };
}

export type SeriesManagementGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: SeriesManagementGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición para editar y cancelar una serie. Devuelve las
 * variables que faltan en vez de lanzar, como las demás. */
export function createSupabaseSeriesManagementGateways(
  env: Environment,
): SeriesManagementGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createSeriesManagementGateways(createServiceRoleClient(env)),
  };
}
