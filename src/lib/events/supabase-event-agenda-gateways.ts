import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { createSupabaseMemberGroupsGateway } from "@/lib/groups/supabase-member-groups-gateway";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  AgendaPosition,
  AgendaQuery,
  EventAgendaGateways,
  EventRow,
  Responder,
  RsvpTally,
} from "./event-agenda";
import { EVENT_TYPES } from "./event-creation";
import { RSVP_RESPONSES } from "./event-rsvp";

/**
 * La agenda y el detalle contra Supabase (#309).
 *
 * Van por la llave de servicio: Admin y Committee ven todos los eventos del
 * club, cosa que la policy de `events` no concede a nadie, y los conteos y
 * los nombres de quién va no los puede leer `authenticated`
 * (`0038_event_rsvps.sql`). Por eso cada consulta filtra por el club de quien
 * llama, y la audiencia de un Coach o un Player la aplica la consulta con los
 * grupos que devuelve la de E4, como en el feed de noticias.
 *
 * Una página son dos peticiones, sea cual sea su tamaño: los eventos, con la
 * audiencia y la respuesta propia embebidas, y los conteos de todos ellos.
 */

const EVENTS_TABLE = "events";
const TALLIES_FUNCTION = "event_rsvp_tallies";
const RESPONDERS_FUNCTION = "live_event_rsvps";

/** El grupo por la clave compuesta que lo ata al club, nombrada para que
 * PostgREST no tenga que deducir la relación. */
const AUDIENCE_EMBED =
  "event_groups(group:groups!event_groups_group_same_club_fkey(id, name))";

/** La misma tabla otra vez, filtrada a los grupos de quien consulta: una
 * fila hace que el evento le alcance. */
const READER_GROUPS_EMBED = "reader_groups:event_groups(group_id)";
const READER_GROUP_FILTER = "reader_groups.group_id";
const READER_AUDIENCE_FILTER = "audience.eq.all,reader_groups.not.is.null";

/** La respuesta propia, filtrada a quien consulta. */
const MY_RSVP_EMBED = "my_rsvp:event_rsvps(response)";
const MY_RSVP_FILTER = "my_rsvp.user_id";

const EVENT_COLUMNS = [
  "id, starts_on, start_time, starts_at, title, event_type, location, notes",
  "status, series_id, audience",
  AUDIENCE_EMBED,
  MY_RSVP_EMBED,
].join(", ");

type Environment = Readonly<Record<string, string | undefined>>;

const eventRowSchema = z.object({
  id: z.string(),
  starts_on: z.string(),
  start_time: z.string(),
  starts_at: z.string(),
  title: z.string(),
  event_type: z.enum(EVENT_TYPES),
  location: z.string(),
  notes: z.string().nullable(),
  status: z.enum(["scheduled", "cancelled"]),
  series_id: z.string().nullable(),
  audience: z.enum(["all", "groups"]),
  event_groups: z.array(
    z.object({ group: z.object({ id: z.string(), name: z.string() }) }),
  ),
  my_rsvp: z.array(z.object({ response: z.enum(RSVP_RESPONSES) })),
});

const tallyRowSchema = z.object({
  event_id: z.string(),
  going_count: z.number().int(),
  maybe_count: z.number().int(),
});

const responderRowSchema = z.object({
  full_name: z.string(),
  response: z.enum(["yes", "maybe"]),
});

/** `time` llega como `HH:MM:SS`; la agenda enseña `HH:MM`, como se creó. */
const HOURS_AND_MINUTES_LENGTH = 5;

function toEventRow(row: unknown): EventRow {
  const parsed = eventRowSchema.parse(row);
  return {
    id: parsed.id,
    startsOn: parsed.starts_on,
    startTime: parsed.start_time.slice(0, HOURS_AND_MINUTES_LENGTH),
    startsAt: parsed.starts_at,
    title: parsed.title,
    eventType: parsed.event_type,
    location: parsed.location,
    notes: parsed.notes,
    status: parsed.status,
    seriesId: parsed.series_id,
    audience:
      parsed.audience === "all"
        ? { kind: "club" }
        : {
            kind: "groups",
            // PostgREST no garantiza el orden de lo embebido: sin esto, la
            // lista cambiaría de orden entre una petición y otra.
            groups: parsed.event_groups
              .map((row) => row.group)
              .sort((first, second) => first.name.localeCompare(second.name)),
          },
    myResponse: parsed.my_rsvp[0]?.response ?? null,
  };
}

/** Lo que sigue a la última fila de la página, en el sentido del periodo.
 * Los dos valores ya los validó el dominio al leer el cursor, así que no
 * pueden romper la sintaxis del filtro. */
function afterFilter(
  after: AgendaPosition,
  period: AgendaQuery["period"],
): string {
  const operator = period === "upcoming" ? "gt" : "lt";
  const instant = `"${after.startsAt}"`;
  return `starts_at.${operator}.${instant},and(starts_at.eq.${instant},id.${operator}.${after.id})`;
}

async function findAgendaPage(
  serviceClient: SupabaseClient,
  query: AgendaQuery,
): Promise<readonly EventRow[]> {
  const columns =
    query.visibility.kind === "club"
      ? EVENT_COLUMNS
      : `${EVENT_COLUMNS}, ${READER_GROUPS_EMBED}`;
  let request = serviceClient
    .from(EVENTS_TABLE)
    .select(columns)
    .eq("club_id", query.clubId)
    .eq(MY_RSVP_FILTER, query.callerId);
  request =
    query.period === "upcoming"
      ? request.gte("starts_on", query.today)
      : request.lt("starts_on", query.today);
  if (query.visibility.kind === "audience") {
    request = request
      .in(READER_GROUP_FILTER, query.visibility.groupIds)
      .or(READER_AUDIENCE_FILTER);
  }
  if (query.after !== null) {
    request = request.or(afterFilter(query.after, query.period));
  }
  const ascending = query.period === "upcoming";
  const { data, error } = await request
    .order("starts_at", { ascending })
    .order("id", { ascending })
    .limit(query.limit);
  if (error) {
    throw new Error(
      `No se pudo leer la agenda del club ${query.clubId}: ${error.message}`,
    );
  }
  return data.map(toEventRow);
}

async function findEvent(
  serviceClient: SupabaseClient,
  query: {
    readonly clubId: string;
    readonly callerId: string;
    readonly eventId: string;
  },
): Promise<EventRow | null> {
  const { data, error } = await serviceClient
    .from(EVENTS_TABLE)
    .select(EVENT_COLUMNS)
    .eq("club_id", query.clubId)
    .eq("id", query.eventId)
    .eq(MY_RSVP_FILTER, query.callerId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer el evento ${query.eventId} del club ${query.clubId}: ${error.message}`,
    );
  }
  return data === null ? null : toEventRow(data);
}

async function countResponses(
  serviceClient: SupabaseClient,
  eventIds: readonly string[],
): Promise<readonly RsvpTally[]> {
  const { data, error } = await serviceClient.rpc(TALLIES_FUNCTION, {
    p_event_ids: eventIds,
  });
  if (error) {
    throw new Error(
      `No se pudieron contar las respuestas de ${eventIds.length} eventos: ${error.message}`,
    );
  }
  return z
    .array(tallyRowSchema)
    .parse(data)
    .map((row) => ({
      eventId: row.event_id,
      goingCount: row.going_count,
      maybeCount: row.maybe_count,
    }));
}

async function listResponders(
  serviceClient: SupabaseClient,
  eventId: string,
): Promise<readonly Responder[]> {
  const { data, error } = await serviceClient.rpc(RESPONDERS_FUNCTION, {
    p_event_ids: [eventId],
  });
  if (error) {
    throw new Error(
      `No se pudo leer quién va al evento ${eventId}: ${error.message}`,
    );
  }
  return z
    .array(responderRowSchema)
    .parse(data)
    .map((row) => ({ fullName: row.full_name, response: row.response }));
}

export function createEventAgendaGateways(
  serviceClient: SupabaseClient,
): EventAgendaGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    memberGroups: createSupabaseMemberGroupsGateway(serviceClient),
    agenda: {
      findAgendaPage: (query) => findAgendaPage(serviceClient, query),
      findEvent: (query) => findEvent(serviceClient, query),
      countResponses: (eventIds) => countResponses(serviceClient, eventIds),
      listResponders: (eventId) => listResponders(serviceClient, eventId),
    },
  };
}

export type EventAgendaGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: EventAgendaGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición para la agenda y el detalle. Devuelve las variables
 * que faltan en vez de lanzar, como las demás. */
export function createSupabaseEventAgendaGateways(
  env: Environment,
): EventAgendaGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createEventAgendaGateways(createServiceRoleClient(env)),
  };
}
