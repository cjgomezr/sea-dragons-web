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
  SeriesReschedule,
  SeriesSplit,
} from "./series-management";
import {
  createEventManagementGateways,
  toChangesArgument,
  toHoursAndMinutes,
  toOptionalHoursAndMinutes,
} from "./supabase-event-management-gateways";
import {
  PLACE_COLUMNS,
  placeRowShape,
  toEventPlace,
} from "./supabase-event-place";

/**
 * Editar y cancelar una serie contra Supabase (#315).
 *
 * Va por la llave de servicio, como editar un evento (#314): `authenticated`
 * no puede escribir en las tablas de eventos (`0034_events.sql`). Editar pasa
 * por `update_series` (`0041_update_series.sql`), que cambia la serie, sus
 * ocurrencias futuras y sus audiencias en una sola transacción. Partir desde
 * una sesión (#653) pasa por `split_series` (`0073_split_series.sql`), que
 * hace lo mismo sobre la serie nueva en la misma transacción, y con días o
 * fecha final nuevos (#654, `0074_split_series_schedule.sql`) cancela, reactiva
 * y crea sus sesiones antes de aplicar los cambios. Cancelar es
 * un solo `update` sobre las ocurrencias, atómico por sí mismo, y va directo
 * por PostgREST.
 */

const EVENT_SERIES_TABLE = "event_series";
const EVENTS_TABLE = "events";
const UPDATE_SERIES_FUNCTION = "update_series";
const SPLIT_SERIES_FUNCTION = "split_series";

const MANAGED_SERIES_COLUMNS = `id, title, event_type, start_time, end_time, location, ${PLACE_COLUMNS}, notes, audience, weekdays, starts_on, ends_on, event_series_groups(group_id)`;

type Environment = Readonly<Record<string, string | undefined>>;

const managedSeriesRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  event_type: z.enum(EVENT_TYPES),
  start_time: z.string(),
  end_time: z.string().nullable(),
  location: z.string(),
  ...placeRowShape,
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
    endTime: toOptionalHoursAndMinutes(row.end_time),
    location: row.location,
    place: toEventPlace(row),
    placeDetail: row.place_detail,
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

async function findSessionDay(
  serviceClient: SupabaseClient,
  query: {
    readonly clubId: string;
    readonly seriesId: string;
    readonly occurrenceId: string;
  },
): Promise<string | null> {
  const { data, error } = await serviceClient
    .from(EVENTS_TABLE)
    .select("starts_on")
    .eq("club_id", query.clubId)
    .eq("series_id", query.seriesId)
    .eq("id", query.occurrenceId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer la sesión ${query.occurrenceId} de la serie ${query.seriesId} del club ${query.clubId}: ${error.message}`,
    );
  }
  return data === null
    ? null
    : z.object({ starts_on: z.string() }).parse(data).starts_on;
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

const seriesSplitSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.enum(["edited", "split"]),
    series_id: z.string(),
    updated_occurrences: z.number().int().nonnegative(),
  }),
  z.object({ outcome: z.literal("occurrence_started") }),
  z.object({ outcome: z.literal("session_not_in_series") }),
]);

function toSeriesSplit(row: z.infer<typeof seriesSplitSchema>): SeriesSplit {
  if (row.outcome === "edited" || row.outcome === "split") {
    return {
      kind: row.outcome,
      seriesId: row.series_id,
      updatedOccurrences: row.updated_occurrences,
    };
  }
  return { kind: row.outcome };
}

/** El horario nuevo en las claves que lee `split_series`. */
type ScheduleArgument = {
  readonly weekdays: SeriesReschedule["weekdays"];
  readonly ends_on: string;
  readonly session_dates: readonly string[];
  readonly added_dates: readonly string[];
};

function toScheduleArgument(
  schedule: SeriesReschedule | null,
): ScheduleArgument | null {
  return schedule === null
    ? null
    : {
        weekdays: schedule.weekdays,
        ends_on: schedule.endsOn,
        session_dates: schedule.sessionDates,
        added_dates: schedule.addedDates,
      };
}

async function splitSeries(
  serviceClient: SupabaseClient,
  split: {
    readonly clubId: string;
    readonly seriesId: string;
    readonly fromOccurrenceId: string;
    readonly changes: SeriesEdit;
    readonly schedule: SeriesReschedule | null;
  },
): Promise<SeriesSplit> {
  const { data, error } = await serviceClient.rpc(SPLIT_SERIES_FUNCTION, {
    acting_club_id: split.clubId,
    target_series_id: split.seriesId,
    from_event_id: split.fromOccurrenceId,
    changes: toChangesArgument(split.changes),
    schedule: toScheduleArgument(split.schedule),
  });
  if (error) {
    throw new Error(
      `No se pudo partir la serie ${split.seriesId} del club ${split.clubId}: ${error.message}`,
    );
  }
  return toSeriesSplit(seriesSplitSchema.parse(data));
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
  const { members, events, eventCovers, eventAudience, notifications } =
    createEventManagementGateways(serviceClient);
  return {
    members,
    events,
    eventCovers,
    eventAudience,
    notifications,
    managedSeries: {
      findSeries: (query) => findSeries(serviceClient, query),
      findSessionDay: (query) => findSessionDay(serviceClient, query),
      updateSeries: (update) => updateSeries(serviceClient, update),
      splitSeries: (split) => splitSeries(serviceClient, split),
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
