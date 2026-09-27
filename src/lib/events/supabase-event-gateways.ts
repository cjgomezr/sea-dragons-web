import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { createSupabaseAudienceMembersGateway } from "@/lib/notifications/supabase-audience-members";
import { createSupabaseNotificationWriter } from "@/lib/notifications/supabase-notification-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  EventGateways,
  NewEventSchedule,
  SavedEventSchedule,
} from "./event-creation";

/**
 * Crear eventos contra Supabase (#307).
 *
 * Va por la llave de servicio: `authenticated` no puede escribir en las
 * tablas de eventos (`0034_events.sql`). Guardar pasa por
 * `create_events` (`0036_create_events.sql`), que escribe la serie, las
 * ocurrencias y sus audiencias en una sola transacción: PostgREST no abre una
 * entre dos peticiones, y una temporada a medias no se puede deshacer bien
 * desde aquí.
 *
 * Después avisa a la audiencia (#310) con la misma audiencia y el mismo
 * escritor de avisos que las noticias.
 */

const GROUPS_TABLE = "groups";
const CREATE_EVENTS_FUNCTION = "create_events";

type Environment = Readonly<Record<string, string | undefined>>;

const savedScheduleSchema = z.object({
  series_id: z.string().nullable(),
  event_ids: z.array(z.string()),
});

/** Lo que lee `create_events` de su argumento `schedule`. */
type CreateEventsScheduleArgument = {
  readonly title: string;
  readonly event_type: string;
  readonly start_time: string;
  readonly location: string;
  readonly notes: string | null;
  readonly audience: "all" | "groups";
  readonly group_ids: readonly string[];
  readonly occurrence_dates: readonly string[];
  readonly series: {
    readonly weekdays: readonly number[];
    readonly starts_on: string;
    readonly ends_on: string;
  } | null;
};

/** La audiencia va con los nombres de la base, donde "todo el club" es
 * `all`. */
function toScheduleArgument(
  schedule: NewEventSchedule,
): CreateEventsScheduleArgument {
  const { fields, series } = schedule;
  return {
    title: fields.title,
    event_type: fields.eventType,
    start_time: fields.startTime,
    location: fields.location,
    notes: fields.notes,
    audience: fields.audience.kind === "club" ? "all" : "groups",
    group_ids:
      fields.audience.kind === "groups" ? fields.audience.groupIds : [],
    occurrence_dates: schedule.occurrenceDates,
    series:
      series === null
        ? null
        : {
            weekdays: series.weekdays,
            starts_on: series.startsOn,
            ends_on: series.endsOn,
          },
  };
}

async function insertSchedule(
  serviceClient: SupabaseClient,
  schedule: NewEventSchedule,
): Promise<SavedEventSchedule> {
  const { data, error } = await serviceClient.rpc(CREATE_EVENTS_FUNCTION, {
    acting_club_id: schedule.clubId,
    acting_user_id: schedule.authorId,
    schedule: toScheduleArgument(schedule),
  });
  if (error) {
    throw new Error(
      `No se pudieron crear los eventos en el club ${schedule.clubId}: ${error.message}`,
    );
  }
  const saved = savedScheduleSchema.parse(data);
  return { seriesId: saved.series_id, eventIds: saved.event_ids };
}

async function findClubGroupIds(
  serviceClient: SupabaseClient,
  query: { readonly clubId: string; readonly groupIds: readonly string[] },
): Promise<ReadonlySet<string>> {
  const { data, error } = await serviceClient
    .from(GROUPS_TABLE)
    .select("id")
    .eq("club_id", query.clubId)
    .in("id", query.groupIds);
  if (error) {
    throw new Error(
      `No se pudieron leer los grupos de la audiencia en el club ${query.clubId}: ${error.message}`,
    );
  }
  return new Set(data.map((row) => z.string().parse(row.id)));
}

export function createEventGateways(
  serviceClient: SupabaseClient,
): EventGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    events: {
      findClubGroupIds: (query) => findClubGroupIds(serviceClient, query),
      insertSchedule: (schedule) => insertSchedule(serviceClient, schedule),
    },
    eventAudience: createSupabaseAudienceMembersGateway(serviceClient),
    notifications: createSupabaseNotificationWriter(serviceClient),
  };
}

export type EventGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: EventGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición para los endpoints de eventos. Devuelve las variables
 * que faltan en vez de lanzar, como las demás. */
export function createSupabaseEventGateways(
  env: Environment,
): EventGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createEventGateways(createServiceRoleClient(env)),
  };
}
